import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const PDF_EXT_RE = /\.pdf$/i;

/**
 * Reusable quick-look modal for images and PDFs, given a permanent public URL.
 * Modelled on ProjectDocsPanel's preview dialog, but simpler: the caller passes
 * a ready-to-use `url` directly (no signed-URL resolution needed) because
 * tender documents live in the public Documents bucket.
 */
export default function FilePreviewModal({ url, name, open, onClose }) {
  const isImage = IMAGE_EXT_RE.test(url || '');
  const isPdf = PDF_EXT_RE.test(url || '');

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose?.()}>
      <DialogContent className="max-w-4xl w-full h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b flex-shrink-0">
          <DialogTitle className="text-sm font-medium truncate">{name}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {!url ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No preview available.
            </div>
          ) : isImage ? (
            <div className="flex items-center justify-center h-full p-4 bg-muted/30">
              <img src={url} alt={name} className="max-h-full max-w-full object-contain rounded" />
            </div>
          ) : isPdf ? (
            <iframe src={url} title={name} className="w-full h-full border-0" />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Preview not available for this file type.
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t flex justify-between flex-shrink-0">
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
