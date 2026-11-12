import React, { useState, useMemo } from 'react';
import { Project, RFI, Tender } from '@/api/entities';
import { projectDocumentsQuery } from '@/api/documentsData';
import { programmeTasksQuery, fetchProgramme, companyCalendarQuery } from '@/api/programmeData';
import { runScheduleEngine, calendarForProgramme } from '@/lib/scheduling/scheduleEngine';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Pencil, FileText, MessageSquareMore, BarChart2, ExternalLink, FileSignature, HardHat, Clock, Building2, MapPin, Phone, PauseCircle, Lock } from 'lucide-react';
import { isClosedStatus } from '@/api/projectStatus';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { PhoneLink } from '@/components/shared/ContactActions';
import TeamManager from '@/components/projects/TeamManager';
import ProjectFormDialog from '@/components/projects/ProjectFormDialog';
import ProjectSubcontractors from '@/components/projects/ProjectSubcontractors';
import ProjectRFIPanel from '@/components/rfis/ProjectRFIPanel';
import ProjectDocsPanel from '@/components/documents/ProjectDocsPanel';
import ProjectCIPanel from '@/components/projects/ProjectCIPanel';
import ActivityFeed from '@/components/shared/ActivityFeed';
import { useAuth } from '@/lib/AuthContext';
import { canEdit } from '@/lib/permissions';
import { format } from 'date-fns';
import { assigneeNames } from '@/lib/programme/assignees';

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const canManageProject = canEdit(user, 'projects');
  const isInternalRole = ['admin', 'pricing', 'internal'].includes(user?.role);
  const [showEdit, setShowEdit] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'team';
  const setActiveTab = (tab) => setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('tab', tab); return p; }, { replace: true });

  // refetchOnMount: 'always' — a project's status change cascades archived/active to its
  // documents and RFIs via a DB trigger. That can happen from a different page (the
  // Projects list), so this page must always pull live data on open rather than trust the
  // 60s query cache, or a just-archived/restored project can show stale counts/contents.
  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => Project.filter({ id }, '-created_at', 1).then(results => results[0] ?? null),
    refetchOnMount: 'always',
  });

  const { data: projectDocs = [] } = useQuery({
    ...projectDocumentsQuery(id),
    refetchOnMount: 'always',
  });

  const { data: projectRfis = [] } = useQuery({
    queryKey: ['rfis', id],
    queryFn: () => RFI.filter({ project_id: id }, '-created_at', 50),
    refetchOnMount: 'always',
  });

  const { data: projectTasks = [] } = useQuery({
    ...programmeTasksQuery(id),
    enabled: activeTab === 'programme',
  });

  // The Gantt shows the engine's dates, not the stored ones — stored dates go
  // stale (progress on a published programme doesn't rewrite the following
  // tasks, summary rows aren't kept current). Run the engine here on the same
  // programme calendar + data date so this list matches the full programme.
  const { data: programme = null } = useQuery({
    queryKey: ['programme', id],
    queryFn: () => fetchProgramme(id),
    enabled: activeTab === 'programme',
  });
  const { data: companyCalendar } = useQuery({
    ...companyCalendarQuery(),
    enabled: activeTab === 'programme',
  });
  const scheduledMap = useMemo(() => {
    if (!projectTasks.length) return new Map();
    return runScheduleEngine(projectTasks, null, calendarForProgramme(programme, projectTasks, companyCalendar), {
      dataDate: programme?.data_date || null,
      criticalToleranceDays: programme?.critical_slack_tolerance_days || 0,
    });
  }, [projectTasks, programme, companyCalendar]);
  const summaryIds = useMemo(
    () => new Set(projectTasks.filter(t => t.parent_id).map(t => t.parent_id)),
    [projectTasks],
  );

  // Find linked tender (if this project was converted from one)
  const { data: linkedTenders = [] } = useQuery({
    queryKey: ['linkedTender', id],
    queryFn: () => Tender.filter({ converted_project_id: id }),
    enabled: !!id,
  });
  const linkedTender = linkedTenders[0] ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">This project isn't available. It may have been closed, or you may not be on its team.</p>
        <Link to="/projects" className="text-primary hover:underline text-sm mt-2 block">Back to projects</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link to="/projects">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <span className="text-sm text-muted-foreground">Projects</span>
      </div>

      <PageHeader
        title={project.name}
        description={project.description}
        meta={
          (project.client_name || project.client_address || project.client_phone) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {project.client_name && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> {project.client_name}
                </span>
              )}
              {project.client_address && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> {project.client_address}
                </span>
              )}
              {project.client_phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> <PhoneLink phone={project.client_phone} />
                </span>
              )}
            </div>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            {linkedTender && (
              <Link to={`/tenders/${linkedTender.id}`} className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium border border-primary/30 rounded-md px-2.5 py-1.5">
                <FileSignature className="w-3.5 h-3.5" />
                Tender Source: {linkedTender.tender_number}
              </Link>
            )}
            {canManageProject && (
              <Button onClick={() => setShowEdit(true)} variant="outline" className="gap-2">
                <Pencil className="w-4 h-4" /> Edit
              </Button>
            )}
          </div>
        }
      />

      {project.status === 'On Hold' && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm mb-4">
          <PauseCircle className="w-4 h-4 flex-shrink-0" />
          This project is on hold.
        </div>
      )}
      {isClosedStatus(project.status) && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted text-muted-foreground px-4 py-3 text-sm mb-4">
          <Lock className="w-4 h-4 flex-shrink-0" />
          This project is closed ({project.status}). Only admins can see it. Change its status to reopen it for the team.
        </div>
      )}

      {/* Project info cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <StatusBadge status={project.status} className="mt-1" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Start Date</p>
            <p className="text-sm font-medium mt-1">
              {project.start_date ? format(new Date(project.start_date), 'MMM d, yyyy') : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">End Date</p>
            <p className="text-sm font-medium mt-1">
              {project.end_date ? format(new Date(project.end_date), 'MMM d, yyyy') : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Team Size</p>
            <p className="text-sm font-medium mt-1">{project.team?.length || 0} members</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} className="space-y-4" onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-1 px-1 pb-1"><TabsList className="inline-flex w-max">
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="documents" className="gap-1">
            <FileText className="w-3.5 h-3.5" /> Docs ({projectDocs.filter(d => !d.archived).length})
          </TabsTrigger>
          <TabsTrigger value="rfis" className="gap-1">
            <MessageSquareMore className="w-3.5 h-3.5" /> RFIs ({projectRfis.filter(r => !r.archived).length})
          </TabsTrigger>
          <TabsTrigger value="programme" className="gap-1">
            <BarChart2 className="w-3.5 h-3.5" /> Programme
          </TabsTrigger>
          <TabsTrigger value="cis" className="gap-1">
            <FileSignature className="w-3.5 h-3.5" /> CIs
          </TabsTrigger>
          <TabsTrigger value="subcontractors" className="gap-1">
            <HardHat className="w-3.5 h-3.5" /> Subcontractors
          </TabsTrigger>
          {isInternalRole && (
            <TabsTrigger value="activity" className="gap-1">
              <Clock className="w-3.5 h-3.5" /> Activity
            </TabsTrigger>
          )}
        </TabsList></div>

        <TabsContent value="team">
          <TeamManager project={project} />
        </TabsContent>

        <TabsContent value="documents">
          <ProjectDocsPanel project={project} docs={projectDocs} />
        </TabsContent>

        <TabsContent value="rfis">
          <ProjectRFIPanel project={project} rfis={projectRfis} />
        </TabsContent>

        <TabsContent value="cis">
          <ProjectCIPanel project={project} canManage={canManageProject} />
        </TabsContent>

        <TabsContent value="programme">
          <div className="space-y-3">
            <div className="flex justify-end">
              <Link to={`/programme?project=${id}`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <ExternalLink className="w-3.5 h-3.5" /> Open full programme
                </Button>
              </Link>
            </div>
            {projectTasks.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No tasks yet. Open the full programme to import or add tasks.</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/30 text-muted-foreground">
                          <th className="text-left px-3 py-2 font-medium w-16">WBS</th>
                          <th className="text-left px-3 py-2 font-medium">Name</th>
                          <th className="text-left px-3 py-2 font-medium w-48">Assigned</th>
                          <th className="text-center px-3 py-2 font-medium w-24">Start</th>
                          <th className="text-center px-3 py-2 font-medium w-24">End</th>
                          <th className="text-center px-3 py-2 font-medium w-16">Dur.</th>
                          <th className="text-center px-3 py-2 font-medium w-28">Progress</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {projectTasks.map(task => {
                          // Same values the Gantt's task list shows (TaskList getRowCtx)
                          const resolved = scheduledMap.get(task.id);
                          const start = resolved?.startStr || task.start_date;
                          const end = resolved?.finishStr || task.end_date;
                          const duration = resolved?.durationDays ?? task.duration ?? 1;
                          const isMilestone = task.is_milestone || task.duration === 0;
                          const pct = summaryIds.has(task.id)
                            ? (resolved?.rolledProgress ?? task.percent_complete ?? 0)
                            : (task.percent_complete || 0);
                          const indent = (task.level || 0) * 12;
                          return (
                            <tr key={task.id} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 font-mono text-muted-foreground">{task.wbs || '—'}</td>
                              <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + indent}px` }}>
                                <span className={task.level === 0 ? 'font-bold' : task.level === 1 ? 'font-semibold' : ''}>{task.name}</span>
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground max-w-[12rem] truncate" title={assigneeNames(task) || undefined}>
                                {assigneeNames(task) || '—'}
                              </td>
                              <td className="px-3 py-1.5 text-center text-muted-foreground font-mono">
                                {start ? format(new Date(start), 'dd/MM/yy') : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-center text-muted-foreground font-mono">
                                {end ? format(new Date(end), 'dd/MM/yy') : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-center text-muted-foreground">{isMilestone ? '—' : `${duration}d`}</td>
                              <td className="px-3 py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-muted-foreground w-7 text-right">{pct}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="subcontractors">
          <ProjectSubcontractors project={project} linkedTenderId={linkedTender?.id} />
        </TabsContent>

        {isInternalRole && (
          <TabsContent value="activity">
            <ActivityFeed projectId={id} />
          </TabsContent>
        )}
      </Tabs>

      <ProjectFormDialog open={showEdit} onOpenChange={setShowEdit} project={project} />
    </div>
  );
}