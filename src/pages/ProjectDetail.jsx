import React, { useState } from 'react';
import { Document, Project, RFI, Task, Tender } from '@/api/entities';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Pencil, FileText, MessageSquareMore, BarChart2, ExternalLink, FileSignature, HardHat, Clock, Building2, MapPin, Phone } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
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
    queryKey: ['documents', id],
    queryFn: () => Document.filter({ project_id: id }, '-created_at', 50),
    refetchOnMount: 'always',
  });

  const { data: projectRfis = [] } = useQuery({
    queryKey: ['rfis', id],
    queryFn: () => RFI.filter({ project_id: id }, '-created_at', 50),
    refetchOnMount: 'always',
  });

  const { data: projectTasks = [] } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => Task.filter({ project_id: id }, 'sort_order', 100),
    enabled: activeTab === 'programme',
  });

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
        <p className="text-muted-foreground">Project not found</p>
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
                  <Phone className="w-3.5 h-3.5" /> {project.client_phone}
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
                          <th className="text-center px-3 py-2 font-medium w-24">Start</th>
                          <th className="text-center px-3 py-2 font-medium w-24">End</th>
                          <th className="text-center px-3 py-2 font-medium w-16">Dur.</th>
                          <th className="text-center px-3 py-2 font-medium w-28">Progress</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {projectTasks.map(task => {
                          const pct = task.percent_complete || 0;
                          const indent = (task.level || 0) * 12;
                          return (
                            <tr key={task.id} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 font-mono text-muted-foreground">{task.wbs || '—'}</td>
                              <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + indent}px` }}>
                                <span className={task.level === 0 ? 'font-bold' : task.level === 1 ? 'font-semibold' : ''}>{task.name}</span>
                              </td>
                              <td className="px-3 py-1.5 text-center text-muted-foreground font-mono">
                                {task.start_date ? format(new Date(task.start_date), 'dd/MM/yy') : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-center text-muted-foreground font-mono">
                                {task.end_date ? format(new Date(task.end_date), 'dd/MM/yy') : '—'}
                              </td>
                              <td className="px-3 py-1.5 text-center text-muted-foreground">{task.duration || '—'}d</td>
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