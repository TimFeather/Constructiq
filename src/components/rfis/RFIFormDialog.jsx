import { invokeFunction } from '@/api/supabaseClient';
import React, { useState, useEffect } from 'react';
import { EmailBranding, EmailTemplate, RFI, User } from '@/api/entities';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resolveTemplate, applyTemplate, buildEmailHtml } from '@/lib/emailTemplates';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { filterActiveUsers } from '@/lib/userStatus';
import { logProjectActivity } from '@/lib/activityLog';

export default function RFIFormDialog({ open, onOpenChange, projects = [], defaultProjectId = '' }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: '', description: '', project_id: defaultProjectId || '', due_date: '', priority: 'Medium', is_public: false,
  });

  // Reset form fully when dialog opens
  React.useEffect(() => {
    if (open) {
      setForm({ title: '', description: '', project_id: defaultProjectId || '', due_date: '', priority: 'Medium', is_public: false });
      setSelectedEmails([]);
    }
  }, [open, defaultProjectId]);
  const [selectedEmails, setSelectedEmails] = useState([]);
  const queryClient = useQueryClient();

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => EmailTemplate.list(),
  });

  const { data: emailBranding = {} } = useQuery({
    queryKey: ['emailBranding'],
    queryFn: () => EmailBranding.list().then(r => r[0] ?? {}),
  });

  const { data: allUsersRaw = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => User.list(),
  });
  const activeUserEmails = new Set(filterActiveUsers(allUsersRaw).map(u => u.email?.toLowerCase()));

  const selectedProject = projects.find(p => p.id === form.project_id);
  // Filter deactivated users from the assignee picker — historical RFI data is unaffected
  const teamMembers = (selectedProject?.team || []).filter(m =>
    !m.user_email || activeUserEmails.has(m.user_email.toLowerCase())
  );

  useEffect(() => {
    setSelectedEmails([]);
  }, [form.project_id]);

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

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const projectRfis = await RFI.filter({ project_id: data.project_id }, '-created_at', 500);
      const maxNumber = projectRfis.reduce((max, r) => Math.max(max, r.number || 0), 0);
      const nextNumber = maxNumber + 1;
      // keep legacy single-assignee fields populated with first assignee for backwards compat
      const firstAssignee = selectedEmails[0];
      const rfi = await RFI.create({
      ...data,
      number: nextNumber,
      status: 'Open',
      responses: [],
      attachments: [],
      assignees: selectedEmails,
      assigned_to_email: firstAssignee?.email || '',
      assigned_to_name: firstAssignee?.name || '',
      created_by_id: user?.id || null,
      created_by_email: user?.email || '',
      created_by_name: user?.full_name || '',
      });
      // send email to all assignees using template
      const rfiUrl = `${window.location.origin}/rfis/${rfi.id}`;
      const projectName = projects.find(p => p.id === data.project_id)?.name || '';
      const tpl = resolveTemplate(emailTemplates, 'rfi_assigned');
      selectedEmails.forEach(assignee => {
        const { subject, body } = applyTemplate(tpl, {
          rfi_ref: `RFI-${String(nextNumber).padStart(3, '0')}`,
          title: data.title,
          project_name: projectName,
          assignee_name: assignee.name,
          priority: data.priority || 'Medium',
          due_date: data.due_date || 'Not set',
          description: data.description || 'No description provided',
          url: rfiUrl,
        });
        const htmlBody = buildEmailHtml(body, emailBranding);
        invokeFunction('sendEmail', { to: assignee.email, toName: assignee.name || '', subject, htmlBody }).catch((e) => {
          console.warn('[RFIFormDialog] failed to notify assignee by email:', assignee.email, e?.message || e);
          toast({ variant: 'destructive', title: `Could not notify ${assignee.name || assignee.email} by email` });
        });
      });
      return rfi;
    },
    onSuccess: (rfi) => {
      logProjectActivity({
        projectId: rfi.project_id,
        entityType: 'rfi',
        entityId: rfi.id,
        eventType: 'rfi_created',
        user,
        description: `RFI-${String(rfi.number).padStart(3, '0')} "${rfi.title}" created`,
      }).catch(() => {});
      if (selectedEmails.length > 0) {
        logProjectActivity({
          projectId: rfi.project_id,
          entityType: 'rfi',
          entityId: rfi.id,
          eventType: 'rfi_assigned',
          user,
          description: `RFI-${String(rfi.number).padStart(3, '0')} assigned to ${selectedEmails.map(a => a.name || a.email).join(', ')}`,
          metadata: { assignees: selectedEmails.map(a => a.email) },
        }).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['rfis'] });
      onOpenChange(false);
      if (!selectedEmails || selectedEmails.length === 0) {
        toast({
          title: 'RFI created — no assignees set',
          description: 'No notification email was sent. You can assign someone from the RFI detail page.',
          duration: 7000,
        });
      } else {
        toast({ title: 'RFI created and assignees notified', duration: 4000 });
      }
      setForm({ title: '', description: '', project_id: '', due_date: '', priority: 'Medium', is_public: false });
      setSelectedEmails([]);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate({ ...form, due_date: form.due_date || null });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New RFI</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="RFI Title" required />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={3} placeholder="Describe the information needed" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Project *</Label>
              <Select value={form.project_id} onValueChange={v => setForm({...form, project_id: v})}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm({...form, priority: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Due Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} />
          </div>

          {/* Multi-select assignees */}
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

            {!form.project_id ? (
              <p className="text-xs text-muted-foreground py-2">Select a project first</p>
            ) : teamMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No team members in this project</p>
            ) : (
              <div className="border rounded-md p-2 space-y-1 max-h-40 overflow-y-auto">
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

          <div className="flex items-start justify-between gap-3 border rounded-md p-3">
            <div>
              <Label className="cursor-pointer" htmlFor="rfi-is-public">Visible to all project members</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Off: only assigned people and internal staff can see this RFI</p>
            </div>
            <Switch id="rfi-is-public" checked={form.is_public} onCheckedChange={v => setForm({...form, is_public: v})} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || !form.title || !form.project_id}>
              {createMutation.isPending ? 'Creating...' : 'Create RFI'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}