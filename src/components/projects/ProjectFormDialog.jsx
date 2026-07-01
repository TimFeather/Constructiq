import React, { useState } from 'react';
import { Project } from '@/api/entities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const initialState = {
  name: '', description: '', start_date: '', end_date: '', status: 'Active', team: []
};

export default function ProjectFormDialog({ open, onOpenChange, project }) {
  const [form, setForm] = useState(project || initialState);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (project?.id) return Project.update(project.id, data);
      const created = await Project.create(data);
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      // A status change (e.g. to/from Archived) cascades to documents/RFIs/tasks/CIs
      // via a DB trigger. Invalidating the base key also catches the per-project
      // ['documents', id] variant (react-query matches by key prefix), so this covers
      // both the project detail tabs AND the sidebar Documents/RFIs pages.
      if (project?.id) {
        queryClient.invalidateQueries({ queryKey: ['documents'] });
        queryClient.invalidateQueries({ queryKey: ['rfis'] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['contractInstructions'] });
      }
      onOpenChange(false);
      setForm(initialState);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    mutation.mutate({
      ...form,
      start_date: form.start_date || null,
      end_date:   form.end_date   || null,
    });
  };

  React.useEffect(() => {
    if (project) setForm(project);
    else setForm(initialState);
  }, [project, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? 'Edit Project' : 'New Project'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Project Name *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              placeholder="Enter project name"
              required
            />
          </div>
          <div>
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              value={form.description || ''}
              onChange={e => setForm({...form, description: e.target.value})}
              placeholder="Project description"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start">Start Date</Label>
              <Input
                id="start"
                type="date"
                value={form.start_date || ''}
                onChange={e => setForm({...form, start_date: e.target.value})}
              />
            </div>
            <div>
              <Label htmlFor="end">End Date</Label>
              <Input
                id="end"
                type="date"
                value={form.end_date || ''}
                onChange={e => setForm({...form, end_date: e.target.value})}
              />
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="On Hold">On Hold</SelectItem>
                <SelectItem value="Complete">Complete</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : project ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}