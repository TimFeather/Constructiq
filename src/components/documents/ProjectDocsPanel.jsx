import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import StatusBadge from '@/components/shared/StatusBadge';
import { Upload, ExternalLink, FileText, Folder } from 'lucide-react';
import { format } from 'date-fns';

function getFileType(name) {
  if (!name) return 'Other';
  const ext = name.split('.').pop()?.toLowerCase();
  const map = { pdf: 'PDF', doc: 'DOCX', docx: 'DOCX', xls: 'Excel', xlsx: 'Excel',
    png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', dwg: 'CAD', dxf: 'CAD' };
  return map[ext] || 'Other';
}

export default function ProjectDocsPanel({ project, docs = [] }) {
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', file: null, folder: '' });
  const [newFolder, setNewFolder] = useState('');
  const [uploading, setUploading] = useState(false);

  // Derive existing folders for this project's docs
  const folders = [...new Set(docs.map(d => d.folder).filter(Boolean))].sort();
  const queryClient = useQueryClient();

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', project.id] }),
  });

  const handleUpload = async () => {
    if (!uploadForm.file || !uploadForm.name) return;
    setUploading(true);
    const folder = uploadForm.folder === '__new__' ? newFolder.trim() : uploadForm.folder;
    const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadForm.file });
    await base44.entities.Document.create({
      name: uploadForm.name,
      project_id: project.id,
      folder: folder || undefined,
      file_url,
      file_type: getFileType(uploadForm.file.name),
      status: 'Draft',
      uploaded_by_name: user?.full_name || 'Unknown',
      uploaded_by_email: user?.email || '',
    });
    queryClient.invalidateQueries({ queryKey: ['documents', project.id] });
    queryClient.invalidateQueries({ queryKey: ['documents'] });
    setShowUpload(false);
    setUploadForm({ name: '', file: null, folder: '' });
    setNewFolder('');
    setUploading(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
        <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setShowUpload(true)}>
          <Upload className="w-3 h-3" /> Upload
        </Button>
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg flex flex-col items-center gap-2">
          <FileText className="w-8 h-8 text-muted-foreground/40" />
          No documents for this project yet.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b bg-muted/30">
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium hidden sm:table-cell">Folder</th>
                    <th className="p-3 font-medium hidden md:table-cell">Uploaded By</th>
                    <th className="p-3 font-medium hidden lg:table-cell">Date</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {docs.map(doc => (
                    <tr key={doc.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                          className="font-medium text-primary hover:underline flex items-center gap-1">
                          {doc.name} <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                      <td className="p-3 hidden sm:table-cell text-muted-foreground">
                        {doc.folder ? (
                          <span className="flex items-center gap-1"><Folder className="w-3 h-3" />{doc.folder}</span>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
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
          <DialogHeader><DialogTitle>Upload Document — {project.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Document Name *</Label>
              <Input value={uploadForm.name} onChange={e => setUploadForm({ ...uploadForm, name: e.target.value })} placeholder="Document name" />
            </div>
            <div>
              <Label>Folder</Label>
              <Select value={uploadForm.folder} onValueChange={v => setUploadForm({ ...uploadForm, folder: v })}>
                <SelectTrigger><SelectValue placeholder="No folder" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No folder</SelectItem>
                  {folders.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
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