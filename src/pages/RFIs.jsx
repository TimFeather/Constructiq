import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import { Plus, Search, MessageSquareMore, Clock, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import RFIFormDialog from '@/components/rfis/RFIFormDialog';
import { format } from 'date-fns';

export default function RFIs() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);

  const { data: allRfis = [], isLoading } = useQuery({
    queryKey: ['rfis'],
    queryFn: () => base44.entities.RFI.list('-created_date', 200),
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100),
  });

  const projects = isAdmin
    ? allProjects
    : allProjects.filter(p => p.team?.some(m => m.user_email === user?.email));

  const projectIds = new Set(projects.map(p => p.id));
  const rfis = allRfis.filter(r => projectIds.has(r.project_id));
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  const filtered = rfis.filter(r => {
    const matchSearch = r.title?.toLowerCase().includes(search.toLowerCase()) ||
      String(r.number).includes(search);
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchPriority = priorityFilter === 'all' || r.priority === priorityFilter;
    return matchSearch && matchStatus && matchPriority;
  });

  return (
    <div>
      <PageHeader
        title="RFIs"
        description="Requests for Information"
        actions={
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="w-4 h-4" /> New RFI
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search RFIs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Open">Open</SelectItem>
            <SelectItem value="Answered">Answered</SelectItem>
            <SelectItem value="Closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={MessageSquareMore} title="No RFIs found" description="Create your first Request for Information" actionLabel="New RFI" onAction={() => setShowForm(true)} />
      ) : (
        <div className="space-y-3">
          {filtered.map(rfi => (
            <Link key={rfi.id} to={`/rfis/${rfi.id}`}>
              <Card className="hover:shadow-md transition-all duration-200 hover:border-primary/30 cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-primary">RFI-{String(rfi.number).padStart(3, '0')}</span>
                        <StatusBadge status={rfi.priority} />
                        <StatusBadge status={rfi.status} />
                      </div>
                      <h3 className="font-semibold text-sm mt-1.5">{rfi.title}</h3>
                      {rfi.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{rfi.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span>{projectMap[rfi.project_id] || 'No project'}</span>
                        {rfi.assigned_to_name && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" /> {rfi.assigned_to_name}
                          </span>
                        )}
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
          ))}
        </div>
      )}

      <RFIFormDialog open={showForm} onOpenChange={setShowForm} projects={projects} />
    </div>
  );
}