import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, Trash2, FileText, File } from 'lucide-react';
import { format } from 'date-fns';

const CATEGORIES = ['Plans', 'Specifications', 'Bill of Quantities', 'Schedule', 'Contract', 'Other'];

const FILE_ICONS = {
  pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  png: '🖼', jpg: '🖼', jpeg: '🖼', dwg: '📐', dxf: '📐',
};

function getExt(name) {
  return (name || '').split('.').pop()?.toLowerCase() || '';
}

export default function TenderDocuments({ tender, onUpdate, canManage }) {
  const { user } = useAuth();
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', category: 'Plans', file: null });
  const [uploading, setUploading] = useState(false);

  const docs = tender.documents || [];

  const handleUpload = async () => {
    if (!uploadForm.file || !uploadForm.name) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadForm.file });
      const newDoc = {
        name: uploadForm.name,
        file_url,
        file_type: uploadForm.file.name.split('.').pop()?.toUpperCase() || 'File',
        category: uploadForm.category,
        uploaded_at: new Date().toISOString(),
      };
      await onUpdate({ documents: [...docs, newDoc] });
      setShowUpload(false);
      setUploadForm({ name: '', category: 'Plans', file: null });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (idx) => {
    const updated = docs.filter((_, i) => i !== idx);
    await onUpdate({ documents: updated });
  };

  const handleCategoryChange = async (idx, category) => {
    const updated = docs.map((d, i) => i === idx ? { ...d, category } : d);
    await onUpdate({ documents: updated });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
        {canManage && (
          <Button onClick={() => setShowUpload(true)} className="gap-2" size="sm">
            <Upload className="w-4 h-4" /> Upload Document
          </Button>
        )}
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No documents uploaded yet</p>
          {canManage && <p className="text-xs mt-1">Upload plans, specs, BOQs and other tender documents</p>}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-44">Category</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-20 hidden sm:table-cell">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-28 hidden md:table-cell">Uploaded</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.map((doc, idx) => (
                <tr key={idx} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{FILE_ICONS[getExt(doc.name)] || '📎'}</span>
                      <span className="font-medium text-sm truncate max-w-[200px]">{doc.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <Select value={doc.category || 'Other'} onValueChange={v => handleCategoryChange(idx, v)}>
                        <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">{doc.category || 'Other'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{doc.file_type || getExt(doc.name).toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {doc.uploaded_at ? format(new Date(doc.uploaded_at), 'dd MMM yyyy') : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Download">
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                      {canManage && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(idx)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Document Name *</Label>
              <Input
                value={uploadForm.name}
                onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Architectural Plans Rev A"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={uploadForm.category} onValueChange={v => setUploadForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>File *</Label>
              <Input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.png,.jpg,.jpeg"
                onChange={e => setUploadForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
              />
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