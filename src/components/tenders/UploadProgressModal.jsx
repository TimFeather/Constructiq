import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Handles all phases of the upload UI in a single modal:
 *   confirm-duplicates → user picks action
 *   creating-folders   → folder creation progress
 *   uploading          → file upload progress
 *   complete           → summary + retry
 *   error              → fatal error display
 */
export default function UploadProgressModal({ state, onDuplicateAction, onRetryFailed, onClose }) {
  const {
    phase,
    foldersTotal,
    foldersCreated,
    filesTotal,
    filesUploaded,
    failedCount,
    currentFile,
    failedFiles,
    successDocs,
    duplicates,
    errorMessage,
  } = state;

  const isRunning = phase === 'creating-folders' || phase === 'uploading';
  const isComplete = phase === 'complete';
  const isError = phase === 'error';
  const showDuplicates = phase === 'confirm-duplicates';

  const progress = filesTotal > 0 ? Math.round((filesUploaded / filesTotal) * 100) : 0;

  function handleOpenChange(open) {
    // Prevent closing during active upload
    if (!open && isRunning) return;
    if (!open && (isComplete || isError || showDuplicates)) onClose();
  }

  return (
    <Dialog open={phase !== 'idle'} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md overflow-hidden"
        onPointerDownOutside={e => isRunning && e.preventDefault()}
        onEscapeKeyDown={e => isRunning && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRunning && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
            {isComplete && <CheckCircle2 className="w-4 h-4 text-green-600" />}
            {isError && <AlertTriangle className="w-4 h-4 text-destructive" />}
            {showDuplicates && <AlertTriangle className="w-4 h-4 text-amber-500" />}
            {showDuplicates
              ? 'Duplicate Files Detected'
              : isComplete
              ? 'Upload Complete'
              : isError
              ? 'Upload Failed'
              : 'Uploading Documents'}
          </DialogTitle>
        </DialogHeader>

        {/* ── PHASE: confirm-duplicates ── */}
        {showDuplicates && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <strong>{duplicates.length}</strong> file{duplicates.length !== 1 ? 's' : ''} already exist
              {duplicates.length === 1 ? 's' : ''} in this tender. How should duplicates be handled?
            </p>
            <div className="bg-muted rounded-lg p-3 max-h-36 overflow-y-auto space-y-0.5">
              {duplicates.map((d, i) => (
                <p key={i} className="text-xs font-mono text-muted-foreground break-all">{d}</p>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => onDuplicateAction('version')} className="justify-between">
                <span>Create New Version</span>
                <span className="text-xs opacity-70 font-normal">filename_v2, _v3 …</span>
              </Button>
              <Button variant="outline" onClick={() => onDuplicateAction('skip')} className="justify-between">
                <span>Skip Duplicates</span>
                <span className="text-xs opacity-70 font-normal">existing files unchanged</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => onDuplicateAction('replace')}
                className="justify-between border-destructive/40 text-destructive hover:bg-destructive/5"
              >
                <span>Replace Existing</span>
                <span className="text-xs opacity-70 font-normal">overwrites originals</span>
              </Button>
            </div>
          </div>
        )}

        {/* ── PHASE: creating-folders / uploading ── */}
        {isRunning && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Folders Created</p>
                <p className="text-2xl font-bold tabular-nums">{foldersCreated}</p>
                {foldersTotal > 0 && (
                  <p className="text-xs text-muted-foreground">of {foldersTotal}</p>
                )}
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Files Uploaded</p>
                <p className="text-2xl font-bold tabular-nums">{filesUploaded}</p>
                <p className="text-xs text-muted-foreground">of {filesTotal}</p>
              </div>
            </div>

            {currentFile && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground min-w-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 mt-0.5" />
                <span className="break-all font-mono text-xs min-w-0">{currentFile}</span>
              </div>
            )}

            {failedCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" />
                {failedCount} failed so far — continuing…
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {phase === 'creating-folders' ? 'Creating folder structure…' : 'Uploading files…'}
                </span>
                <span className="font-medium tabular-nums">{progress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── PHASE: complete ── */}
        {isComplete && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 border border-green-100 rounded-lg p-3">
                <p className="text-xs text-green-700 mb-1">Successfully Uploaded</p>
                <p className="text-2xl font-bold text-green-700 tabular-nums">
                  {successDocs?.length || 0}
                </p>
              </div>
              <div
                className={cn(
                  'rounded-lg p-3 border',
                  failedFiles?.length > 0
                    ? 'bg-red-50 border-red-100'
                    : 'bg-muted/50 border-transparent'
                )}
              >
                <p className={cn('text-xs mb-1', failedFiles?.length > 0 ? 'text-red-700' : 'text-muted-foreground')}>
                  Failed
                </p>
                <p className={cn('text-2xl font-bold tabular-nums', failedFiles?.length > 0 ? 'text-red-700' : 'text-muted-foreground')}>
                  {failedFiles?.length || 0}
                </p>
              </div>
            </div>

            {failedFiles?.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 max-h-48 overflow-y-auto overflow-x-hidden space-y-2">
                {failedFiles.map((f, i) => (
                  <div key={i} className="text-xs space-y-0.5">
                    <p className="text-destructive font-mono break-all">✗ {f.relativePath}</p>
                    {f.error && <p className="text-muted-foreground break-words pl-4">{f.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PHASE: error ── */}
        {isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">{errorMessage || 'An unexpected error occurred.'}</p>
          </div>
        )}

        <DialogFooter>
          {isComplete && (
            <>
              {failedFiles?.length > 0 && (
                <Button variant="outline" onClick={onRetryFailed} className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Retry Failed Files ({failedFiles.length})
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </>
          )}
          {isError && (
            <Button onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}