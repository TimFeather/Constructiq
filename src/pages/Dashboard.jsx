import React from 'react';
import { Document, Project, RFI, Task } from '@/api/entities';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isAdmin } from '@/lib/permissions';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FolderKanban, FileText, MessageSquareMore, GanttChart, ArrowRight, Clock } from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';
import PageHeader from '@/components/shared/PageHeader';
import { format } from 'date-fns';

function StatCard({ icon: Icon, label, value, color, to }) {
  return (
    <Link to={to}>
      <Card className="hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 cursor-pointer group">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{label}</p>
              <p className="text-3xl font-bold mt-1 font-heading">{value}</p>
            </div>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground group-hover:text-primary transition-colors">
            View all <ArrowRight className="w-3 h-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const userIsAdmin = isAdmin(user);

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => Project.list('-created_at', 100),
  });

  const projects = userIsAdmin
    ? allProjects
    : allProjects.filter(p => p.team?.some(m => m.user_email === user?.email));

  const projectIds = new Set(projects.map(p => p.id));

  const { data: allRfis = [] } = useQuery({
    queryKey: ['rfis'],
    queryFn: () => RFI.list('-created_at', 200),
    enabled: projectIds.size > 0 || userIsAdmin,
  });

  const { data: allDocuments = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: () => Document.list('-created_at', 100),
    enabled: projectIds.size > 0 || userIsAdmin,
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => Task.list('-updated_at', 500),
    enabled: projectIds.size > 0 || userIsAdmin,
  });

  const rfis = allRfis.filter(r => projectIds.has(r.project_id));
  const documents = allDocuments.filter(d => projectIds.has(d.project_id));
  const tasks = allTasks.filter(t => projectIds.has(t.project_id));

  const activeProjects = projects.filter(p => p.status === 'Active');
  const openRfis = rfis.filter(r => r.status === 'Open');
  const recentDocs = documents.slice(0, 5);
  const recentRfis = rfis.slice(0, 5);

  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  const overdueTasks = tasks
    .filter(t => t.end_date && t.end_date < today && (t.percent_complete || 0) < 100)
    .sort((a, b) => a.end_date.localeCompare(b.end_date))
    .slice(0, 8);

  const dueSoonTasks = tasks
    .filter(t => t.end_date && t.end_date >= today && t.end_date <= nextWeek && (t.percent_complete || 0) < 100)
    .sort((a, b) => a.end_date.localeCompare(b.end_date))
    .slice(0, 8);

  return (
    <div>
      <PageHeader 
        title="Dashboard" 
        description="Overview of your construction projects" 
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={FolderKanban} label="Active Projects" value={activeProjects.length} color="bg-primary" to="/projects" />
        <StatCard icon={MessageSquareMore} label="Open RFIs" value={openRfis.length} color="bg-amber-500" to="/rfis" />
        <StatCard icon={FileText} label="Documents" value={documents.length} color="bg-purple-500" to="/documents" />
        <StatCard icon={GanttChart} label="Tasks" value={tasks.length} color="bg-accent" to="/programme" />
      </div>

      {/* Deadlines Widget */}
      {(overdueTasks.length > 0 || dueSoonTasks.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4 mb-8">
          {overdueTasks.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-red-600 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Overdue Tasks ({overdueTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {overdueTasks.map(task => (
                  <Link key={task.id} to={`/programme?project=${task.project_id}`} className="flex items-center justify-between p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{task.name}</p>
                      <p className="text-xs text-muted-foreground">{projectMap[task.project_id] || ''}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-xs font-medium text-red-600">{format(new Date(task.end_date), 'MMM d')}</p>
                      <p className="text-xs text-muted-foreground">{task.percent_complete || 0}%</p>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          {dueSoonTasks.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-amber-600 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Due This Week ({dueSoonTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {dueSoonTasks.map(task => (
                  <Link key={task.id} to={`/programme?project=${task.project_id}`} className="flex items-center justify-between p-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{task.name}</p>
                      <p className="text-xs text-muted-foreground">{projectMap[task.project_id] || ''}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-xs font-medium text-amber-600">{format(new Date(task.end_date), 'MMM d')}</p>
                      <p className="text-xs text-muted-foreground">{task.percent_complete || 0}%</p>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Projects */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Recent Projects</CardTitle>
              <Link to="/projects" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.slice(0, 5).map(project => (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{project.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {project.team?.length || 0} team members
                  </p>
                </div>
                <StatusBadge status={project.status} />
              </Link>
            ))}
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No projects yet</p>
            )}
          </CardContent>
        </Card>

        {/* Recent RFIs */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Recent RFIs</CardTitle>
              <Link to="/rfis" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentRfis.map(rfi => (
              <Link
                key={rfi.id}
                to={`/rfis/${rfi.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">#{rfi.number}</span>
                    <p className="text-sm font-medium truncate">{rfi.title}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={rfi.priority} />
                    {rfi.due_date && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(rfi.due_date), 'MMM d')}
                      </span>
                    )}
                  </div>
                </div>
                <StatusBadge status={rfi.status} />
              </Link>
            ))}
            {rfis.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No RFIs yet</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Documents */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Recent Documents</CardTitle>
              <Link to="/documents" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium hidden sm:table-cell">Type</th>
                    <th className="pb-2 font-medium hidden md:table-cell">Uploaded by</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recentDocs.map(doc => (
                    <tr key={doc.id} className="hover:bg-muted/50">
                      <td className="py-2.5">
                        <a 
                          href={doc.file_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:underline font-medium truncate block max-w-[200px]"
                        >
                          {doc.name}
                        </a>
                      </td>
                      <td className="py-2.5 hidden sm:table-cell text-muted-foreground">{doc.file_type}</td>
                      <td className="py-2.5 hidden md:table-cell text-muted-foreground">{doc.uploaded_by_name}</td>
                      <td className="py-2.5"><StatusBadge status={doc.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {documents.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No documents yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}