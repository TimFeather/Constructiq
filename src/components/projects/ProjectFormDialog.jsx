import React, { useState } from 'react';
import { DocumentFolderTemplate, Project } from '@/api/entities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

  const { data: folderTemplates = [] } = useQuery({
    queryKey: ['documentFolderTemplates'],
    queryFn: () => DocumentFolderTemplate.list(),
  });

  React.useEffect(() => {
    if (open) {
      queryClient.invalidateQueries({ queryKey: ['documentFolderTemplates'] });
    }
  }, [open, queryClient]);

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (project?.id) return Project.update(project.id, data);
      const created = await Project.create(data);
      // Apply default folder template — create placeholder documents for each folder
      const defaultTemplate = folderTemplates.find(t => t.is_default);
      if (defaultTemplate?.folder_structure?.length && created?.id) {
        // We just pre-create the folder structure by storing it; no documents needed.
        // This is handled in ProjectDocsPanel which reads DEFAULT_FOLDERS.
        // We store the chosen folder structure on the project for dynamic loading.
        await Project.update(created.id, {
          folder_structure: defaultTemplate.folder_structure,
        });
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      onOpenChange(false);
      setForm(initialState);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    mutation.mutate(form);
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