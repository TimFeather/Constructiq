import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function RFIFormDialog({ open, onOpenChange, projects = [] }) {
  const [form, setForm] = useState({
    title: '', description: '', project_id: '', due_date: '',
    priority: 'Medium', assigned_to_email: '', assigned_to_name: '',
  });
  const queryClient = useQueryClient();

  // Get team members for the selected project
  const selectedProject = projects.find(p => p.id === form.project_id);
  const teamMembers = selectedProject?.team || [];

  // Reset assignee when project changes
  useEffect(() => {
    setForm(f => ({ ...f, assigned_to_email: '', assigned_to_name: '' }));
  }, [form.project_id]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Number RFIs per project
      const projectRfis = await base44.entities.RFI.filter({ project_id: data.project_id }, '-number', 1);
      const nextNumber = projectRfis.length > 0 ? (projectRfis[0].number || 0) + 1 : 1;
      const rfi = await base44.entities.RFI.create({
        ...data,
        number: nextNumber,
        status: 'Open',
        responses: [],
        attachments: [],
      });
      if (data.assigned_to_email) {
        base44.integrations.Core.SendEmail({
          to: data.assigned_to_email,
          subject: `New RFI Assigned: ${data.title}`,
          body: `You have been assigned RFI-${String(nextNumber).padStart(3, '0')}: ${data.title}\n\nDescription: ${data.description || 'No description'}\n\nPlease log in to respond.`
        });
      }
      return rfi;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis'] });
      onOpenChange(false);
      setForm({ title: '', description: '', project_id: '', due_date: '', priority: 'Medium', assigned_to_email: '', assigned_to_name: '' });
    }
  });

  const handleAssigneeChange = (value) => {
    if (value === 'unassigned') {
      setForm({ ...form, assigned_to_email: '', assigned_to_name: '' });
      return;
    }
    const member = teamMembers.find(m => m.user_email === value);
    if (member) {
      setForm({ ...form, assigned_to_email: member.user_email, assigned_to_name: member.full_name });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
            <Label>Due Date</Label>
            <Input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} />
          </div>
          <div>
            <Label>Assign To</Label>
            {teamMembers.length > 0 ? (
              <Select
                value={form.assigned_to_email || 'unassigned'}
                onValueChange={handleAssigneeChange}
                disabled={!form.project_id}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">— Unassigned —</SelectItem>
                  {teamMembers.map(m => (
                    <SelectItem key={m.user_email} value={m.user_email}>
                      {m.full_name} — {m.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  value={form.assigned_to_name}
                  onChange={e => setForm({...form, assigned_to_name: e.target.value})}
                  placeholder={form.project_id ? 'No team members yet' : 'Select project first'}
                  disabled={!!form.project_id && teamMembers.length === 0}
                />
                <Input
                  type="email"
                  value={form.assigned_to_email}
                  onChange={e => setForm({...form, assigned_to_email: e.target.value})}
                  placeholder="Assignee email"
                  disabled={!!form.project_id && teamMembers.length === 0}
                />
              </div>
            )}
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