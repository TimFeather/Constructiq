import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Pencil, FileText, MessageSquareMore, Calendar } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import TeamManager from '@/components/projects/TeamManager';
import ProjectFormDialog from '@/components/projects/ProjectFormDialog';
import { format } from 'date-fns';

export default function ProjectDetail() {
  const { id } = useParams();
  const [showEdit, setShowEdit] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => base44.entities.Project.list().then(all => all.find(p => p.id === id)),
  });

  const { data: projectDocs = [] } = useQuery({
    queryKey: ['documents', id],
    queryFn: () => base44.entities.Document.filter({ project_id: id }, '-created_date', 50),
  });

  const { data: projectRfis = [] } = useQuery({
    queryKey: ['rfis', id],
    queryFn: () => base44.entities.RFI.filter({ project_id: id }, '-created_date', 50),
  });

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
        actions={
          <Button onClick={() => setShowEdit(true)} variant="outline" className="gap-2">
            <Pencil className="w-4 h-4" /> Edit
          </Button>
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

      <Tabs defaultValue="team" className="space-y-4">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="documents" className="gap-1">
            <FileText className="w-3.5 h-3.5" /> Docs ({projectDocs.length})
          </TabsTrigger>
          <TabsTrigger value="rfis" className="gap-1">
            <MessageSquareMore className="w-3.5 h-3.5" /> RFIs ({projectRfis.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="team">
          <TeamManager project={project} />
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent className="p-4">
              {projectDocs.length > 0 ? (
                <div className="space-y-2">
                  {projectDocs.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
                          {doc.name}
                        </a>
                        <p className="text-xs text-muted-foreground mt-0.5">{doc.file_type} · {doc.uploaded_by_name}</p>
                      </div>
                      <StatusBadge status={doc.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No documents attached</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rfis">
          <Card>
            <CardContent className="p-4">
              {projectRfis.length > 0 ? (
                <div className="space-y-2">
                  {projectRfis.map(rfi => (
                    <Link key={rfi.id} to={`/rfis/${rfi.id}`} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">#{rfi.number}</span>
                          <span className="text-sm font-medium">{rfi.title}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <StatusBadge status={rfi.priority} />
                          {rfi.due_date && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {format(new Date(rfi.due_date), 'MMM d')}
                            </span>
                          )}
                        </div>
                      </div>
                      <StatusBadge status={rfi.status} />
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No RFIs for this project</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ProjectFormDialog open={showEdit} onOpenChange={setShowEdit} project={project} />
    </div>
  );
}