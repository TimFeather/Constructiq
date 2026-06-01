import React, { useState } from 'react';
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
import { Upload, ExternalLink, FileText, Folder, FolderOpen, Plus, GripVertical, ChevronDown, ChevronRight, FolderPlus } from 'lucide-react';
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

const INTERNAL_ROLES = ['Architect', 'Internal Project Manager', 'Site Manager', 'Quantity Surveyor'];
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
  const queryClient = useQueryClient();

  // Determine user's role on this project
  const teamMember = project?.team?.find(m => m.user_email === user?.email);
  const isInternal = user?.role === 'admin' || INTERNAL_ROLES.includes(teamMember?.role);
  // External users can only upload to Sub Contractor Uploads
  const allowedFolders = isInternal ? null : [SUBCONTRACTOR_FOLDER]; // null = all folders

  // Derive folder list: default folders + any from docs + any locally created extras
  const docFolders = docs.map(d => d.folder).filter(Boolean);
  const folders = [...new Set([...DEFAULT_FOLDERS, ...docFolders, ...extraFolders])];

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

  const handleUpload = async () => {
    if (!uploadForm.file || !uploadForm.name) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadForm.file });
    await base44.entities.Document.create({
      name: uploadForm.name,
      project_id: project.id,
      folder: uploadForm.folder || undefined,
      file_url,
      file_type: getFileType(uploadForm.file.name),
      status: 'Draft',
      uploaded_by_name: user?.full_name || 'Unknown',
      uploaded_by_email: user?.email || '',
    });
    invalidate();
    setShowUpload(false);
    setUploadForm({ name: '', file: null, folder: '' });
    setUploading(false);
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

  // Group docs
  const grouped = {};
  folders.forEach(f => { grouped[f] = []; });
  grouped[UNFILED] = [];
  docs.forEach(d => {
    const key = d.folder && folders.includes(d.folder) ? d.folder : UNFILED;
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
          <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
          </a>
        </div>
      )}
    </Draggable>
  );

  const renderDroppable = (key, label, isFolder) => {
    const items = grouped[key] || [];
    const isCollapsed = collapsedFolders[key];
    return (
      <div key={key} className="border rounded-lg overflow-hidden">
        {/* Folder header */}
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

        {/* Droppable area */}
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
                    Drop documents here
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
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          {isInternal && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setShowNewFolder(true)}>
              <FolderPlus className="w-3 h-3" /> New Folder
            </Button>
          )}
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => {
            setUploadForm({ name: '', file: null, folder: allowedFolders ? allowedFolders[0] : '' });
            setShowUpload(true);
          }}>
            <Upload className="w-3 h-3" /> Upload
          </Button>
        </div>
      </div>

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
            if (newFolderName.trim()) {
              setExtraFolders(prev => [...new Set([...prev, newFolderName.trim()])]);
            }
            setShowNewFolder(false);
            setNewFolderName('');
          }}>Create</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}>Cancel</Button>
        </div>
      )}

      {docs.length === 0 && folders.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground border rounded-lg flex flex-col items-center gap-2">
          <FileText className="w-8 h-8 text-muted-foreground/40" />
          No documents yet. Upload one or create a folder.
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="space-y-2">
            {/* Named folders */}
            {folders.map(f => renderDroppable(f, f, true))}
            {/* Unfiled */}
            {renderDroppable(UNFILED, 'Unfiled', false)}
          </div>
        </DragDropContext>
      )}

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
                  {(allowedFolders || folders).map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>File *</Label>
              <Input type="file" onChange={e => setUploadForm({ ...uploadForm, file: e.target.files[0] })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadForm.file || !uploadForm.name}>
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}