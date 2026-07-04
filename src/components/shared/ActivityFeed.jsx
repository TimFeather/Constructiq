import React, { useState } from 'react';
import { ProjectActivity } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { format, formatDistanceToNow } from 'date-fns';
import {
  FileText, Send, UserCheck, UserMinus, Upload, Trash2,
  ArrowRightLeft, Plus, StickyNote, Clock, MessageSquare, Eye, PlusCircle,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const EVENT_CONFIG = {
  project_created:            { icon: PlusCircle,     color: 'bg-blue-100 text-blue-600',    label: 'Project Created' },
  project_updated:             { icon: FileText,       color: 'bg-slate-100 text-slate-600',  label: 'Project Updated' },
  status_changed:              { icon: ArrowRightLeft, color: 'bg-amber-100 text-amber-600',  label: 'Status Changed' },
  team_member_added:           { icon: UserCheck,      color: 'bg-cyan-100 text-cyan-600',    label: 'Team Member Added' },
  team_member_removed:         { icon: UserMinus,      color: 'bg-rose-100 text-rose-600',    label: 'Team Member Removed' },
  document_uploaded:           { icon: Upload,         color: 'bg-orange-100 text-orange-600', label: 'Document Uploaded' },
  document_deleted:            { icon: Trash2,         color: 'bg-red-100 text-red-600',      label: 'Document Deleted' },
  document_status_changed:     { icon: FileText,       color: 'bg-amber-100 text-amber-600',  label: 'Document Status Changed' },
  rfi_created:                 { icon: MessageSquare,  color: 'bg-indigo-100 text-indigo-600', label: 'RFI Created' },
  rfi_assigned:                { icon: UserCheck,      color: 'bg-cyan-100 text-cyan-600',    label: 'RFI Assigned' },
  rfi_response:                { icon: Send,           color: 'bg-green-100 text-green-600',  label: 'RFI Response' },
  rfi_status_changed:          { icon: ArrowRightLeft, color: 'bg-amber-100 text-amber-600',  label: 'RFI Status Changed' },
  rfi_visibility_changed:      { icon: Eye,            color: 'bg-purple-100 text-purple-600', label: 'RFI Visibility Changed' },
  rfi_deleted:                 { icon: Trash2,         color: 'bg-red-100 text-red-600',      label: 'RFI Deleted' },
  note_added:                  { icon: StickyNote,     color: 'bg-gray-100 text-gray-600',    label: 'Note' },
};

const DEFAULT_CONFIG = { icon: Clock, color: 'bg-gray-100 text-gray-600', label: 'Activity' };

export default function ActivityFeed({ projectId, entityType = null, entityId = null, compact = false }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const queryKey = ['projectActivity', projectId, entityType, entityId];

  const { data: activities = [], isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const match = { project_id: projectId };
      if (entityType) match.entity_type = entityType;
      if (entityId) match.entity_id = entityId;
      return ProjectActivity.filter(match, '-occurred_at', 100);
    },
    enabled: !!projectId,
    refetchInterval: 30000,
    retry: 1,
  });

  const addNoteMutation = useMutation({
    mutationFn: () => ProjectActivity.create({
      project_id: projectId,
      entity_type: 'project',
      entity_id: null,
      event_type: 'note_added',
      actor_name: user?.full_name || user?.email || 'Unknown',
      actor_email: user?.email || '',
      description: note.trim(),
      metadata: {},
      occurred_at: new Date().toISOString(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setNote('');
      setAddingNote(false);
      toast({ title: 'Note added' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-10 text-center space-y-2">
        <Clock className="w-8 h-8 opacity-30 mx-auto" />
        <p className="text-sm font-medium text-destructive">Activity feed unavailable</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">{error?.message || 'Table not found'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add Note */}
      {!compact && (
        <div className="flex justify-end">
          {!addingNote ? (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setAddingNote(true)}>
              <Plus className="w-3.5 h-3.5" /> Add Note
            </Button>
          ) : (
            <div className="w-full border rounded-lg p-3 bg-muted/20 space-y-2">
              <Textarea
                placeholder="Add a note to the activity feed..."
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                className="text-sm"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setAddingNote(false); setNote(''); }}>Cancel</Button>
                <Button size="sm" onClick={() => addNoteMutation.mutate()} disabled={!note.trim() || addNoteMutation.isPending}>
                  {addNoteMutation.isPending ? 'Saving...' : 'Save Note'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Feed */}
      {activities.length === 0 ? (
        <div className={`flex flex-col items-center justify-center text-center text-muted-foreground gap-2 ${compact ? 'py-8' : 'py-16'}`}>
          <Clock className="w-8 h-8 opacity-30" />
          <p className="text-sm">No activity recorded yet.</p>
          {!compact && <p className="text-xs">Events like status changes, uploads, and updates will appear here automatically.</p>}
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-4 top-4 bottom-4 w-px bg-border" />

          <div className="space-y-1">
            {activities.map((event, idx) => {
              const config = EVENT_CONFIG[event.event_type] || DEFAULT_CONFIG;
              const Icon = config.icon;
              const ts = event.occurred_at || event.created_at;

              return (
                <div key={event.id || idx} className="flex gap-3 pl-0">
                  {/* Icon dot */}
                  <div className="relative z-10 flex-shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${config.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm text-foreground leading-snug">{event.description || config.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {event.actor_name || 'System'}
                          {ts && (
                            <span className="ml-1.5">
                              · <span title={ts ? format(new Date(ts), 'dd MMM yyyy HH:mm') : ''}>
                                {ts ? formatDistanceToNow(new Date(ts), { addSuffix: true }) : ''}
                              </span>
                            </span>
                          )}
                        </p>
                      </div>
                      <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
