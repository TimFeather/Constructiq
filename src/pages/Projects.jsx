import React, { useMemo, useState } from 'react';
import { Project } from '@/api/entities';
import { OPEN_PROJECT_STATUSES, setProjectStatus } from '@/api/projectStatus';
import { programmeTasksQuery, programmesByProjectQuery } from '@/api/programmeData';
import { forecastLeafTasks, isOverdue, localDateStr } from '@/lib/programme/overdue';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import { Plus, Search, Calendar, Archive, ArchiveRestore, CheckCircle2, Trash2 } from 'lucide-react';
import { canEdit, isAdmin } from '@/lib/permissions';
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

const VIEW_STATUSES = {
  active:   OPEN_PROJECT_STATUSES,
  complete: ['Complete'],
  archived: ['Archived'],
};

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

  const { data: allTasks = [] } = useQuery(programmeTasksQuery('all'));
  const { data: programmesByProject } = useQuery(programmesByProjectQuery());

  // Per project: every task row, and the overdue count on the Gantt's terms
  // (leaf tasks, forecast finish — see lib/programme/overdue.js).
  const taskStats = useMemo(() => {
    const stats = new Map();
    const statFor = (id) => {
      if (!stats.has(id)) stats.set(id, { count: 0, overdue: 0 });
      return stats.get(id);
    };
    for (const t of allTasks) statFor(t.project_id).count++;
    const today = localDateStr();
    for (const t of forecastLeafTasks(allTasks, programmesByProject)) {
      if (isOverdue(t, today)) statFor(t.project_id).overdue++;
    }
    return stats;
  }, [allTasks, programmesByProject]);

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

  const statusErrorToast = (error) => {
    toast({
      variant: 'destructive',
      title: 'Could not change project status',
      description: error?.message || 'Something went wrong. Please try again.',
    });
  };

  const archiveMutation = useMutation({
    mutationFn: (id) => setProjectStatus(id, 'Archived'),
    onSuccess: () => {
      invalidateProjectChildren();
      setArchiveId(null);
    },
    onError: statusErrorToast,
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => setProjectStatus(id, 'Active'),
    onSuccess: invalidateProjectChildren,
    onError: statusErrorToast,
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

  const viewCount = (view) => projects.filter(p => VIEW_STATUSES[view].includes(p.status)).length;

  const viewProjects = projects.filter(p => VIEW_STATUSES[viewMode].includes(p.status));

  const filtered = viewProjects.filter(p => {
    const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const projectToArchive = allProjects.find(p => p.id === archiveId);
  const projectToDelete  = allProjects.find(p => p.id === deleteId);

  const activeCount   = viewCount('active');
  const completeCount = viewCount('complete');
  const archivedCount = viewCount('archived');

  // Card corner buttons stay visible on touch screens; pad the card header so they
  // don't sit on top of the status badge. The closed views are admin-only.
  const cornerButtonCount = viewMode === 'active' ? Number(isAllowed) : 2;
  const cardHeaderPad = ['', 'touch:pr-8', 'touch:pr-16'][cornerButtonCount];

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

      {/* Active / Complete / Archived toggle. Closed projects are only visible to admins. */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Button
          variant={viewMode === 'active' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setViewMode('active'); setStatusFilter('all'); }}
        >
          Active {activeCount > 0 && `(${activeCount})`}
        </Button>
        {isAdminUser && (
          <>
            <Button
              variant={viewMode === 'complete' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setViewMode('complete'); setStatusFilter('all'); }}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Complete {completeCount > 0 && `(${completeCount})`}
            </Button>
            <Button
              variant={viewMode === 'archived' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setViewMode('archived'); setStatusFilter('all'); }}
            >
              <Archive className="w-3.5 h-3.5 mr-1.5" />
              Archived {archivedCount > 0 && `(${archivedCount})`}
            </Button>
          </>
        )}
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
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
          title={viewMode === 'active' ? 'No projects found' : `No ${viewMode} projects`}
          description={
            viewMode !== 'active'
              ? `${viewMode === 'archived' ? 'Archived' : 'Complete'} projects will appear here`
              : search || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Create your first project to get started'
          }
          actionLabel={!search && statusFilter === 'all' && isAllowed && viewMode === 'active' ? 'New Project' : undefined}
          onAction={!search && statusFilter === 'all' && isAllowed && viewMode === 'active' ? () => setShowForm(true) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(project => (
            <div key={project.id} className="relative group">
              <Link to={`/projects/${project.id}`}>
                <Card className="hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 cursor-pointer h-full">
                  <CardContent className="p-5">
                    <div className={`flex items-start justify-between mb-3 ${cardHeaderPad}`}>
                      <h3 className="font-semibold text-foreground line-clamp-2 min-w-0 pr-2">{project.name}</h3>
                      <StatusBadge status={project.status} className="flex-shrink-0" />
                    </div>
                    {project.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
                    )}
                    {(() => {
                      const { count: taskCount = 0, overdue = 0 } = taskStats.get(project.id) || {};
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
                  className="absolute top-2 right-2 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-card border shadow-sm hover:bg-muted"
                  onClick={e => { e.preventDefault(); setArchiveId(project.id); }}
                  title="Archive project"
                >
                  <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
              {viewMode !== 'active' && (
                <div className="absolute top-2 right-2 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity flex gap-1.5">
                  <button
                    className="p-1.5 rounded-md bg-card border shadow-sm hover:bg-primary/10"
                    onClick={e => { e.preventDefault(); restoreMutation.mutate(project.id); }}
                    disabled={restoreMutation.isPending}
                    title="Reopen as Active"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5 text-primary" />
                  </button>
                  {viewMode === 'complete' ? (
                    <button
                      className="p-1.5 rounded-md bg-card border shadow-sm hover:bg-muted"
                      onClick={e => { e.preventDefault(); setArchiveId(project.id); }}
                      title="Archive project"
                    >
                      <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  ) : (
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
              "{projectToArchive?.name}" will be closed and moved to the archive. The team and subcontractors lose access to its files and programme straight away{isAdminUser ? '' : ', and so will you'}. Only an admin can reopen it.
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
