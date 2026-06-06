import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, Trash2, FileText, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const CATEGORIES = ['Plans', 'Specifications', 'Bill of Quantities', 'Schedule', 'Contract', 'Other'];

const FILE_ICONS = {
  pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  png: '🖼', jpg: '🖼', jpeg: '🖼', dwg: '📐', dxf: '📐', zip: '🗜',
};

const ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'zip'];

function getExt(name) {
  return (name || '').split('.').pop()?.toLowerCase() || '';
}

export default function TenderDocuments({ tender, onUpdate, canManage }) {
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', category: 'Plans', file: null });
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  const docs = tender.documents || [];

  const uploadFiles = async (files) => {
    if (!files.length) return;
    setUploading(true);
    setUploadProgress({ current: 0, total: files.length });
    const newDocs = [];
    let i = 0;
    for (const file of files) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      newDocs.push({
        name: file.name.replace(/\.[^.]+$/, ''),
        file_url,
        file_type: (file.name.split('.').pop() || 'File').toUpperCase(),
        category: 'Other',
        uploaded_at: new Date().toISOString(),
      });
      i++;
      setUploadProgress({ current: i, total: files.length });
    }
    await onUpdate({ documents: [...docs, ...newDocs] });
    setUploading(false);
    setUploadProgress({ current: 0, total: 0 });
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!canManage) return;
    const files = Array.from(e.dataTransfer.files).filter(f => ALLOWED_EXTS.includes(getExt(f.name)));
    await uploadFiles(files);
  };

  const handleUpload = async () => {
    if (!uploadForm.file || !uploadForm.name) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file: uploadForm.file });
    const newDoc = {
      name: uploadForm.name,
      file_url,
      file_type: uploadForm.file.name.split('.').pop()?.toUpperCase() || 'File',
      category: uploadForm.category,
      uploaded_at: new Date().toISOString(),
    };
    await onUpdate({ documents: [...docs, newDoc] });
    setUploading(false);
    setShowUpload(false);
    setUploadForm({ name: '', category: 'Plans', file: null });
  };

  const handleDelete = async (idx) => {
    await onUpdate({ documents: docs.filter((_, i) => i !== idx) });
  };

  const handleCategoryChange = async (idx, category) => {
    await onUpdate({ documents: docs.map((d, i) => i === idx ? { ...d, category } : d) });
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
      const zip = new JSZip();
      const folder = zip.folder(tender.title || 'Tender Documents');

      for (const doc of docs) {
        if (!doc.file_url) continue;
        try {
          const response = await fetch(doc.file_url);
          const blob = await response.blob();
          const ext = doc.file_url.split('.').pop().split('?')[0];
          folder.file(`${doc.name || 'document'}.${ext}`, blob);
        } catch (_e) { /* skip failed files */ }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tender.tender_number || 'TDR'} - ${tender.title || 'Documents'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed: ' + err.message);
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (canManage) setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-lg transition-all',
        isDragOver && 'ring-2 ring-primary ring-offset-2'
      )}
    >
      {/* Drag overlay */}
      {isDragOver && canManage && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-lg pointer-events-none">
          <Upload className="w-10 h-10 text-primary mb-2" />
          <p className="text-sm font-semibold text-primary">Drop files to upload</p>
          <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, DWG, ZIP, Images</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          {docs.length} document{docs.length !== 1 ? 's' : ''}
          {canManage && <span className="ml-2 text-xs">· drag &amp; drop files anywhere</span>}
        </p>
        <div className="flex items-center gap-2">
          {docs.length > 0 && (
            <Button onClick={handleDownloadAll} disabled={downloadingAll} variant="outline" size="sm" className="gap-2">
              {downloadingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloadingAll ? 'Preparing...' : `Download All (${docs.length})`}
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setShowUpload(true)} disabled={uploading} className="gap-2" size="sm">
              <Upload className="w-4 h-4" /> {uploading ? 'Uploading...' : 'Upload Document'}
            </Button>
          )}
        </div>
      </div>

      {/* Upload progress */}
      {uploadProgress.total > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-blue-800 mb-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Uploading {uploadProgress.current} of {uploadProgress.total} files...
          </div>
          <div className="w-full bg-blue-200 rounded-full h-1.5">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all"
              style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {docs.length === 0 ? (
        <div className={cn(
          'text-center py-16 border-2 border-dashed rounded-lg text-muted-foreground transition-colors',
          canManage ? 'cursor-default' : ''
        )}>
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No documents uploaded yet</p>
          {canManage && (
            <p className="text-xs mt-1">Upload files using the button above or drag &amp; drop here</p>
          )}
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
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                      {doc.file_type || getExt(doc.name).toUpperCase()}
                    </span>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(idx)}>
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
                accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.png,.jpg,.jpeg,.zip"
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