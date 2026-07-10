import React, { useState, useEffect } from 'react';
import { Project, RFI } from '@/api/entities';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import { isAdmin, canCreate, canEdit } from '@/lib/permissions';
import { Plus, Search, MessageSquareMore, Clock, UserIcon, ArrowLeft, FolderKanban, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import RFIFormDialog from '@/components/rfis/RFIFormDialog';
import { format } from 'date-fns';
import { normalizeEmail } from '@/lib/normalizeEmail';

const RFICard = ({ rfi, projectMap, rfiNumber, showPrivateBadge }) => {
  const isOverdue = rfi.due_date && rfi.due_date < new Date().toISOString().split('T')[0] && rfi.status === 'Open';
  return (
  <Link key={rfi.id} to={`/rfis/${rfi.id}`}>
    <Card className={`hover:shadow-md transition-all duration-200 cursor-pointer ${isOverdue ? 'border-l-4 border-l-red-500' : 'hover:border-primary/30'}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-semibold text-primary">RFI-{String(rfiNumber).padStart(3, '0')}</span>
              <StatusBadge status={rfi.priority} />
              <StatusBadge status={rfi.status} />
              {isOverdue && <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Overdue</span>}
              {showPrivateBadge && !rfi.is_public && (
                <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">Private</span>
              )}
            </div>
            <h3 className="font-semibold text-sm mt-1.5">{rfi.title}</h3>
            {rfi.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{rfi.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              {projectMap && <span>{projectMap[rfi.project_id] || 'No project'}</span>}
              {rfi.due_date && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {format(new Date(rfi.due_date), 'MMM d, yyyy')}
                </span>
              )}
              <span>{rfi.responses?.length || 0} responses</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </Link>
  );
};

export default function RFIs() {
  const { user } = useAuth();
  const isAdminUser = isAdmin(user);
  const canCreateRfi = canCreate(user, 'rfis');
  const isInternalRole = canEdit(user, 'rfis');
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formDefaultProjectId, setFormDefaultProjectId] = useState('');
  const [viewMode, setViewMode] = useState('active');

  const { data: allRfis = [], isLoading } = useQuery({
    queryKey: ['rfis'],
    queryFn: () => RFI.list('-created_at', 200),
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => Project.list('-created_at', 100),
  });

  const projects = ['admin', 'internal', 'pricing'].includes(user?.role)
    ? allProjects
    : allProjects.filter(p => p.team?.some(m => normalizeEmail(m.user_email) === normalizeEmail(user?.email)));

  const ACTIVE_STATUSES = ['Active', 'On Hold', 'Complete'];
  const viewProjects = projects.filter(p =>
    viewMode === 'archived'
      ? p.status === 'Archived'
      : ACTIVE_STATUSES.includes(p.status)
  );
  const activeProjectIds = new Set(projects.filter(p => ACTIVE_STATUSES.includes(p.status)).map(p => p.id));
  const archivedProjectIds = new Set(projects.filter(p => p.status === 'Archived').map(p => p.id));

  const projectIds = new Set(projects.map(p => p.id));
  const allVisibleRfis = allRfis.filter(r => projectIds.has(r.project_id));
  const rfis = viewMode === 'archived'
    ? allVisibleRfis.filter(r => r.archived && archivedProjectIds.has(r.project_id))
    : allVisibleRfis.filter(r => !r.archived && activeProjectIds.has(r.project_id));
  // Counts use the same "parent project status" criterion as the grid below,
  // not just the RFI's own archived flag, so the tab counts never disagree
  // with what's actually shown (see HANDOVER 2026-07-01 for the two-cache-key gotcha).
  const activeRfiCount = allVisibleRfis.filter(r => !r.archived && activeProjectIds.has(r.project_id)).length;
  const archivedRfiCount = allVisibleRfis.filter(r => r.archived && archivedProjectIds.has(r.project_id)).length;
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  // Build per-project sequential RFI numbers
  const rfisByProject = {};
  rfis.forEach(r => {
    if (!rfisByProject[r.project_id]) rfisByProject[r.project_id] = [];
    rfisByProject[r.project_id].push(r);
  });
  Object.values(rfisByProject).forEach(list => list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
  const projectRfiNumber = {};
  Object.values(rfisByProject).forEach(list => {
    list.forEach((r, i) => { projectRfiNumber[r.id] = i + 1; });
  });

  // RFIs assigned to me (always exclude archived)
  const myRfis = allVisibleRfis.filter(r =>
    !r.archived && (
      r.assignees?.some(a => normalizeEmail(a.email) === normalizeEmail(user?.email)) ||
      normalizeEmail(r.assigned_to_email) === normalizeEmail(user?.email)
    )
  );

  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState('all');

  useEffect(() => {
    setProjectSearch('');
    setProjectStatusFilter('all');
  }, [selectedProjectId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const projectRfis = selectedProjectId ? rfis.filter(r => r.project_id === selectedProjectId) : [];
  const filteredProjectRfis = projectRfis.filter(r => {
    const q = projectSearch.toLowerCase();
    const matchSearch = !q || r.title?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q);
    const matchStatus = projectStatusFilter === 'all' || r.status === projectStatusFilter;
    return matchSearch && matchStatus;
  });

  if (selectedProject) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedProjectId(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => setSelectedProjectId(null)}>RFIs</span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm font-medium cursor-default">{selectedProject.name}</span>
        </div>
        <PageHeader
          title={selectedProject.name}
          description={`${projectRfis.length} RFI${projectRfis.length !== 1 ? 's' : ''}`}
          actions={
            canCreateRfi && (
              <Button onClick={() => { setFormDefaultProjectId(selectedProjectId); setShowForm(true); }} className="gap-2">
                <Plus className="w-4 h-4" /> New RFI
              </Button>
            )
          }
        />
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search RFIs..." value={projectSearch} onChange={e => setProjectSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={projectStatusFilter} onValueChange={setProjectStatusFilter}>
            <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="Answered">Answered</SelectItem>
              <SelectItem value="Closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filteredProjectRfis.length === 0 ? (
          <EmptyState icon={MessageSquareMore} title={projectRfis.length === 0 ? "No RFIs for this project" : "No RFIs match your filters"} description={projectRfis.length === 0 ? "Create the first RFI" : "Try adjusting your search or filters"} actionLabel={projectRfis.length === 0 && canCreateRfi ? "New RFI" : undefined} onAction={projectRfis.length === 0 && canCreateRfi ? () => setShowForm(true) : undefined} />
        ) : (
          <div className="space-y-3">
            {filteredProjectRfis.map(rfi => (
              <RFICard key={rfi.id} rfi={rfi} projectMap={null} rfiNumber={projectRfiNumber[rfi.id] || rfi.number} showPrivateBadge={isInternalRole} />
            ))}
          </div>
        )}
        <RFIFormDialog open={showForm} onOpenChange={setShowForm} projects={projects} defaultProjectId={formDefaultProjectId} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="RFIs"
        description="Requests for Information"
        actions={
          viewMode === 'active' && canCreateRfi && (
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="w-4 h-4" /> New RFI
            </Button>
          )
        }
      />

      <div className="flex gap-2 mb-4">
        <Button
          variant={viewMode === 'active' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setViewMode('active')}
        >
          Active {activeRfiCount > 0 && `(${activeRfiCount})`}
        </Button>
        <Button
          variant={viewMode === 'archived' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setViewMode('archived')}
        >
          <Archive className="w-3.5 h-3.5 mr-1.5" />
          Archived {archivedRfiCount > 0 && `(${archivedRfiCount})`}
        </Button>
      </div>

      {/* Assigned to me — only show in active view */}
      {viewMode === 'active' && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-primary" /> Assigned to Me
          </h2>
          {isLoading ? (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}</div>
          ) : myRfis.length === 0 ? (
            <Card><CardContent className="p-4 text-sm text-muted-foreground">No RFIs currently assigned to you.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {myRfis.map(rfi => (
                <RFICard key={rfi.id} rfi={rfi} projectMap={projectMap} rfiNumber={projectRfiNumber[rfi.id] || rfi.number} showPrivateBadge={isInternalRole} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Browse by project */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <FolderKanban className="w-4 h-4 text-primary" /> Browse by Project
        </h2>
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />)}
          </div>
        ) : (() => {
          const matchingProjects = viewProjects.filter(p => rfis.some(r => r.project_id === p.id));
          if (matchingProjects.length === 0) {
            return viewMode === 'archived'
              ? <EmptyState icon={Archive} title="No archived RFIs" description="Archived RFIs will appear here when a project is archived" />
              : <EmptyState icon={FolderKanban} title="No projects" description="You are not assigned to any projects" />;
          }
          return null;
        })() || (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {viewProjects.filter(p => rfis.some(r => r.project_id === p.id)).map(project => {
              const count = rfis.filter(r => r.project_id === project.id).length;
              const openCount = rfis.filter(r => r.project_id === project.id && r.status === 'Open').length;
              return (
                <Card
                  key={project.id}
                  className="hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 cursor-pointer"
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-foreground truncate pr-2">{project.name}</h3>
                      <StatusBadge status={project.status} />
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-3">
                      <span className="flex items-center gap-1">
                        <MessageSquareMore className="w-3 h-3" /> {count} total
                      </span>
                      {openCount > 0 && (
                        <span className="text-amber-600 font-medium">{openCount} open</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <RFIFormDialog open={showForm} onOpenChange={setShowForm} projects={projects} defaultProjectId={formDefaultProjectId} />
    </div>
  );
}