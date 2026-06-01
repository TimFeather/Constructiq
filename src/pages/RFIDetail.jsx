import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Send, Clock, User, Paperclip, Upload } from 'lucide-react';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { format } from 'date-fns';

export default function RFIDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [response, setResponse] = useState('');
  const [responseFile, setResponseFile] = useState(null);
  const queryClient = useQueryClient();

  const { data: rfi, isLoading } = useQuery({
    queryKey: ['rfi', id],
    queryFn: () => base44.entities.RFI.list().then(all => all.find(r => r.id === id)),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date', 100),
  });

  const statusMutation = useMutation({
    mutationFn: (status) => base44.entities.RFI.update(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rfi', id] }),
  });

  const respondMutation = useMutation({
    mutationFn: async () => {
      let attachments = [];
      if (responseFile) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: responseFile });
        attachments = [{ name: responseFile.name, url: file_url }];
      }
      const newResponse = {
        author_email: user?.email || '',
        author_name: user?.full_name || 'User',
        content: response,
        timestamp: new Date().toISOString(),
        attachments,
      };
      const existing = rfi?.responses || [];
      await base44.entities.RFI.update(id, { responses: [...existing, newResponse] });
      // Notify RFI creator
      if (rfi?.created_by && rfi.created_by !== user?.email) {
        base44.integrations.Core.SendEmail({
          to: rfi.created_by,
          subject: `New response on RFI-${String(rfi.number).padStart(3, '0')}: ${rfi.title}`,
          body: `${user?.full_name || 'A user'} responded to RFI-${String(rfi.number).padStart(3, '0')}:\n\n${response}`
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfi', id] });
      setResponse('');
      setResponseFile(null);
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  if (!rfi) {
    return <div className="text-center py-16"><p className="text-muted-foreground">RFI not found</p></div>;
  }

  const projectName = projects.find(p => p.id === rfi.project_id)?.name || '';

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link to="/rfis">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <span className="text-sm text-muted-foreground">RFIs</span>
      </div>

      <PageHeader
        title={
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-mono text-primary">RFI-{String(rfi.number).padStart(3, '0')}</span>
            <span>{rfi.title}</span>
          </div>
        }
        actions={
          <Select value={rfi.status} onValueChange={v => statusMutation.mutate(v)}>
            <SelectTrigger className="w-36"><StatusBadge status={rfi.status} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="Answered">Answered</SelectItem>
              <SelectItem value="Closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {/* RFI Details */}
      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground whitespace-pre-wrap">{rfi.description || 'No description provided'}</p>
            {rfi.attachments?.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">Attachments</p>
                {rfi.attachments.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
                    <Paperclip className="w-3 h-3" /> {a.name}
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Priority</p>
              <StatusBadge status={rfi.priority} className="mt-1" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Project</p>
              <p className="text-sm font-medium mt-0.5">{projectName || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Assigned To</p>
              <p className="text-sm font-medium mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3" /> {rfi.assigned_to_name || '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Due Date</p>
              <p className="text-sm font-medium mt-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {rfi.due_date ? format(new Date(rfi.due_date), 'MMM d, yyyy') : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm font-medium mt-0.5">
                {format(new Date(rfi.created_date), 'MMM d, yyyy')}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Response Thread */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Responses ({rfi.responses?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(rfi.responses || []).map((resp, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-semibold text-primary">
                  {resp.author_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">{resp.author_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(resp.timestamp), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap">{resp.content}</p>
                {resp.attachments?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {resp.attachments.map((a, j) => (
                      <a key={j} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Paperclip className="w-3 h-3" /> {a.name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Reply form */}
          <div className="border-t pt-4">
            <Textarea
              placeholder="Type your response..."
              value={response}
              onChange={e => setResponse(e.target.value)}
              rows={3}
              className="mb-3"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  className="w-auto text-xs"
                  onChange={e => setResponseFile(e.target.files[0])}
                />
              </div>
              <Button
                onClick={() => respondMutation.mutate()}
                disabled={!response.trim() || respondMutation.isPending}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                {respondMutation.isPending ? 'Sending...' : 'Send Response'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}