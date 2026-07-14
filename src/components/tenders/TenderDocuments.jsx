import { uploadFile } from '@/api/supabaseClient';
/**
 * TenderDocuments – Production-grade document package uploader.
 *
 * Drag & drop  →  walkEntry (webkitGetAsEntry, unlimited depth)
 * Select Folder →  webkitdirectory input + webkitRelativePath
 * Both feed into the same extractUploadPackage() pipeline.
 *
 * Pipeline:
 *   1. extractUploadPackage  – normalise, deduplicate folders, sort
 *   2. findDuplicates        – detect existing docs, prompt user
 *   3. createFolders         – create Folder records (parent-first, skip existing)
 *   4. runBatchUpload        – 5 concurrent uploads, retry 1s/2s/4s, collect failures
 *   5. save                  – append successDocs to tender.documents
 */

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, FileText, Loader2, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import DocTable from './DocTable';
import UploadProgressModal from './UploadProgressModal';
import FilePreviewModal from '@/components/shared/FilePreviewModal';
import {
  walkEntry,
  extractUploadPackage,
  findDuplicates,
  createFolders,
  runBatchUpload,
} from '@/lib/tenderUploadEngine';

const CATEGORIES = ['Plans', 'Specifications', 'Bill of Quantities', 'Schedule', 'Contract', 'Other'];

const INITIAL_STATE = {
  phase: 'idle',          // 'confirm-duplicates' | 'creating-folders' | 'uploading' | 'complete' | 'error'
  foldersTotal: 0,
  foldersCreated: 0,
  filesTotal: 0,
  filesUploaded: 0,
  failedCount: 0,
  currentFile: '',
  failedFiles: [],
  successDocs: [],
  duplicates: [],
  pendingPackage: null,   // { folders, files } waiting for duplicate decision
  pendingCategory: undefined, // category to apply once the pending package uploads
  duplicateAction: 'version',
  errorMessage: '',
};

export default function TenderDocuments({ tender, onUpdate, canManage }) {
  const [uploadState, setUploadState] = useState(INITIAL_STATE);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ name: '', category: 'Plans', files: [] });
  const [singleUploading, setSingleUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null); // { name, file_url } | null

  const folderInputRef = useRef(null);
  const docs = tender.documents || [];

  // ── Core upload pipeline ────────────────────────────────────────────────

  async function startUpload(pkg, duplicateAction, category) {
    const { folders, files } = pkg;
    const batchId = `batch_${Date.now()}`;

    setUploadState({
      ...INITIAL_STATE,
      phase: 'creating-folders',
      duplicateAction,
      foldersTotal: folders.length,
      filesTotal: files.length,
    });

    // Phase 5 – Create all folders before uploading any files
    let folderMap;
    try {
      folderMap = await createFolders(folders, tender.id, ({ foldersCreated }) => {
        setUploadState(s => ({ ...s, foldersCreated }));
      });
    } catch (err) {
      setUploadState(s => ({ ...s, phase: 'error', errorMessage: `Folder creation failed: ${err.message}` }));
      return;
    }

    // Phase 6 – Batch upload
    setUploadState(s => ({ ...s, phase: 'uploading' }));

    const { successDocs, failedFiles } = await runBatchUpload({
      files,
      folderMap,
      tenderId: tender.id,
      batchId,
      duplicateAction,
      existingDocs: docs,
      category,
      onProgress: ({ uploaded, failedCount, current }) => {
        setUploadState(s => ({
          ...s,
          ...(uploaded !== undefined && { filesUploaded: uploaded }),
          ...(failedCount !== undefined && { failedCount }),
          ...(current !== undefined && { currentFile: current }),
        }));
      },
    });

    // Save successDocs to tender
    if (successDocs.length > 0) {
      // For 'replace': remove old docs that share the same name+folder_path
      let updatedDocs = [...docs];
      if (duplicateAction === 'replace') {
        const replacedKeys = new Set(successDocs.map(d => `${d.folder_path || ''}|${d.name}`));
        updatedDocs = updatedDocs.filter(d => !replacedKeys.has(`${d.folder_path || ''}|${d.name}`));
      }
      await onUpdate({ documents: [...updatedDocs, ...successDocs] });
    }

    setUploadState(s => ({ ...s, phase: 'complete', successDocs, failedFiles }));
  }

  // Entry point for both drag-drop, folder picker, and the multi-file Upload
  // dialog. `category` is optional — only the Upload dialog supplies one
  // (drag-drop/folder-select default to 'Other', same as before).
  async function handleFilesCollected(filesWithRelPaths, category) {
    const pkg = extractUploadPackage(filesWithRelPaths);
    if (!pkg.files.length) return;

    const dups = findDuplicates(pkg.files, docs);
    if (dups.length > 0) {
      // Pause and ask user how to handle duplicates
      setUploadState({
        ...INITIAL_STATE,
        phase: 'confirm-duplicates',
        duplicates: dups,
        pendingPackage: pkg,
        pendingCategory: category,
        filesTotal: pkg.files.length,
        foldersTotal: pkg.folders.length,
      });
    } else {
      await startUpload(pkg, 'version', category);
    }
  }

  // ── Phase 2 – Drag & Drop ───────────────────────────────────────────────
  async function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    if (!canManage) return;

    const items = Array.from(e.dataTransfer.items || []);
    const allFiles = [];

    // Use webkitGetAsEntry() for full folder tree traversal
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        const found = await walkEntry(entry);
        allFiles.push(...found);
      }
    }

    // Fallback for browsers without FileSystem API
    if (!allFiles.length) {
      Array.from(e.dataTransfer.files).forEach(file => {
        allFiles.push({ file, relativePath: file.name });
      });
    }

    await handleFilesCollected(allFiles);
  }

  // ── Phase 3 – Select Folder ─────────────────────────────────────────────
  async function handleFolderSelect(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // reset so same folder can be re-selected
    if (!files.length) return;

    // webkitRelativePath = "RootFolder/Sub/file.pdf"
    const filesWithPaths = files.map(file => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));

    await handleFilesCollected(filesWithPaths);
  }

  // ── Duplicate resolution ─────────────────────────────────────────────────
  async function handleDuplicateAction(action) {
    const pkg = uploadState.pendingPackage;
    if (!pkg) return;
    await startUpload(pkg, action, uploadState.pendingCategory);
  }

  // ── Retry failed files (Phase 10) ────────────────────────────────────────
  async function handleRetryFailed() {
    const retryItems = uploadState.failedFiles.map(({ file, relativePath }) => ({ file, relativePath }));
    const pkg = extractUploadPackage(retryItems);
    await startUpload(pkg, uploadState.duplicateAction || 'version');
  }

  // ── Upload dialog submit ─────────────────────────────────────────────────
  // Single file with a custom name keeps the original named-upload behaviour.
  // Multiple files (or a single file left unnamed) route through the same
  // batch pipeline drag-drop/folder-select use, so they benefit from
  // duplicate detection, retry, and progress reporting for free.
  async function handleDialogUpload() {
    const files = uploadForm.files;
    if (!files.length) return;

    if (files.length === 1 && uploadForm.name.trim()) {
      setSingleUploading(true);
      try {
        // Tender packages are downloaded by unauthenticated suppliers on the public
        // portal — keep them in the public Documents bucket (permanent public URL).
        const { file_url } = await uploadFile(files[0], 'Documents');
        const newDoc = {
          name:        uploadForm.name,
          file_url,
          file_type:   files[0].name.split('.').pop()?.toUpperCase() || 'File',
          category:    uploadForm.category,
          folder_path: '',
          uploaded_at: new Date().toISOString(),
        };
        await onUpdate({ documents: [...docs, newDoc] });
        setShowUpload(false);
        setUploadForm({ name: '', category: 'Plans', files: [] });
      } catch (err) {
        alert(`Upload failed: ${err.message || 'Please try again'}`);
      } finally {
        setSingleUploading(false);
      }
      return;
    }

    // Multi-file path — batch pipeline (progress shown via UploadProgressModal)
    setShowUpload(false);
    const category = uploadForm.category;
    const filesWithRelPaths = files.map(file => ({ file, relativePath: file.name }));
    setUploadForm({ name: '', category: 'Plans', files: [] });
    await handleFilesCollected(filesWithRelPaths, category);
  }

  async function handleDelete(idx) {
    await onUpdate({ documents: docs.filter((_, i) => i !== idx) });
  }

  async function handleCategoryChange(idx, category) {
    await onUpdate({ documents: docs.map((d, i) => i === idx ? { ...d, category } : d) });
  }

  // ── Move a document between folders (Phase 7) ───────────────────────────
  // Tender documents live as a flat JSONB array with a `folder_path` string;
  // moving a file just rewrites that string (+ relative_path for consistency)
  // and re-saves the whole array. Best-effort keep `folder_id` in sync by
  // reusing another doc's folder_id for the same target path — display never
  // depends on it, only on folder_path.
  async function handleMove(idx, targetPath) {
    const normalizedTarget = (targetPath || '').replace(/\/+$/, '');
    const matchingFolderId = docs.find(d => (d.folder_path || '') === normalizedTarget)?.folder_id ?? null;
    const updatedDocs = docs.map((d, i) => {
      if (i !== idx) return d;
      const fileName = d.relative_path ? d.relative_path.split('/').pop() : d.name;
      return {
        ...d,
        folder_path: normalizedTarget,
        relative_path: normalizedTarget ? `${normalizedTarget}/${fileName}` : fileName,
        folder_id: normalizedTarget ? matchingFolderId : null,
      };
    });
    await onUpdate({ documents: updatedDocs });
  }

  // ── Download all as ZIP ──────────────────────────────────────────────────
  async function handleDownloadAll() {
    setDownloadingAll(true);
    try {
      const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
      const zip = new JSZip();
      const root = zip.folder(tender.title || 'Tender Documents');
      for (const doc of docs) {
        if (!doc.file_url) continue;
        try {
          const blob = await fetch(doc.file_url).then(r => r.blob());
          const ext = doc.file_url.split('.').pop().split('?')[0];
          const filePath = doc.folder_path
            ? `${doc.folder_path}/${doc.name || 'document'}.${ext}`
            : `${doc.name || 'document'}.${ext}`;
          root.file(filePath, blob);
        } catch (_) { /* skip failed fetches */ }
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
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      onDragOver={e => { e.preventDefault(); if (canManage) setIsDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={handleDrop}
      className={cn('relative rounded-lg transition-all', isDragOver && 'ring-2 ring-primary ring-offset-2')}
    >
      {/* Drag-over overlay */}
      {isDragOver && canManage && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-lg pointer-events-none">
          <Upload className="w-10 h-10 text-primary mb-2" />
          <p className="text-sm font-semibold text-primary">Drop files or folders here</p>
          <p className="text-xs text-muted-foreground mt-1">Folder structure will be preserved exactly</p>
        </div>
      )}

      {/* Hidden folder input — webkitdirectory preserves full paths */}
      <input
        ref={folderInputRef}
        type="file"
        {...{ webkitdirectory: '', directory: '' }}
        multiple
        className="hidden"
        onChange={handleFolderSelect}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          {docs.length} document{docs.length !== 1 ? 's' : ''}
          {canManage && (
            <span className="ml-2 text-xs">· drag &amp; drop files or folders to upload</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {docs.length > 0 && (
            <Button
              onClick={handleDownloadAll}
              disabled={downloadingAll}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {downloadingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloadingAll ? 'Preparing…' : `Download All (${docs.length})`}
            </Button>
          )}
          {canManage && (
            <>
              <Button
                onClick={() => folderInputRef.current?.click()}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <FolderOpen className="w-4 h-4" /> Select Folder
              </Button>
              <Button
                onClick={() => setShowUpload(true)}
                size="sm"
                className="gap-2"
              >
                <Upload className="w-4 h-4" /> Upload File
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Document table or empty state */}
      {docs.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-lg text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No documents uploaded yet</p>
          {canManage && (
            <p className="text-xs mt-1">Drag &amp; drop folders or use the buttons above</p>
          )}
        </div>
      ) : (
        <DocTable
          docs={docs}
          canManage={canManage}
          onCategoryChange={handleCategoryChange}
          onDelete={handleDelete}
          onPreview={doc => setPreviewDoc(doc)}
          onMove={handleMove}
        />
      )}

      {/* Document quick-look preview */}
      <FilePreviewModal
        url={previewDoc?.file_url}
        name={previewDoc?.name}
        open={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
      />

      {/* Upload progress / duplicate resolution modal */}
      <UploadProgressModal
        state={uploadState}
        onDuplicateAction={handleDuplicateAction}
        onRetryFailed={handleRetryFailed}
        onClose={() => setUploadState(INITIAL_STATE)}
      />

      {/* Upload File dialog — supports single (custom name) or multiple files */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Document{uploadForm.files.length > 1 ? 's' : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>File{uploadForm.files.length > 1 ? 's' : ''} *</Label>
              <Input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.png,.jpg,.jpeg,.zip"
                onChange={e => setUploadForm(f => ({ ...f, files: Array.from(e.target.files || []) }))}
              />
              {uploadForm.files.length > 1 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {uploadForm.files.length} files selected — each will keep its own filename.
                </p>
              )}
            </div>
            <div>
              <Label>Document Name {uploadForm.files.length <= 1 ? '*' : ''}</Label>
              <Input
                value={uploadForm.name}
                onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Architectural Plans Rev A"
                disabled={uploadForm.files.length > 1}
              />
              {uploadForm.files.length > 1 && (
                <p className="text-xs text-muted-foreground mt-1">Not used for multi-file uploads.</p>
              )}
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={uploadForm.category}
                onValueChange={v => setUploadForm(f => ({ ...f, category: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button
              onClick={handleDialogUpload}
              disabled={singleUploading || !uploadForm.files.length || (uploadForm.files.length === 1 && !uploadForm.name.trim())}
            >
              {singleUploading ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}