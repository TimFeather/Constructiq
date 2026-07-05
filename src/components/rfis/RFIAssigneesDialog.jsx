import { invokeFunction } from '@/api/supabaseClient';
import React, { useState, useEffect } from 'react';
import { EmailBranding, EmailTemplate, RFI } from '@/api/entities';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resolveTemplate, applyTemplate, buildEmailHtml } from '@/lib/emailTemplates';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { logProjectActivity } from '@/lib/activityLog';

export default function RFIAssigneesDialog({ open, onOpenChange, rfi, project }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedEmails, setSelectedEmails] = useState([]);

  const teamMembers = project?.team || [];

  // Pre-seed from rfi.assignees whenever the dialog opens
  useEffect(() => {
    if (open) {
      setSelectedEmails(rfi?.assignees || []);
    }
  }, [open, rfi]);

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => EmailTemplate.list(),
  });

  const { data: emailBranding = {} } = useQuery({
    queryKey: ['emailBranding'],
    queryFn: () => EmailBranding.list().then(r => r[0] ?? {}),
  });

  const toggleMember = (member) => {
    setSelectedEmails(prev => {
      const exists = prev.find(m => m.email === member.user_email);
      if (exists) return prev.filter(m => m.email !== member.user_email);
      return [...prev, { email: member.user_email, name: member.full_name, role: member.role }];
    });
  };

  const selectAll = () => {
    setSelectedEmails(teamMembers.map(m => ({ email: m.user_email, name: m.full_name, role: m.role })));
  };

  const clearAll = () => setSelectedEmails([]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const oldEmails = new Set((rfi.assignees || []).map(a => a.email));
      const newlyAdded = selectedEmails.filter(a => !oldEmails.has(a.email));

      const firstAssignee = selectedEmails[0];
      await RFI.update(rfi.id, {
        assignees: selectedEmails,
        assigned_to_email: firstAssignee?.email || null,
        assigned_to_name: firstAssignee?.name || null,
      });

      // Notify newly added assignees using the same rfi_assigned template flow as RFIFormDialog
      if (newlyAdded.length > 0) {
        const rfiUrl = `${window.location.origin}/rfis/${rfi.id}`;
        const tpl = resolveTemplate(emailTemplates, 'rfi_assigned');
        newlyAdded.forEach(assignee => {
          const { subject, body } = applyTemplate(tpl, {
            rfi_ref: `RFI-${String(rfi.number).padStart(3, '0')}`,
            title: rfi.title,
            project_name: project?.name || '',
            assignee_name: assignee.name,
            priority: rfi.priority || 'Medium',
            due_date: rfi.due_date || 'Not set',
            description: rfi.description || 'No description provided',
            url: rfiUrl,
          });
          const htmlBody = buildEmailHtml(body, emailBranding);
          invokeFunction('sendEmail', { to: assignee.email, toName: assignee.name || '', subject, htmlBody }).catch((e) => {
            console.warn('[RFIAssigneesDialog] failed to notify assignee by email:', assignee.email, e?.message || e);
            toast({ variant: 'destructive', title: `Could not notify ${assignee.name || assignee.email} by email` });
          });
        });
      }

      return { oldEmails, newlyAdded };
    },
    onSuccess: ({ oldEmails, newlyAdded }) => {
      const newEmails = new Set(selectedEmails.map(a => a.email));
      const removed = (rfi.assignees || []).filter(a => !newEmails.has(a.email));

      queryClient.invalidateQueries({ queryKey: ['rfis'] });
      queryClient.invalidateQueries({ queryKey: ['rfi', rfi.id] });

      const addedNames = newlyAdded.map(a => a.name || a.email);
      const removedNames = removed.map(a => a.name || a.email);
      const parts = [];
      if (addedNames.length) parts.push(`+${addedNames.join(', ')}`);
      if (removedNames.length) parts.push(`-${removedNames.join(', ')}`);

      logProjectActivity({
        projectId: rfi.project_id,
        entityType: 'rfi',
        entityId: rfi.id,
        eventType: 'rfi_assigned',
        user,
        description: `Assignees updated${parts.length ? ': ' + parts.join(' ') : ''}`,
        metadata: { added: newlyAdded.map(a => a.email), removed: removed.map(a => a.email) },
      }).catch(() => {});

      toast({ title: 'Assignees updated', duration: 4000 });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Edit Assignees</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Assign To</Label>
              {teamMembers.length > 0 && (
                <div className="flex gap-2">
                  <button type="button" onClick={selectAll} className="text-xs text-primary hover:underline">Select All</button>
                  {selectedEmails.length > 0 && (
                    <button type="button" onClick={clearAll} className="text-xs text-muted-foreground hover:underline">Clear</button>
                  )}
                </div>
              )}
            </div>

            {teamMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No team members in this project</p>
            ) : (
              <div className="border rounded-md p-2 space-y-1 max-h-60 overflow-y-auto">
                {teamMembers.map(m => {
                  const isChecked = !!selectedEmails.find(s => s.email === m.user_email);
                  return (
                    <div
                      key={m.user_email}
                      className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggleMember(m)}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleMember(m)}
                        onClick={e => e.stopPropagation()}
                      />
                      <span className="text-sm flex-1">{m.full_name}</span>
                      <span className="text-xs text-muted-foreground">{m.role}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Selected badges */}
            {selectedEmails.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedEmails.map(s => (
                  <Badge key={s.email} variant="secondary" className="gap-1 pr-1">
                    {s.name}
                    <button type="button" onClick={() => setSelectedEmails(prev => prev.filter(m => m.email !== s.email))}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
