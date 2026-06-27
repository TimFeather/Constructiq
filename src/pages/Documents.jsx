import { uploadFile, sendEmail } from '@/api/supabaseClient';
import React, { useState } from 'react';
import { Document, Project } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { Search, FileText, Upload, ExternalLink, Folder, ArrowLeft, Calendar, FolderOpen, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import ProjectDocsPanel from '@/components/documents/ProjectDocsPanel';
import { format } from 'date-fns';
import { normalizeEmail } from '@/lib/normalizeEmail';

function getFileType(name) {
  if (!name) return 'Other';
  const ext = name.split('.').pop()?.toLowerCase();
  const map = { pdf: 'PDF', doc: 'DOCX', docx: 'DOCX', xls: 'Excel', xlsx: 'Excel', 
    png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', dwg: 'CAD', dxf: 'CAD' };
  return map[ext] || 'Other';
}

export default function Documents() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [folderFilter, setFolderFilter] = useState('all');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', project_id: '', file: null, folder: '' });
  const [newFolder, setNewFolder] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [viewMode, setViewMode] = useState('active');
  const queryClient = useQueryClient();

  const isAdmin = ['admin', 'internal', 'pricing'].includes(user?.role);

  const { data: allDocuments = [], isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => Document.list('-created_at', 200),
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => Project.list('-created_at', 100),
  });

  const projects = isAdmin
    ? allProjects
    : allProjects.filter(p => p.team?.some(m => normalizeEmail(m.user_email) === normalizeEmail(user?.email)));

  const projectIds = new Set(projects.map(p => p.id));
  const allVisibleDocs = allDocuments.filter(d => projectIds.has(d.project_id));
  const documents = viewMode === 'archived'
    ? allVisibleDocs.filter(d => d.archived)
    : allVisibleDocs.filter(d => !d.archived);
  const activeDocCount = allVisibleDocs.filter(d => !d.archived).length;
  const archivedDocCount = allVisibleDocs.filter(d => d.archived).length;

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => Document.update(id, { status }),
    onSuccess: (_, { status, ownerEmail }) => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      if (ownerEmail) {
        sendEmail({
          to: ownerEmail,
          subject: `Document status changed to ${status}`,
          body: `A document you uploaded has been updated to status: ${status}.`,
        }).catch((err) => {
          console.warn('[Documents] Status notification failed:', err?.message);
        });
      }
    },
  });

  const handleUpload = async () => {
    if (!uploadForm.file || !uploadForm.name || !uploadForm.project_id) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const folder = uploadForm.folder === '__new__'
        ? newFolder.trim()
        : (uploadForm.folder || undefined);
      const { file_url } = await uploadFile(uploadForm.file, 'Documents', setUploadPct);
      await Document.create({
        name: uploadForm.name,
        project_id: uploadForm.project_id,
        folder: folder || undefined,
        file_url,
        file_type: getFileType(uploadForm.file.name),
        status: 'Draft',
        uploaded_by_name: user?.full_name || 'Unknown',
        uploaded_by_email: user?.email || '',
      });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowUpload(false);
      setUploadForm({ name: '', project_id: '', file: null, folder: '' });
      setNewFolder('');
    } catch (err) {
      console.error('Upload failed:', err);
      toast({ title: 'Upload failed', description: err?.message || 'Please check your connection and try again.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  // Folders available for selected project
  const projectFolders = [...new Set(documents.filter(d => d.project_id === uploadForm.project_id).map(d => d.folder).filter(Boolean))].sort();

  const allFolders = [...new Set(documents.map(d => d.folder).filter(Boolean))].sort();

  const filtered = documents.filter(d => {
    const matchSearch = d.name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || d.status === statusFilter;
    const matchProject = projectFilter === 'all' || d.project_id === projectFilter;
    const matchFolder = folderFilter === 'all' ? true : folderFilter === '__none__' ? !d.folder : d.folder === folderFilter;
    return matchSearch && matchStatus && matchProject && matchFolder;
  });

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
  const selectedProject = projectFilter !== 'all' ? projects.find(p => p.id === projectFilter) : null;
  const selectedProjectDocs = selectedProject ? documents.filter(d => d.project_id === selectedProject.id) : [];

  return (
    <div>
      {selectedProject ? (
        <>
          {/* Project docs view */}
          <div className="flex items-center gap-2 mb-4">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setProjectFilter('all')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold text-foreground cursor-pointer hover:text-primary hover:underline" onClick={() => setProjectFilter('all')}>Documents</span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm font-medium">{selectedProject.name}</span>
          </div>
          <PageHeader
            title={selectedProject.name}
            description="Project documents"
            actions={
              isAdmin ? (
                <Button onClick={() => setShowUpload(true)} className="gap-2">
                  <Upload className="w-4 h-4" /> Upload Document
                </Button>
              ) : null
            }
          />
          <ProjectDocsPanel project={selectedProject} docs={selectedProjectDocs} />
        </>
      ) : (
        <>
          {/* Project grid view */}
          <PageHeader
            title="Documents"
            description="Select a project to view its documents"
          />
          <div className="flex gap-2 mb-4">
            <Button
              variant={viewMode === 'active' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('active')}
            >
              Active {activeDocCount > 0 && `(${activeDocCount})`}
            </Button>
            <Button
              variant={viewMode === 'archived' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('archived')}
            >
              <Archive className="w-3.5 h-3.5 mr-1.5" />
              Archived {archivedDocCount > 0 && `(${archivedDocCount})`}
            </Button>
          </div>
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 max-w-sm" />
          </div>
          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3].map(i => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-5 space-y-3">
                    <div className="h-5 bg-muted rounded w-3/4" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                    <div className="h-4 bg-muted rounded w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : projects.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()) && documents.some(d => d.project_id === p.id)).length === 0 && viewMode === 'archived' ? (
            <EmptyState icon={Archive} title="No archived documents" description="Archived documents will appear here when a project is archived" />
          ) : projects.filter(p => p.name?.toLowerCase().includes(search.toLowerCase())).length === 0 ? (
            <EmptyState icon={FolderOpen} title="No projects found" description="Projects will appear here once created" />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.filter(p => p.name?.toLowerCase().includes(search.toLowerCase())).map(project => {
                const docCount = documents.filter(d => d.project_id === project.id).length;
                return (
                  <Card
                    key={project.id}
                    className="hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 cursor-pointer h-full"
                    onClick={() => setProjectFilter(project.id)}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-semibold text-foreground truncate pr-2">{project.name}</h3>
                        <StatusBadge status={project.status} />
                      </div>
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {project.start_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(project.start_date), 'MMM d, yyyy')}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {docCount} {docCount === 1 ? 'document' : 'documents'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Document Name *</Label>
              <Input value={uploadForm.name} onChange={e => setUploadForm({...uploadForm, name: e.target.value})} placeholder="Document name" />
            </div>
            <div>
              <Label>Project *</Label>
              <Select value={uploadForm.project_id} onValueChange={v => setUploadForm({...uploadForm, project_id: v, folder: ''})}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Folder</Label>
              <Select value={uploadForm.folder} onValueChange={v => setUploadForm({...uploadForm, folder: v})}>
                <SelectTrigger><SelectValue placeholder="No folder" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No folder</SelectItem>
                  {projectFolders.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  <SelectItem value="__new__">+ Create new folder…</SelectItem>
                </SelectContent>
              </Select>
              {uploadForm.folder === '__new__' && (
                <Input
                  className="mt-2"
                  placeholder="New folder name"
                  value={newFolder}
                  onChange={e => setNewFolder(e.target.value)}
                />
              )}
            </div>
            <div>
              <Label>File *</Label>
              <Input type="file" onChange={e => setUploadForm({...uploadForm, file: e.target.files[0]})} />
            </div>
          </div>
          {uploading && (
            <div className="space-y-1 px-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Uploading…</span><span>{uploadPct}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all duration-200" style={{ width: `${uploadPct}%` }} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadForm.file || !uploadForm.name || !uploadForm.project_id}>
              {uploading ? `Uploading ${uploadPct}%…` : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}