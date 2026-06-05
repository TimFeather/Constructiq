import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Reusable progress modal for long-running operations.
 * Props:
 *   open, title, stage, stageOf, pct, statusText,
 *   error (string | null), onRetry, onClose (shown on error only)
 */
export default function ProgressModal({ open, title, stage, stageOf, pct = 0, statusText, error, onRetry, onClose }) {
  const isDone = pct >= 100 && !error;
  const filled = Math.round(Math.min(100, Math.max(0, pct)));

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
        <div className="flex flex-col items-center gap-4 py-4">
          {/* Icon */}
          {error ? (
            <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-destructive" />
            </div>
          ) : isDone ? (
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>
          ) : (
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-primary animate-spin" />
            </div>
          )}

          {/* Title */}
          <div className="text-center">
            <h2 className="text-lg font-semibold">{error ? 'Operation Failed' : title}</h2>
            {stage && stageOf && !error && (
              <p className="text-xs text-muted-foreground mt-0.5">Stage {stage} of {stageOf}</p>
            )}
          </div>

          {/* Status text */}
          {statusText && (
            <p className={cn("text-sm text-center", error ? "text-destructive" : "text-muted-foreground")}>
              {error || statusText}
            </p>
          )}

          {/* Progress bar */}
          {!error && (
            <div className="w-full space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{statusText}</span>
                <span className="font-semibold">{filled}%</span>
              </div>
              <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-300", isDone ? "bg-emerald-500" : "bg-primary")}
                  style={{ width: `${filled}%` }}
                />
              </div>
            </div>
          )}

          {/* Error actions */}
          {error && (
            <div className="flex gap-2 mt-2">
              {onRetry && <Button onClick={onRetry}>Retry</Button>}
              {onClose && <Button variant="outline" onClick={onClose}>Close</Button>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}