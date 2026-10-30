import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, RefreshCw, FileText, ExternalLink } from 'lucide-react';
import { getSignedUrl, isStoredUrl } from '@/api/supabaseClient';
import SecureFileLink from '@/components/shared/SecureFileLink';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const PDF_EXT_RE = /\.pdf$/i;
export const PREVIEWABLE_RE = /\.(pdf|png|jpe?g|gif|webp|svg)$/i;

const SIGN_EXPIRY = 28800; // 8 hours — long enough that a preview left open does not expire
const CACHE_TTL_MS = 7 * 60 * 60 * 1000; // re-sign before the signed URL itself expires
const SWIPE_MIN_PX = 50;

const itemKey = (item) => item?.id ?? item?.file_url;
const fileRef = (item) => (item?.file_url || '').split('?')[0];

/**
 * Quick-look modal for images and PDFs that can flick through a list of files.
 *
 *   items    — the previewable files, in on-screen order ({ id?, name, file_url }).
 *   current  — the item being shown (null = closed).
 *   onChange — called with the next/previous item.
 *   bucket   — storage bucket used to sign bare storage paths. Full URLs (e.g. the
 *              public tender Documents bucket) are used as-is.
 *
 * Navigate with the arrow buttons, ← / → keys, or a swipe on touch screens.
 * Signed URLs are cached per file and neighbouring images are preloaded, so
 * flicking back and forth through photos is instant.
 */
export default function FilePreviewModal({ items = [], current, onChange, onClose, bucket = 'project-files' }) {
  const open = !!current;
  const index = current ? items.findIndex(i => itemKey(i) === itemKey(current)) : -1;
  const count = items.length;
  const hasPrev = index > 0;
  const hasNext = index > -1 && index < count - 1;

  // file_url → { url, at } — signed URLs survive flicking back and forth.
  const cacheRef = useRef(new Map());
  const [state, setState] = useState({ url: null, loading: false, error: null });
  const [refreshKey, setRefreshKey] = useState(0);

  const resolve = useCallback(async (value) => {
    if (!value) return null;
    if (isStoredUrl(value)) return value;
    const hit = cacheRef.current.get(value);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.url;
    const url = await getSignedUrl(bucket, value, SIGN_EXPIRY);
    cacheRef.current.set(value, { url, at: Date.now() });
    return url;
  }, [bucket]);

  const value = current?.file_url;
  useEffect(() => {
    let cancelled = false;
    if (!value) { setState({ url: null, loading: false, error: null }); return; }
    setState({ url: isStoredUrl(value) ? value : null, loading: !isStoredUrl(value), error: null });
    resolve(value)
      .then(url => { if (!cancelled) setState({ url, loading: false, error: null }); })
      .catch(error => { if (!cancelled) setState({ url: null, loading: false, error }); });
    return () => { cancelled = true; };
  }, [value, resolve, refreshKey]);

  // Preload the neighbouring images so the next flick shows immediately.
  useEffect(() => {
    if (!open || index < 0) return;
    [items[index - 1], items[index + 1]].forEach(n => {
      if (!n?.file_url || !IMAGE_EXT_RE.test(fileRef(n))) return;
      resolve(n.file_url).then(url => { if (url) new Image().src = url; }).catch(() => {});
    });
  }, [open, index, items, resolve]);

  const go = useCallback((delta) => {
    const next = items[index + delta];
    if (next) onChange?.(next);
  }, [items, index, onChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) >= SWIPE_MIN_PX) go(dx < 0 ? 1 : -1);
  };

  const refresh = () => {
    if (value) cacheRef.current.delete(value);
    setRefreshKey(k => k + 1);
  };

  const name = current?.name;
  const ref = fileRef(current);
  const isImage = IMAGE_EXT_RE.test(ref) || IMAGE_EXT_RE.test(name || '');
  const isPdf = PDF_EXT_RE.test(ref) || PDF_EXT_RE.test(name || '');
  // Phone and tablet browsers can't show a PDF inside the page (Android Chrome shows
  // nothing, iOS only page 1, neither zooms), so touch devices get the phone's own viewer.
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  const navBtn = 'absolute top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-background/90 shadow border flex items-center justify-center text-foreground hover:bg-background disabled:opacity-0 disabled:pointer-events-none transition-opacity';

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose?.()}>
      <DialogContent className="max-w-4xl w-full h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b flex-shrink-0">
          <DialogTitle className="text-sm font-medium flex items-center gap-2 pr-6">
            <span className="truncate">{name}</span>
            {count > 1 && index > -1 && (
              <span className="text-xs font-normal text-muted-foreground flex-shrink-0">{index + 1} / {count}</span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden relative" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {count > 1 && (
            <>
              <button type="button" className={`${navBtn} left-3`} onClick={() => go(-1)} disabled={!hasPrev} title="Previous (←)" aria-label="Previous file">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button type="button" className={`${navBtn} right-3`} onClick={() => go(1)} disabled={!hasNext} title="Next (→)" aria-label="Next file">
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
          {!value ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No preview available.
            </div>
          ) : state.loading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading preview…</div>
          ) : state.error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-destructive">
              <span>Could not load preview. The link may have expired.</span>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={refresh}>
                <RefreshCw className="w-3.5 h-3.5" /> Refresh preview
              </Button>
            </div>
          ) : !state.url ? null : isImage ? (
            <div className="flex items-center justify-center h-full p-4 bg-muted/30">
              <img key={state.url} src={state.url} alt={name} className="max-h-full max-w-full object-contain rounded select-none" draggable={false} />
            </div>
          ) : isPdf && isTouch ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
              <FileText className="w-12 h-12 text-muted-foreground/60" />
              <p className="text-sm font-medium break-all">{name}</p>
              <Button asChild size="lg" className="gap-2">
                <a href={state.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" /> Open PDF
                </a>
              </Button>
              <p className="text-xs text-muted-foreground max-w-xs">Opens in your phone's PDF viewer, where you can scroll and zoom.</p>
            </div>
          ) : isPdf ? (
            <iframe key={state.url} src={state.url} title={name} className="w-full h-full border-0" />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Preview not available for this file type.
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t flex justify-between flex-shrink-0">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <SecureFileLink value={value} bucket={bucket}>Open in new tab</SecureFileLink>
            </Button>
            {!isStoredUrl(value) && (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={refresh} title="Re-load the preview">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
