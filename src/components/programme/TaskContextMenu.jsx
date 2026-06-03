import React from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  ArrowRightToLine, ArrowLeftToLine, Plus, Trash2, Flag,
} from 'lucide-react';

export default function TaskContextMenu({ children, task, onAction }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => onAction('insert-above', task)} className="gap-2 text-xs">
          <Plus className="w-3.5 h-3.5" /> Insert Above
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAction('insert-below', task)} className="gap-2 text-xs">
          <Plus className="w-3.5 h-3.5" /> Insert Below
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onAction('indent', task)} className="gap-2 text-xs">
          <ArrowRightToLine className="w-3.5 h-3.5" /> Indent
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAction('outdent', task)} className="gap-2 text-xs">
          <ArrowLeftToLine className="w-3.5 h-3.5" /> Outdent
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onAction('convert-milestone', task)} className="gap-2 text-xs">
          <Flag className="w-3.5 h-3.5" /> Convert to Milestone
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => onAction('delete', task)}
          className="gap-2 text-xs text-destructive focus:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}