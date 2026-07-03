/**
 * BaselineManager
 *
 * Popover-based widget for capturing named baseline snapshots of the current
 * schedule (task dates) and selecting one as the "overlay" baseline that the
 * Gantt chart compares the live schedule against.
 *
 * Parent usage (Programme.jsx):
 *
 * const { data: baselineItems = [] } = useQuery({
 *   queryKey: ['baselineItems', selectedBaselineId],
 *   queryFn: () => TaskBaselineItem.filter({ baseline_id: selectedBaselineId }),
 *   enabled: !!selectedBaselineId,
 * });
 * const baselineMap = useMemo(() => buildBaselineMap(baselineItems), [baselineItems]);
 * <GanttChart baselineMap={selectedBaselineId ? baselineMap : null} ... />
 *
 * <BaselineManager
 *   projectId={selectedProjectId}
 *   tasks={tasks}
 *   scheduledMap={scheduledMap}
 *   selectedBaselineId={selectedBaselineId}
 *   onSelectBaseline={setSelectedBaselineId}
 *   canDelete={['admin', 'pricing'].includes(user?.role)}
 * />
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Layers, Trash2, Check } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { TaskBaseline, TaskBaselineItem } from '@/api/entities';
import { captureBaseline } from '@/lib/scheduling/baselineEngine';

export default function BaselineManager({
  projectId,
  tasks,
  scheduledMap,
  selectedBaselineId,
  onSelectBaseline,
  canDelete,
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const { data: baselines = [] } = useQuery({
    queryKey: ['baselines', projectId],
    queryFn: () => TaskBaseline.filter({ project_id: projectId }, '-created_at', 20),
    enabled: !!projectId && open,
  });

  const suggestedName = `Baseline ${baselines.length + 1}`;

  const captureMutation = useMutation({
    mutationFn: async () => {
      const items = captureBaseline(tasks, scheduledMap);
      const created = await TaskBaseline.create({
        project_id: projectId,
        name: name.trim() || suggestedName,
        created_by_id: user?.id || null,
      });
      if (items.length) {
        await TaskBaselineItem.bulkCreate(items.map(i => ({ ...i, baseline_id: created.id })));
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['baselines', projectId] });
      queryClient.invalidateQueries({ queryKey: ['baselineItems'] });
      toast({ title: 'Baseline captured', duration: 2500 });
      setName('');
    },
    onError: (e) => toast({ title: 'Capture failed', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => TaskBaseline.delete(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ['baselines', projectId] });
      queryClient.invalidateQueries({ queryKey: ['baselineItems'] });
      if (selectedBaselineId === id) onSelectBaseline(null);
      setConfirmDeleteId(null);
      toast({ title: 'Baseline deleted', duration: 2500 });
    },
    onError: (e) => toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  const handleSelectRow = (id) => {
    onSelectBaseline(selectedBaselineId === id ? null : id);
  };

  const handleDeleteClick = (e, id) => {
    e.stopPropagation();
    if (confirmDeleteId === id) {
      deleteMutation.mutate(id);
    } else {
      setConfirmDeleteId(id);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmDeleteId(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-9" title="Baselines">
          <Layers className="w-3.5 h-3.5" /> Baselines
          {baselines.length > 0 && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] leading-none">
              {baselines.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <Label className="text-xs">Capture current schedule as baseline</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`e.g. Client-approved (${suggestedName})`}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              className="h-8 shrink-0"
              onClick={() => captureMutation.mutate()}
              disabled={captureMutation.isPending || !tasks?.length}
            >
              {captureMutation.isPending ? 'Capturing…' : 'Capture'}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Snapshots current task dates so you can compare against them later.
          </p>
        </div>

        <div className="border-t pt-2">
          <Label className="text-xs">Existing baselines</Label>
          {baselines.length === 0 ? (
            <p className="text-[11px] text-muted-foreground mt-2">
              No baselines yet — capture one to compare against later.
            </p>
          ) : (
            <ul className="mt-1 space-y-1 max-h-56 overflow-y-auto">
              {baselines.map((b) => {
                const isSelected = b.id === selectedBaselineId;
                const isConfirming = confirmDeleteId === b.id;
                return (
                  <li
                    key={b.id}
                    onClick={() => handleSelectRow(b.id)}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer text-xs transition-colors ${
                      isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isSelected ? (
                        <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      ) : (
                        <span className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{b.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-6 w-6 shrink-0 ${isConfirming ? 'text-red-600 hover:text-red-700' : 'text-muted-foreground'}`}
                        title={isConfirming ? 'Click again to confirm delete' : 'Delete baseline'}
                        onClick={(e) => handleDeleteClick(e, b.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
