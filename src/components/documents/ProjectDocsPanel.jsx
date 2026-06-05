import React, { useState, useRef } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import StatusBadge from '@/components/shared/StatusBadge';
import { Upload, ExternalLink, FileText, Folder, FolderOpen, Plus, GripVertical, ChevronDown, ChevronRight, FolderPlus, Trash2, Eye } from 'lucide-react';
import { format } from 'date-fns';

function getFileType(name) {
  if (!name) return 'Other';
  const ext = name.split('.').pop()?.toLowerCase();
  const map = { pdf: 'PDF', doc: 'DOCX', docx: 'DOCX', xls: 'Excel', xlsx: 'Excel',
    png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', dwg: 'CAD', dxf: 'CAD' };
  return map[ext] || 'Other';
}

const UNFILED = '__unfiled__';

const DEFAULT_FOLDERS = [
  'Architectural Plans',
  'Engineering Drawings',
  'Geotech Reports',
  'Photos',
  'Sub Contractor Uploads',
];

const SUBCONTRACTOR_FOLDER = 'Sub Contractor Uploads';

export default function ProjectDocsPanel({ project, docs = [] }) {
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', file: null, folder: '' });
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
  const dropZoneRef = useRef(null);
  const queryClient = useQueryClient();

  const isInternal = user?.role === 'admin' || user?.role === 'internal';
  const isExternal = !isInternal;
  const allowedFolders = isInternal ? null : [SUBCONTRACTOR_FOLDER];

  // Folders that have docs (for filtering external view)
  const foldersWithDocs = new Set(docs.map(d => d.folder).filter(Boolean));

  const docFolders = docs.map(d => d.folder).filter(Boolean);
  const allFolders = [...new Set([...DEFAULT_FOLDERS, ...docFolders, ...extraFolders])];
  // For external users, only show folders that have docs
  const folders = isExternal
    ? allFolders.filter(f => foldersWithDocs.has(f))
    : allFolders;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['documents', project.id] });
    queryClient.invalidateQueries({ queryKey: ['documents'] });
  };

  const moveMutation = useMutation({
    mutationFn: ({ id, folder }) => base44.entities.Document.update(id, { folder: folder || null }),
    onSuccess: invalidate,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, ownerEmail }) => {
      const promise = base44.entities.Document.update(id, { status });
      if (ownerEmail) {
        base44.integrations.Core.SendEmail({
          to: ownerEmail,
          subject: `Document status changed to ${status}`,
          body: `A document you uploaded has been updated to status: ${status}.`,
        });
      }
      return promise;
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Document.delete(id),
    onSuccess: invalidate,
  });

  const handleUpload = async (file, folder) => {
    const f = file || uploadForm.file;
    const docName = f?.name?.replace(/\.[^/.]+$/, '') || uploadForm.name;
    if (!f || !docName) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file: f });
    await base44.entities.Document.create({
      name: docName,
      project_id: project.id,
      folder: folder || uploadForm.folder || undefined,
      file_url,
      file_type: getFileType(f.name),
      status: 'Draft',
      uploaded_by_name: user?.full_name || 'Unknown',
      uploaded_by_email: user?.email || '',
    });
    invalidate();
    setShowUpload(false);
    setUploadForm({ name: '', file: null, folder: '' });
    setUploading(false);
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
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await handleUpload(file, allowedFolders ? allowedFolders[0] : '');
    }
  };

  const handleNewVersion = async () => {
    if (!versionFile || !versioningDoc) return;
    setVersionUploading(true);
    const { file_url: newFileUrl } = await base44.integrations.Core.UploadFile({ file: versionFile });
    const existingVersions = versioningDoc.versions || [];
    await base44.entities.Document.update(versioningDoc.id, {
      file_url: newFileUrl,
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
    invalidate();
    setVersioningDoc(null);
    setVersionFile(null);
    setVersionNotes('');
    setVersionUploading(false);
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

  const grouped = {};
  folders.forEach(f => { grouped[f] = []; });
  grouped[UNFILED] = [];
  docs.forEach(d => {
    const key = d.folder && allFolders.includes(d.folder) ? d.folder : UNFILED;
    grouped[key].push(d);
  });

  const renderDoc = (doc, index) => (
    <Draggable key={doc.id} draggableId={doc.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`flex items-center gap-2 px-3 py-2 text-sm border-b last:border-b-0 bg-card transition-colors ${snapshot.isDragging ? 'shadow-lg opacity-80' : 'hover:bg-muted/30'}`}
        >
          <span {...(isInternal ? provided.dragHandleProps : {})} className={`flex-shrink-0 ${isInternal ? 'text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing' : 'invisible w-4'}`}>
            {isInternal && <GripVertical className="w-4 h-4" />}
          </span>
          <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
            className="font-medium text-primary hover:underline flex items-center gap-1 flex-1 min-w-0 truncate">
            {doc.name}
          </a>
          <span className="text-xs text-muted-foreground hidden sm:block flex-shrink-0">{doc.uploaded_by_name}</span>
          <span className="text-xs text-muted-foreground hidden lg:block flex-shrink-0">
            {format(new Date(doc.created_date), 'MMM d, yyyy')}
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
          {(/\.(pdf|png|jpg|jpeg|gif|webp|svg)$/i.test(doc.file_url || '')) && (
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewDoc(doc); }}
              title="Preview"
              className="flex-shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          )}
          <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
          </a>
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
        <p className="text-sm text-muted-foreground">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          {isInternal && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setShowNewFolder(true)}>
              <FolderPlus className="w-3 h-3" /> New Folder
            </Button>
          )}
          {!isExternal && (
            <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => {
              setUploadForm({ name: '', file: null, folder: '' });
              setShowUpload(true);
            }}>
              <Upload className="w-3 h-3" /> Upload
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Upload className="w-3 h-3" /> You can also drag & drop files directly onto this area
      </p>

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
              if (e.key === 'Enter' && newFolderName.trim()) {
                setExtraFolders(prev => [...new Set([...prev, newFolderName.trim()])]);
                setShowNewFolder(false);
                setNewFolderName('');
              }
              if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
            }}
          />
          <Button size="sm" className="h-7 text-xs" onClick={() => {
            if (newFolderName.trim()) setExtraFolders(prev => [...new Set([...prev, newFolderName.trim()])]);
            setShowNewFolder(false);
            setNewFolderName('');
          }}>Create</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}>Cancel</Button>
        </div>
      )}

      {docs.length === 0 && folders.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground border rounded-lg flex flex-col items-center gap-2">
          <FileText className="w-8 h-8 text-muted-foreground/40" />
          No documents yet. Upload one or drag & drop files here.
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="space-y-2">
            {folders.map(f => renderDroppable(f, f, true))}
            {/* Show unfiled only for internal */}
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
            {previewDoc?.file_url && (
              /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(previewDoc.file_url) ? (
                <div className="flex items-center justify-center h-full p-4 bg-muted/30">
                  <img src={previewDoc.file_url} alt={previewDoc.name} className="max-h-full max-w-full object-contain rounded" />
                </div>
              ) : (
                <iframe src={previewDoc.file_url} title={previewDoc.name} className="w-full h-full border-0" />
              )
            )}
          </div>
          <div className="px-4 py-3 border-t flex justify-between flex-shrink-0">
            <Button variant="outline" size="sm" asChild>
              <a href={previewDoc?.file_url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPreviewDoc(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Version Dialog */}
      <Dialog open={!!versioningDoc} onOpenChange={open => !open && setVersioningDoc(null)}>
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
                      <a href={v.file_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Download</a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersioningDoc(null)}>Cancel</Button>
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

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
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