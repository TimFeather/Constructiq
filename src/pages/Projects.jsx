import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import { Plus, Search, Calendar, Trash2 } from 'lucide-react';
import { canEdit, canDelete, isAdmin } from '@/lib/permissions';
import { normalizeEmail } from '@/lib/normalizeEmail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import ProjectFormDialog from '@/components/projects/ProjectFormDialog';
import { format } from 'date-fns';
import { FolderKanban } from 'lucide-react';

export default function Projects() {
  const { user } = useAuth();
  const isAdminUser = isAdmin(user);
  const isAllowed = canEdit(user, 'projects');
  const canDeleteProject = canDelete(user, 'projects');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState(null);
  const queryClient = useQueryClient();

  const { data: allProjects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100),
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => base44.entities.Task.list('-created_date', 1000),
  });

  const projects = isAdminUser
    ? allProjects
    : allProjects.filter(p => {
        console.log('MEMBERSHIP CHECK', {
          sessionEmail: normalizeEmail(user?.email),
          teamEmails: p.team?.map(t => normalizeEmail(t.user_email)),
        });
        return p.team?.some(m => normalizeEmail(m.user_email) === normalizeEmail(user?.email));
      });

  const filtered = projects.filter(p => {
    const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Project.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDeleteProjectId(null);
    },
  });

  const projectToDelete = allProjects.find(p => p.id === deleteProjectId);

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Manage your construction projects"
        actions={
          isAllowed && (
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="w-4 h-4" /> New Project
            </Button>
          )
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="On Hold">On Hold</SelectItem>
            <SelectItem value="Complete">Complete</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-5 space-y-3">
                <div className="h-5 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects found"
          description={search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first project to get started'}
          actionLabel={!search && statusFilter === 'all' && isAllowed ? 'New Project' : undefined}
          onAction={!search && statusFilter === 'all' && isAllowed ? () => setShowForm(true) : undefined}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(project => (
            <div key={project.id} className="relative group">
              <Link to={`/projects/${project.id}`}>
                <Card className="hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 cursor-pointer h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-foreground truncate pr-2">{project.name}</h3>
                      <StatusBadge status={project.status} />
                    </div>
                    {project.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
                    )}
                    {(() => {
                      const today = new Date().toISOString().split('T')[0];
                      const taskCount = allTasks.filter(t => t.project_id === project.id).length;
                      const overdue = allTasks.filter(t =>
                        t.project_id === project.id && t.end_date && t.end_date < today && (t.percent_complete || 0) < 100
                      ).length;
                      return (
                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                          {project.start_date && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {format(new Date(project.start_date), 'MMM d, yyyy')}
                            </span>
                          )}
                          <span>{project.team?.length || 0} members</span>
                          {taskCount > 0 && <span>{taskCount} tasks</span>}
                          {overdue > 0 && (
                            <span className="text-red-500 font-medium">{overdue} overdue</span>
                          )}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </Link>
              {canDeleteProject && (
                <button
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-card border shadow-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                  onClick={e => { e.preventDefault(); setDeleteProjectId(project.id); }}
                  title="Delete project"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <ProjectFormDialog open={showForm} onOpenChange={setShowForm} />

      <AlertDialog open={!!deleteProjectId} onOpenChange={open => !open && setDeleteProjectId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{projectToDelete?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteProjectId)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}