import React, { useState } from 'react';
import { Project, Task } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import { Plus, Search, Calendar, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { canEdit, isAdmin } from '@/lib/permissions';
import { logProjectActivity } from '@/lib/activityLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import ProjectFormDialog from '@/components/projects/ProjectFormDialog';
import { format } from 'date-fns';
import { FolderKanban } from 'lucide-react';

const ACTIVE_STATUSES   = ['Active', 'On Hold', 'Complete'];
const ARCHIVED_STATUSES = ['Archived'];

export default function Projects() {
  const { user } = useAuth();
  const isAdminUser = isAdmin(user);
  const isAllowed = canEdit(user, 'projects');
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode]     = useState('active');
  const [showForm, setShowForm]     = useState(false);
  const [archiveId, setArchiveId]   = useState(null);
  const [deleteId, setDeleteId]     = useState(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allProjects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => Project.list('-created_at', 100),
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => Task.list('-created_at', 1000),
  });

  // Archiving/restoring a project cascades to its documents, RFIs, tasks, and CIs
  // (DB trigger). Those are cached under both a per-project key (['documents', id],
  // used by the project detail tabs) AND a global key (['documents'], used by the
  // sidebar Documents/RFIs pages that list across all projects). Invalidating only
  // the base key ['documents'] still catches ['documents', id] too — react-query
  // matches by key prefix — so this one call covers every view.
  const invalidateProjectChildren = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['project'] });
    queryClient.invalidateQueries({ queryKey: ['documents'] });
    queryClient.invalidateQueries({ queryKey: ['rfis'] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['contractInstructions'] });
  };

  const archiveMutation = useMutation({
    mutationFn: (id) => Project.update(id, { status: 'Archived' }),
    onSuccess: (_data, id) => {
      invalidateProjectChildren();
      logProjectActivity({
        projectId: id,
        entityType: 'project',
        eventType: 'status_changed',
        user,
        description: 'Project archived',
      }).catch(() => {});
      setArchiveId(null);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => Project.update(id, { status: 'Active' }),
    onSuccess: (_data, id) => {
      invalidateProjectChildren();
      logProjectActivity({
        projectId: id,
        entityType: 'project',
        eventType: 'status_changed',
        user,
        description: 'Project restored to Active',
      }).catch(() => {});
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => Project.delete(id),
    onSuccess: () => {
      invalidateProjectChildren();
      setDeleteId(null);
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Could not delete project',
        description: error?.message || 'Something went wrong. Please try again.',
      });
    },
  });

  // All authenticated users can see all projects (external = read-only)
  const projects = allProjects;

  const viewProjects = projects.filter(p =>
    viewMode === 'active'
      ? ACTIVE_STATUSES.includes(p.status)
      : ARCHIVED_STATUSES.includes(p.status)
  );

  const filtered = viewProjects.filter(p => {
    const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const projectToArchive = allProjects.find(p => p.id === archiveId);
  const projectToDelete  = allProjects.find(p => p.id === deleteId);

  const activeCount   = projects.filter(p => ACTIVE_STATUSES.includes(p.status)).length;
  const archivedCount = projects.filter(p => ARCHIVED_STATUSES.includes(p.status)).length;

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Manage your construction projects"
        actions={
          isAllowed && viewMode === 'active' && (
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="w-4 h-4" /> New Project
            </Button>
          )
        }
      />

      {/* Active / Archived toggle */}
      <div className="flex gap-2 mb-4">
        <Button
          variant={viewMode === 'active' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setViewMode('active'); setStatusFilter('all'); }}
        >
          Active {activeCount > 0 && `(${activeCount})`}
        </Button>
        <Button
          variant={viewMode === 'archived' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setViewMode('archived'); setStatusFilter('all'); }}
        >
          <Archive className="w-3.5 h-3.5 mr-1.5" />
          Archived {archivedCount > 0 && `(${archivedCount})`}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {viewMode === 'active' && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="On Hold">On Hold</SelectItem>
              <SelectItem value="Complete">Complete</SelectItem>
            </SelectContent>
          </Select>
        )}
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
          title={viewMode === 'archived' ? 'No archived projects' : 'No projects found'}
          description={
            viewMode === 'archived'
              ? 'Archived projects will appear here'
              : search || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first project to get started'
          }
          actionLabel={!search && statusFilter === 'all' && isAllowed && viewMode === 'active' ? 'New Project' : undefined}
          onAction={!search && statusFilter === 'all' && isAllowed && viewMode === 'active' ? () => setShowForm(true) : undefined}
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
              {isAllowed && viewMode === 'active' && (
                <button
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-card border shadow-sm hover:bg-muted"
                  onClick={e => { e.preventDefault(); setArchiveId(project.id); }}
                  title="Archive project"
                >
                  <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
              {viewMode === 'archived' && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5">
                  {isAllowed && (
                    <button
                      className="p-1.5 rounded-md bg-card border shadow-sm hover:bg-primary/10"
                      onClick={e => { e.preventDefault(); restoreMutation.mutate(project.id); }}
                      disabled={restoreMutation.isPending}
                      title="Restore to Active"
                    >
                      <ArchiveRestore className="w-3.5 h-3.5 text-primary" />
                    </button>
                  )}
                  {isAdminUser && (
                    <button
                      className="p-1.5 rounded-md bg-card border shadow-sm hover:bg-destructive/10"
                      onClick={e => { e.preventDefault(); setDeleteId(project.id); }}
                      title="Permanently delete project"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ProjectFormDialog open={showForm} onOpenChange={setShowForm} />

      <AlertDialog open={!!archiveId} onOpenChange={open => !open && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive project?</AlertDialogTitle>
            <AlertDialogDescription>
              "{projectToArchive?.name}" will be moved to the archive. You can still view it under the Archived tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveMutation.mutate(archiveId)}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? 'Archiving...' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>"{projectToDelete?.name}"</strong> and all its documents, RFIs, tasks, and contract instructions will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
