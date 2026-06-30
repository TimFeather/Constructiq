import { uploadFile, sendEmail, removeFile } from '@/api/supabaseClient';
import { logDocumentEvent } from '@/lib/auditLog';
import { useToast } from '@/components/ui/use-toast';
import SecureFileLink, { useSignedUrl } from '@/components/shared/SecureFileLink';
import React, { useState, useRef } from 'react';
import { Document, DocumentFolderTemplate, Project, AuditLog } from '@/api/entities';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import StatusBadge from '@/components/shared/StatusBadge';
import { Upload, ExternalLink, FileText, Folder, FolderOpen, GripVertical, ChevronDown, ChevronRight, FolderPlus, Trash2, Eye, Archive, RefreshCw, Search, X, CheckSquare, History, Users, Lock } from 'lucide-react';
import { format } from 'date-fns';

function getFileType(name) {
  if (!name) return 'Other';
  const ext = name.split('.').pop()?.toLowerCase();
  const map = { pdf: 'PDF', doc: 'DOCX', docx: 'DOCX', xls: 'Excel', xlsx: 'Excel',
    png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', dwg: 'CAD', dxf: 'CAD' };
  return map[ext] || 'Other';
}

const UNFILED = '__unfiled__';

const FALLBACK_FOLDERS = [
  'Architectural Plans',
  'Engineering Drawings',
  'Geotech Reports',
  'Photos',
  'Sub Contractor Uploads',
];

const FALLBACK_PERMISSIONS = {
  'Architectural Plans':  ['admin', 'internal', 'pricing'],
  'Engineering Drawings': ['admin', 'internal', 'pricing'],
  'Geotech Reports':      ['admin', 'internal', 'pricing'],
  'Photos':               ['admin', 'internal', 'pricing'],
  'Sub Contractor Uploads': ['admin', 'internal', 'pricing', 'external'],
};

export default function ProjectDocsPanel({ project, docs = [] }) {
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', file: null, folder: '', visibility: 'public' });
  const [uploading, setUploading] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [extraFolders, setExtraFolders] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState(null);
  const [versioningDoc, setVersioningDoc] = useState(null);
  const [versionFile, setVersionFile] = useState(null);
  const [versionNotes, setVersionNotes] = useState('');
  const [versionUploading, setVersionUploading] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState(new Set());
  const [previewDoc, setPreviewDoc] = useState(null);
  const [historyDoc, setHistoryDoc] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMoveFolder, setBulkMoveFolder] = useState(null); // folder name pending bulk-move confirmation
  const dropZoneRef = useRef(null);
  // Controllers abort the in-flight network transfer when a dialog is closed mid-upload.
  // The *AbortRef flags are belt-and-braces: if the upload finished in the instant before
  // abort landed, they tell the resolved handler to clean up the file and skip the row.
  const uploadControllerRef = useRef(null);
  const versionControllerRef = useRef(null);
  const uploadAbortRef = useRef(false);
  const versionAbortRef = useRef(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ['documentFolderTemplates'],
    queryFn: () => DocumentFolderTemplate.list('-created_at', 50),
  });

  const defaultTemplate = templates.find(t => t.is_default) ?? templates[0] ?? null;
  const templateFolders = defaultTemplate?.folder_structure ?? FALLBACK_FOLDERS;
  const templatePerms  = defaultTemplate?.folder_permissions ?? FALLBACK_PERMISSIONS;

  const userRole = user?.role ?? 'external';
  const isInternal = userRole === 'admin' || userRole === 'internal';
  const isExternal = userRole === 'external';

  // Folders visible to this role based on template permissions
  const visibleTemplateFolders = templateFolders.filter(f => {
    const allowed = templatePerms[f] ?? ['admin', 'internal', 'pricing'];
    return allowed.includes(userRole);
  });

  // Folders that can be uploaded to (external users limited to their visible folders)
  const allowedFolders = isInternal ? null : visibleTemplateFolders;

  const docFolders = docs.map(d => d.folder).filter(Boolean);
  // project.doc_folders persists user-created folders (including empty ones) across reloads.
  const persistedFolders = project.doc_folders || [];
  const allFolders = [...new Set([...templateFolders, ...docFolders, ...extraFolders, ...persistedFolders])];

  // Role-based folder visibility: show a folder when the template grants this role
  // access to it. (External users were previously ALSO restricted to folders that
  // already contained a document, which hid empty folders they were permitted to
  // see — e.g. an empty "Sub Contractor Uploads". They now see every folder granted
  // to them, like internal users.) Whether the DOCUMENTS inside are visible is a
  // separate gate enforced by RLS — external users only receive 'public'/shared docs.
  const folders = allFolders.filter(f => {
    const allowed = templatePerms[f] ?? ['admin', 'internal', 'pricing'];
    return allowed.includes(userRole);
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['documents', project.id] });
    queryClient.invalidateQueries({ queryKey: ['documents'] });
  };

  // Bound audit logger — fire-and-forget, never blocks the action.
  const logEvent = (action, document, description) =>
    logDocumentEvent({ action, document, projectId: project.id, user, description });
  const docName = (id) => docs.find(d => d.id === id)?.name || '';

  const moveMutation = useMutation({
    mutationFn: ({ id, folder }) => Document.update(id, { folder: folder || null }),
    onSuccess: (_data, vars) => {
      invalidate();
      logEvent('document.moved', { id: vars.id, name: docName(vars.id) }, `Moved to ${vars.folder || 'Unfiled'}`);
    },
  });

  // Persist a new (possibly empty) folder name on the project so it survives a reload.
  // Internal-only — gated by the "New Folder" button visibility (isInternal) and matched
  // by projects_update RLS (admin / creator / internal-on-team).
  const folderMutation = useMutation({
    mutationFn: (name) => {
      const existing = project.doc_folders || [];
      if (existing.includes(name)) return Promise.resolve(project);
      return Project.update(project.id, { doc_folders: [...existing, name] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => {
      toast({ title: 'Folder not saved', description: err?.message || 'The folder will disappear on reload. Please try again.', variant: 'destructive' });
    },
  });

  // Create a folder: instant local display (extraFolders) + persistence (folderMutation).
  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    setExtraFolders(prev => [...new Set([...prev, name])]);
    folderMutation.mutate(name);
    setShowNewFolder(false);
    setNewFolderName('');
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status, ownerEmail }) => {
      const promise = Document.update(id, { status });
      if (ownerEmail) {
        sendEmail({
          to: ownerEmail,
          subject: `Document status changed to ${status}`,
          body: `A document you uploaded has been updated to status: ${status}.`,
        });
      }
      return promise;
    },
    onSuccess: (_data, vars) => {
      invalidate();
      logEvent('document.status_changed', { id: vars.id, name: docName(vars.id) }, `Status changed to ${vars.status}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => Document.delete(id),
    onSuccess: (_data, id) => {
      invalidate();
      logEvent('document.deleted', { id, name: docName(id) }, `Deleted “${docName(id)}”`);
    },
  });

  // Per-file sharing toggle: 'public' = shared with external team members (subject to
  // folder access + RLS), 'private' = internal roles only. Internal users only.
  const visibilityMutation = useMutation({
    mutationFn: ({ id, visibility }) => Document.update(id, { visibility }),
    onSuccess: (_data, vars) => {
      invalidate();
      logEvent('document.visibility_changed', { id: vars.id, name: docName(vars.id) },
        `Sharing set to ${vars.visibility === 'public' ? 'Shared' : 'Internal only'}`);
    },
    onError: (e) => toast({ title: 'Could not change sharing', description: e?.message, variant: 'destructive' }),
  });

  // ── Bulk selection + actions (internal only) ──────────────────────────────
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());

  // Bulk ops act only on selections within the current active/archived scope (not the
  // search filter), so narrowing the search box never silently drops a queued action.
  const selectedScopedIds = () => {
    const scopeIds = new Set(scopedDocs.map(d => d.id));
    return [...selectedIds].filter(id => scopeIds.has(id));
  };

  const bulkStatusMutation = useMutation({
    mutationFn: async (status) => {
      for (const id of selectedScopedIds()) {
        await Document.update(id, { status });
        logEvent('document.status_changed', { id, name: docName(id) }, `Status changed to ${status} (bulk)`);
      }
    },
    onSuccess: () => { invalidate(); clearSelection(); toast({ title: 'Status updated' }); },
    onError: (e) => toast({ title: 'Bulk update failed', description: e?.message, variant: 'destructive' }),
  });
  const bulkMoveMutation = useMutation({
    mutationFn: async (folder) => {
      for (const id of selectedScopedIds()) {
        await Document.update(id, { folder: folder || null });
        logEvent('document.moved', { id, name: docName(id) }, `Moved to ${folder || 'Unfiled'} (bulk)`);
      }
    },
    onSuccess: () => { invalidate(); clearSelection(); toast({ title: 'Documents moved' }); },
    onError: (e) => toast({ title: 'Bulk move failed', description: e?.message, variant: 'destructive' }),
  });
  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      for (const id of selectedScopedIds()) {
        const name = docName(id);
        await Document.delete(id);
        logEvent('document.deleted', { id, name }, `Deleted “${name}” (bulk)`);
      }
    },
    onSuccess: () => { invalidate(); clearSelection(); toast({ title: 'Documents deleted' }); },
    onError: (e) => toast({ title: 'Bulk delete failed', description: e?.message, variant: 'destructive' }),
  });
  const bulkBusy = bulkStatusMutation.isPending || bulkMoveMutation.isPending || bulkDeleteMutation.isPending;
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  const handleUpload = async (file, folder) => {
    const f = file || uploadForm.file;
    const docName = f?.name?.replace(/\.[^/.]+$/, '') || uploadForm.name;
    if (!f || !docName) return;
    setUploading(true);
    uploadAbortRef.current = false;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    // `up` stays null until the storage upload succeeds, so the rollback only ever
    // removes a file THIS call just wrote — never a pre-existing one.
    let up = null;
    try {
      // Project documents are private — store in the private project-files bucket.
      // uploadFile returns a storage path here (not a public URL); render via signed URL.
      up = await uploadFile(f, 'project-files', null, controller.signal);
      // Upload finished just before an abort landed — discard the file, don't create a row.
      if (uploadAbortRef.current) {
        await removeFile(up.bucket, up.path);
        return;
      }
      const created = await Document.create({
        name: docName,
        project_id: project.id,
        folder: folder || uploadForm.folder || undefined,
        file_url: up.file_url,
        file_type: getFileType(f.name),
        status: 'Draft',
        visibility: uploadForm.visibility || 'public',
        uploaded_by_name: user?.full_name || 'Unknown',
        uploaded_by_email: user?.email || '',
      });
      logEvent('document.uploaded', created || { id: null, name: docName },
        `Uploaded “${docName}”${(folder || uploadForm.folder) ? ` to ${folder || uploadForm.folder}` : ''}`);
      invalidate();
      setShowUpload(false);
      setUploadForm({ name: '', file: null, folder: '', visibility: 'public' });
    } catch (err) {
      // File uploaded but the DB row failed — roll back the storage write (no orphan).
      if (up) await removeFile(up.bucket, up.path);
      // User cancelled — the aborted transfer rejects here; that's expected, no error toast.
      if (uploadAbortRef.current) return;
      console.error('Document upload failed:', err);
      toast({ title: 'Upload failed', description: err?.message || 'Please check your connection and try again.', variant: 'destructive' });
    } finally {
      uploadControllerRef.current = null;
      setUploading(false);
    }
  };

  // Drag-and-drop onto the panel (file from desktop)
  const handleDragOverPanel = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeavePanel = () => setIsDragOver(false);
  const handleDropPanel = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isExternal) return;
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await handleUpload(file, allowedFolders ? allowedFolders[0] : '');
    }
  };

  const handleNewVersion = async () => {
    if (!versionFile || !versioningDoc) return;
    setVersionUploading(true);
    versionAbortRef.current = false;
    const controller = new AbortController();
    versionControllerRef.current = controller;
    let up = null;
    try {
      up = await uploadFile(versionFile, 'project-files', null, controller.signal);
      // Upload finished just before an abort landed — discard the new file, leave the doc untouched.
      if (versionAbortRef.current) {
        await removeFile(up.bucket, up.path);
        return;
      }
      const existingVersions = versioningDoc.versions || [];
      await Document.update(versioningDoc.id, {
        file_url: up.file_url,
        version_number: (versioningDoc.version_number || 1) + 1,
        versions: [
          ...existingVersions,
          {
            version_number: versioningDoc.version_number || 1,
            file_url: versioningDoc.file_url,
            uploaded_by_name: versioningDoc.uploaded_by_name,
            uploaded_by_email: versioningDoc.uploaded_by_email,
            uploaded_at: new Date().toISOString(),
            notes: versionNotes || '',
          },
        ],
      });
      logEvent('document.version_added', versioningDoc, `New version v${(versioningDoc.version_number || 1) + 1} of “${versioningDoc.name}”`);
      invalidate();
      setVersioningDoc(null);
      setVersionFile(null);
      setVersionNotes('');
    } catch (err) {
      // Update failed — remove ONLY the newly uploaded file. The existing file_url and
      // versions[] are never mutated on failure, so the prior version is always preserved.
      if (up) await removeFile(up.bucket, up.path);
      // User cancelled — the aborted transfer rejects here; that's expected, no error toast.
      if (versionAbortRef.current) return;
      console.error('New version upload failed:', err);
      toast({ title: 'Version upload failed', description: err?.message || 'The document was not changed. Please try again.', variant: 'destructive' });
    } finally {
      versionControllerRef.current = null;
      setVersionUploading(false);
    }
  };

  // Closing a dialog while its upload is in flight flags an abort so the resolved upload
  // is cleaned up instead of writing a row.
  const closeUploadDialog = (open) => {
    if (open) { setShowUpload(true); return; }
    if (uploading) { uploadAbortRef.current = true; uploadControllerRef.current?.abort(); }
    setShowUpload(false);
  };
  const closeVersionDialog = (open) => {
    if (open) return;
    if (versionUploading) { versionAbortRef.current = true; versionControllerRef.current?.abort(); }
    setVersioningDoc(null);
  };

  const handleDragEnd = (result) => {
    if (!isInternal) return;
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const destFolder = destination.droppableId === UNFILED ? null : destination.droppableId;
    const doc = docs.find(d => d.id === draggableId);
    if (!doc) return;
    const currentFolder = doc.folder || null;
    if (currentFolder === destFolder) return;
    moveMutation.mutate({ id: draggableId, folder: destFolder });
  };

  const toggleFolder = (f) => setCollapsedFolders(prev => ({ ...prev, [f]: !prev[f] }));

  // Preview modal renders the file inline (<img>/<iframe>), so the URL must be
  // resolved before render — sign it up front (no-op for legacy public URLs).
  const preview = useSignedUrl(previewDoc?.file_url, { bucket: 'project-files' });

  // Per-document audit history (admin/internal only — matches audit_logs_select RLS).
  const { data: historyLogs = [], isLoading: historyLoading } = useQuery({
    queryKey: ['documentAudit', historyDoc?.id],
    queryFn: () => AuditLog.filter({ entity_id: historyDoc.id }, '-created_at', 50),
    enabled: !!historyDoc && isInternal,
  });

  // Active/archived scope, then a free-text filter over name / uploader / status / folder.
  const matchesSearch = (d) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (d.name || '').toLowerCase().includes(q)
      || (d.uploaded_by_name || '').toLowerCase().includes(q)
      || (d.status || '').toLowerCase().includes(q)
      || (d.folder || '').toLowerCase().includes(q);
  };
  const scopedDocs = showArchived ? docs.filter(d => d.archived) : docs.filter(d => !d.archived);
  const visibleDocs = scopedDocs.filter(matchesSearch);
  const archivedCount = docs.filter(d => d.archived).length;

  const grouped = {};
  folders.forEach(f => { grouped[f] = []; });
  grouped[UNFILED] = [];
  visibleDocs.forEach(d => {
    const key = d.folder && allFolders.includes(d.folder) ? d.folder : UNFILED;
    if (grouped[key] === undefined) { grouped[UNFILED].push(d); return; } // folder not visible to this role — show in unfiled
    grouped[key].push(d);
  });

  const renderDoc = (doc, index) => (
    <Draggable key={doc.id} draggableId={doc.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`flex items-center gap-2 px-3 py-2 text-sm border-b last:border-b-0 bg-card transition-colors ${snapshot.isDragging ? 'shadow-lg opacity-80' : selectedIds.has(doc.id) ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
        >
          {isInternal && (
            <input
              type="checkbox"
              checked={selectedIds.has(doc.id)}
              onChange={() => toggleSelect(doc.id)}
              onClick={e => e.stopPropagation()}
              className="w-3.5 h-3.5 accent-primary cursor-pointer flex-shrink-0"
              title="Select for bulk action"
            />
          )}
          <span {...(isInternal ? provided.dragHandleProps : {})} className={`flex-shrink-0 ${isInternal ? 'text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing' : 'invisible w-4'}`}>
            {isInternal && <GripVertical className="w-4 h-4" />}
          </span>
          <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <SecureFileLink value={doc.file_url}
            className="font-medium text-primary hover:underline flex items-center gap-1 flex-1 min-w-0 truncate">
            {doc.name}
          </SecureFileLink>
          <span className="text-xs text-muted-foreground hidden sm:block flex-shrink-0">{doc.uploaded_by_name}</span>
          <span className="text-xs text-muted-foreground hidden lg:block flex-shrink-0">
            {doc.created_at ? format(new Date(doc.created_at), 'MMM d, yyyy') : '—'}
          </span>
          {isInternal ? (
            <Select
              value={doc.status}
              onValueChange={v => statusMutation.mutate({ id: doc.id, status: v, ownerEmail: doc.uploaded_by_email })}
            >
              <SelectTrigger className="h-6 text-xs w-24 flex-shrink-0">
                <StatusBadge status={doc.status} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="In Review">In Review</SelectItem>
                <SelectItem value="Approved">Approved</SelectItem>
                <SelectItem value="Superseded">Superseded</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <span className="flex-shrink-0"><StatusBadge status={doc.status} /></span>
          )}
          {isInternal && (() => {
            const shared = doc.visibility == null || doc.visibility === 'public';
            return (
              <button
                onClick={() => visibilityMutation.mutate({ id: doc.id, visibility: shared ? 'private' : 'public' })}
                title={shared
                  ? 'Shared — external team members with folder access can see this. Click to make Internal only.'
                  : 'Internal only — admin / internal / pricing. Click to Share with external team.'}
                className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border transition-colors ${shared ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-muted text-muted-foreground border-border hover:bg-muted/70'}`}
              >
                {shared ? <Users className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                <span className="hidden md:inline">{shared ? 'Shared' : 'Internal'}</span>
              </button>
            );
          })()}
          {(/\.(pdf|png|jpg|jpeg|gif|webp|svg)$/i.test(doc.file_url || '')) && (
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewDoc(doc); }}
              title="Preview"
              className="flex-shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          )}
          <SecureFileLink value={doc.file_url} className="flex-shrink-0" title="Open file">
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
          </SecureFileLink>
          {isInternal && (
            <button
              className="flex-shrink-0 text-xs text-muted-foreground hover:text-primary transition-colors px-1 py-0.5 rounded border border-transparent hover:border-border"
              onClick={() => { setVersioningDoc(doc); setVersionFile(null); setVersionNotes(''); }}
              title="Upload new version"
            >
              v{doc.version_number || 1}
            </button>
          )}
          {isInternal && (
            <button
              className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setHistoryDoc(doc)}
              title="View history"
            >
              <History className="w-3.5 h-3.5" />
            </button>
          )}
          {isInternal && (
            <button
              className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => setDeleteDocId(doc.id)}
              title="Delete document"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </Draggable>
  );

  const renderDroppable = (key, label, isFolder) => {
    const items = grouped[key] || [];
    const isCollapsed = collapsedFolders[key];
    return (
      <div key={key} className="border rounded-lg overflow-hidden">
        <div
          className={`flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer select-none ${isFolder ? 'bg-muted/50 hover:bg-muted/70' : 'bg-background hover:bg-muted/20'}`}
          onClick={() => toggleFolder(key)}
        >
          {isCollapsed
            ? <ChevronRight className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          {isFolder
            ? (isCollapsed ? <Folder className="w-4 h-4 text-amber-500" /> : <FolderOpen className="w-4 h-4 text-amber-500" />)
            : <FileText className="w-4 h-4 text-muted-foreground" />}
          <span>{label}</span>
          <span className="ml-auto text-xs text-muted-foreground font-normal">{items.length} file{items.length !== 1 ? 's' : ''}</span>
        </div>
        {!isCollapsed && (
          <Droppable droppableId={key}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`min-h-[40px] transition-colors ${snapshot.isDraggingOver ? 'bg-primary/5 border-t border-dashed border-primary/30' : ''}`}
              >
                {items.length === 0 && (
                  <div className="text-center py-4 text-xs text-muted-foreground/60">
                    {isInternal ? 'Drop documents here' : 'No documents'}
                  </div>
                )}
                {items.map((doc, i) => renderDoc(doc, i))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        )}
      </div>
    );
  };

  return (
    <div
      className={`space-y-3 relative ${isDragOver ? 'ring-2 ring-primary ring-offset-2 rounded-lg' : ''}`}
      onDragOver={handleDragOverPanel}
      onDragLeave={handleDragLeavePanel}
      onDrop={handleDropPanel}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-lg pointer-events-none">
          <div className="text-center">
            <Upload className="w-8 h-8 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium text-primary">Drop files to upload</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {showArchived ? `${archivedCount} archived document${archivedCount !== 1 ? 's' : ''}` : `${visibleDocs.length} document${visibleDocs.length !== 1 ? 's' : ''}`}
        </p>
        <div className="flex items-center gap-2">
          {isInternal && archivedCount > 0 && (
            <Button size="sm" variant={showArchived ? 'secondary' : 'outline'}
              className="gap-1.5 h-8 text-xs"
              onClick={() => { clearSelection(); setShowArchived(v => !v); }}>
              <Archive className="w-3 h-3" />
              {showArchived ? 'Hide Archived' : `Archived (${archivedCount})`}
            </Button>
          )}
          {isInternal && !showArchived && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setShowNewFolder(true)}>
              <FolderPlus className="w-3 h-3" /> New Folder
            </Button>
          )}
          {!isExternal && !showArchived && (
            <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => {
              setUploadForm({ name: '', file: null, folder: '', visibility: 'public' });
              setShowUpload(true);
            }}>
              <Upload className="w-3 h-3" /> Upload
            </Button>
          )}
        </div>
      </div>

      {!isExternal && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Upload className="w-3 h-3" /> You can also drag & drop files directly onto this area
        </p>
      )}

      {/* Bulk action bar — internal only, shown when documents are selected */}
      {isInternal && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 border rounded-lg bg-primary/5 border-primary/30">
          <span className="text-sm font-medium flex items-center gap-1.5 mr-1">
            <CheckSquare className="w-4 h-4 text-primary" />
            {selectedIds.size} selected
          </span>
          {/* Move to folder */}
          <Select value="" onValueChange={(v) => bulkMoveMutation.mutate(v === '__unfiled__' ? null : v)} disabled={bulkBusy}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Move to folder…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__unfiled__">Unfiled</SelectItem>
              {folders.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Set status */}
          <Select value="" onValueChange={(v) => bulkStatusMutation.mutate(v)} disabled={bulkBusy}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Set status…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="In Review">In Review</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Superseded">Superseded</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setShowBulkDelete(true)} disabled={bulkBusy}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs ml-auto" onClick={clearSelection} disabled={bulkBusy}>
            Clear
          </Button>
        </div>
      )}

      {/* New Folder inline input */}
      {showNewFolder && (
        <div className="flex items-center gap-2 p-2 border rounded-lg bg-muted/20">
          <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <Input
            autoFocus
            className="h-7 text-sm"
            placeholder="Folder name"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newFolderName.trim()) createFolder();
              if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
            }}
          />
          <Button size="sm" className="h-7 text-xs" onClick={createFolder}>Create</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}>Cancel</Button>
        </div>
      )}

      {/* Search / filter */}
      {scopedDocs.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search documents by name, uploader, status or folder…"
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {docs.length === 0 && folders.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground border rounded-lg flex flex-col items-center gap-2">
          <FileText className="w-8 h-8 text-muted-foreground/40" />
          No documents yet. Upload one or drag & drop files here.
        </div>
      ) : search.trim() && visibleDocs.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground border rounded-lg flex flex-col items-center gap-2">
          <Search className="w-8 h-8 text-muted-foreground/40" />
          No documents match “{search.trim()}”.
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="space-y-2">
            {folders.map(f => renderDroppable(f, f, true))}
            {/* Unfiled: internal always; external when it holds shared docs they can see
                (RLS already limits external to shared/assigned docs on their projects). */}
            {isInternal && renderDroppable(UNFILED, 'Unfiled', false)}
          </div>
        </DragDropContext>
      )}

      {/* Document Preview */}
      <Dialog open={!!previewDoc} onOpenChange={open => !open && setPreviewDoc(null)}>
        <DialogContent className="max-w-4xl w-full h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b flex-shrink-0">
            <DialogTitle className="text-sm font-medium truncate">{previewDoc?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {previewDoc?.file_url && preview.loading && (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading preview…</div>
            )}
            {previewDoc?.file_url && preview.error && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-destructive">
                <span>Could not load preview. The link may have expired.</span>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => preview.refresh()}>
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh preview
                </Button>
              </div>
            )}
            {previewDoc?.file_url && preview.url && (
              /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(previewDoc.file_url) ? (
                <div className="flex items-center justify-center h-full p-4 bg-muted/30">
                  <img src={preview.url} alt={previewDoc.name} className="max-h-full max-w-full object-contain rounded" />
                </div>
              ) : (
                <iframe src={preview.url} title={previewDoc.name} className="w-full h-full border-0" />
              )
            )}
          </div>
          <div className="px-4 py-3 border-t flex justify-between flex-shrink-0">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <SecureFileLink value={previewDoc?.file_url}>Open in new tab</SecureFileLink>
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => preview.refresh()} title="Re-load the preview">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPreviewDoc(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Document History */}
      <Dialog open={!!historyDoc} onOpenChange={open => !open && setHistoryDoc(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-sm font-medium truncate flex items-center gap-2"><History className="w-4 h-4" /> History — {historyDoc?.name}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
            {historyLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading history…</p>
            ) : historyLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No recorded activity yet. New changes will appear here.</p>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-3 py-2">
                {historyLogs.map(log => (
                  <li key={log.id} className="ml-4">
                    <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-primary/60 border border-background" />
                    <p className="text-sm text-foreground">{log.description || log.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.user_name || 'Unknown'}
                      {log.created_at ? ` · ${format(new Date(log.created_at), 'MMM d, yyyy h:mm a')}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDoc(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Version Dialog */}
      <Dialog open={!!versioningDoc} onOpenChange={closeVersionDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Upload New Version — {versioningDoc?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Current version: v{versioningDoc?.version_number || 1}. The current file will be archived.</p>
            <div>
              <Label>New File *</Label>
              <Input type="file" onChange={e => setVersionFile(e.target.files[0])} />
            </div>
            <div>
              <Label>Revision Notes (optional)</Label>
              <Input value={versionNotes} onChange={e => setVersionNotes(e.target.value)} placeholder="What changed in this version?" />
            </div>
            {(versioningDoc?.versions || []).length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Version History</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {[...(versioningDoc?.versions || [])].reverse().map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1">
                      <span className="font-mono">v{v.version_number}</span>
                      <span className="text-muted-foreground">{v.uploaded_by_name}</span>
                      <SecureFileLink value={v.file_url} className="text-primary hover:underline">Download</SecureFileLink>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => closeVersionDialog(false)}>Cancel</Button>
            <Button onClick={handleNewVersion} disabled={!versionFile || versionUploading}>
              {versionUploading ? 'Uploading...' : 'Upload New Version'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDocId} onOpenChange={open => !open && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this document and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction
            onClick={() => { deleteMutation.mutate(deleteDocId); setDeleteDocId(null); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >Delete</AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={showBulkDelete} onOpenChange={open => !open && setShowBulkDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} document{selectedIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the selected documents and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction
            onClick={() => { bulkDeleteMutation.mutate(); setShowBulkDelete(false); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >Delete</AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={closeUploadDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Upload Document — {project.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Document Name *</Label>
              <Input value={uploadForm.name} onChange={e => setUploadForm({ ...uploadForm, name: e.target.value })} placeholder="Document name" />
            </div>
            <div>
              <Label>Folder</Label>
              <Select value={uploadForm.folder} onValueChange={v => setUploadForm({ ...uploadForm, folder: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="No folder (Unfiled)" /></SelectTrigger>
                <SelectContent>
                  {isInternal && <SelectItem value="__none__">No folder (Unfiled)</SelectItem>}
                  {(allowedFolders || allFolders).map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visibility</Label>
              <Select value={uploadForm.visibility} onValueChange={v => setUploadForm({ ...uploadForm, visibility: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Shared — all team members with folder access</SelectItem>
                  <SelectItem value="private">Internal only — admin / internal / pricing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>File *</Label>
              <Input type="file" onChange={e => setUploadForm({ ...uploadForm, file: e.target.files[0], name: uploadForm.name || e.target.files[0]?.name?.replace(/\.[^/.]+$/, '') })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={() => handleUpload()} disabled={uploading || !uploadForm.file || !uploadForm.name}>
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}