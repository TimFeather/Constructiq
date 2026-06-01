import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Plus, Search, FileText, Upload, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import { format } from 'date-fns';

function getFileType(name) {
  if (!name) return 'Other';
  const ext = name.split('.').pop()?.toLowerCase();
  const map = { pdf: 'PDF', doc: 'DOCX', docx: 'DOCX', xls: 'Excel', xlsx: 'Excel', 
    png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', dwg: 'CAD', dxf: 'CAD' };
  return map[ext] || 'Other';
}

export default function Documents() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', project_id: '', file: null });
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'admin';

  const { data: allDocuments = [], isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => base44.entities.Document.list('-created_date', 200),
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100),
  });

  const projects = isAdmin
    ? allProjects
    : allProjects.filter(p => p.team?.some(m => m.user_email === user?.email));

  const projectIds = new Set(projects.map(p => p.id));
  const documents = allDocuments.filter(d => projectIds.has(d.project_id));

  const statusMutation = useMutation({
    mutationFn: ({ id, status, ownerEmail }) => {
      const promise = base44.entities.Document.update(id, { status });
      // Send email notification on status change
      if (ownerEmail) {
        base44.integrations.Core.SendEmail({
          to: ownerEmail,
          subject: `Document status changed to ${status}`,
          body: `A document you uploaded has been updated to status: ${status}.`
        });
      }
      return promise;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  const handleUpload = async () => {
    if (!uploadForm.file || !uploadForm.name || !uploadForm.project_id) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadForm.file });
    await base44.entities.Document.create({
      name: uploadForm.name,
      project_id: uploadForm.project_id,
      file_url,
      file_type: getFileType(uploadForm.file.name),
      status: 'Draft',
      uploaded_by_name: user?.full_name || 'Unknown',
      uploaded_by_email: user?.email || '',
    });
    queryClient.invalidateQueries({ queryKey: ['documents'] });
    setShowUpload(false);
    setUploadForm({ name: '', project_id: '', file: null });
    setUploading(false);
  };

  const filtered = documents.filter(d => {
    const matchSearch = d.name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Upload and manage project documents"
        actions={
          <Button onClick={() => setShowUpload(true)} className="gap-2">
            <Upload className="w-4 h-4" /> Upload Document
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="In Review">In Review</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Superseded">Superseded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No documents found" description="Upload your first document" actionLabel="Upload" onAction={() => setShowUpload(true)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b bg-muted/30">
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium hidden sm:table-cell">Project</th>
                    <th className="p-3 font-medium hidden md:table-cell">Type</th>
                    <th className="p-3 font-medium hidden md:table-cell">Uploaded By</th>
                    <th className="p-3 font-medium hidden lg:table-cell">Date</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(doc => (
                    <tr key={doc.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline flex items-center gap-1">
                          {doc.name} <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                      <td className="p-3 hidden sm:table-cell text-muted-foreground">
                        {projectMap[doc.project_id] || '—'}
                      </td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">{doc.file_type}</td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">{doc.uploaded_by_name}</td>
                      <td className="p-3 hidden lg:table-cell text-muted-foreground">
                        {format(new Date(doc.created_date), 'MMM d, yyyy')}
                      </td>
                      <td className="p-3">
                        <Select
                          value={doc.status}
                          onValueChange={v => statusMutation.mutate({ id: doc.id, status: v, ownerEmail: doc.uploaded_by_email })}
                        >
                          <SelectTrigger className="h-7 text-xs w-28">
                            <StatusBadge status={doc.status} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Draft">Draft</SelectItem>
                            <SelectItem value="In Review">In Review</SelectItem>
                            <SelectItem value="Approved">Approved</SelectItem>
                            <SelectItem value="Superseded">Superseded</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3">
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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
              <Select value={uploadForm.project_id} onValueChange={v => setUploadForm({...uploadForm, project_id: v})}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>File *</Label>
              <Input type="file" onChange={e => setUploadForm({...uploadForm, file: e.target.files[0]})} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadForm.file || !uploadForm.name || !uploadForm.project_id}>
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}