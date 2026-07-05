import { invokeFunction, uploadFile } from '@/api/supabaseClient';
import SecureFileLink from '@/components/shared/SecureFileLink';
import React, { useState } from 'react';
import { EmailBranding, EmailTemplate, Project, RFI, User } from '@/api/entities';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ArrowLeft, Send, Clock, UserIcon, Paperclip, Trash2, Pencil, Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { format } from 'date-fns';
import { resolveTemplate, applyTemplate, buildEmailHtml } from '@/lib/emailTemplates';
import { canEdit } from '@/lib/permissions';
import { logProjectActivity } from '@/lib/activityLog';
import ActivityFeed from '@/components/shared/ActivityFeed';
import RFIAssigneesDialog from '@/components/rfis/RFIAssigneesDialog';
import { useToast } from '@/components/ui/use-toast';

export default function RFIDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [response, setResponse] = useState('');
  const [responseFile, setResponseFile] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAssigneesDialog, setShowAssigneesDialog] = useState(false);
  const queryClient = useQueryClient();

  const isAdminOrInternal = canEdit(user, 'rfis');

  const { data: rfi, isLoading } = useQuery({
    queryKey: ['rfi', id],
    queryFn: () => RFI.filter({ id }, '-created_at', 1).then(results => results[0] ?? null),
  });

  const { data: project } = useQuery({
    queryKey: ['project', rfi?.project_id],
    queryFn: () => rfi?.project_id
      ? Project.filter({ id: rfi.project_id }, '-created_at', 1).then(r => r[0] ?? null)
      : null,
    enabled: !!rfi?.project_id,
  });

  const { data: emailBranding = {} } = useQuery({
    queryKey: ['emailBranding'],
    queryFn: () => EmailBranding.list().then(r => r[0] ?? {}),
  });

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => EmailTemplate.list(),
  });

  const showReplyForm = rfi?.status !== 'Closed';

  const { data: registeredUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => User.list(),
    enabled: showReplyForm,
  });

  const isOwner = rfi?.created_by_email === user?.email || (!rfi?.created_by_email && isAdminOrInternal);
  const isAssignee = rfi?.assignees?.some(a => a.email === user?.email) || rfi?.assigned_to_email === user?.email;

  const statusMutation = useMutation({
    mutationFn: (status) => RFI.update(id, { status }),
    onSuccess: (_data, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['rfi', id] });
      queryClient.invalidateQueries({ queryKey: ['rfis'] });
      logProjectActivity({
        projectId: rfi.project_id,
        entityType: 'rfi',
        entityId: id,
        eventType: 'rfi_status_changed',
        user,
        description: `RFI-${String(rfi.number).padStart(3, '0')} status changed from ${rfi.status} to ${newStatus}`,
        metadata: { from: rfi.status, to: newStatus },
      }).catch(() => {});
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => RFI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis'] });
      navigate('/rfis', { replace: true });
    },
  });

  const visibilityMutation = useMutation({
    mutationFn: (nextIsPublic) => RFI.update(id, { is_public: nextIsPublic }),
    onSuccess: (_data, nextIsPublic) => {
      queryClient.invalidateQueries({ queryKey: ['rfi', id] });
      queryClient.invalidateQueries({ queryKey: ['rfis'] });
      logProjectActivity({
        projectId: rfi.project_id,
        entityType: 'rfi',
        entityId: id,
        eventType: 'rfi_visibility_changed',
        user,
        description: `RFI made ${nextIsPublic ? 'public' : 'private'}`,
      }).catch(() => {});
    },
  });

  const respondMutation = useMutation({
    mutationFn: async () => {
      let attachments = [];
      if (responseFile) {
        // RFI response attachments are private — store in the private project-files bucket.
        const { file_url } = await uploadFile(responseFile, 'project-files');
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
      // Mark as Answered when response is sent
      await RFI.update(id, {
        responses: [...existing, newResponse],
        status: rfi?.status === 'Open' ? 'Answered' : rfi?.status,
      });

      // Notify the RFI owner/creator
      const rfiRef = `RFI-${String(rfi.number).padStart(3, '0')}: ${rfi.title}`;
      const rfiUrl = `${window.location.origin}/rfis/${id}`;
      const tpl = resolveTemplate(emailTemplates, 'rfi_response');
      const { subject, body } = applyTemplate(tpl, {
        rfi_ref: `RFI-${String(rfi.number).padStart(3, '0')}`,
        title: rfi.title,
        project_name: project?.name || projectName || 'Unknown Project',
        responder_name: user?.full_name || 'A team member',
        response_text: response,
        url: rfiUrl,
      });
      const htmlBody = buildEmailHtml(body, emailBranding);

      const notifyEmails = new Set();
      if (rfi?.created_by_email && rfi.created_by_email !== user?.email) notifyEmails.add(rfi.created_by_email);
      (rfi?.assignees || []).forEach(a => { if (a.email && a.email !== user?.email) notifyEmails.add(a.email); });
      if (rfi?.assigned_to_email && rfi.assigned_to_email !== user?.email) notifyEmails.add(rfi.assigned_to_email);

      const registered = [];
      const skipped = [];
      notifyEmails.forEach(email => {
        if (registeredUsers.some(u => u.email?.toLowerCase() === email?.toLowerCase())) {
          registered.push(email);
        } else {
          skipped.push(email);
        }
      });

      if (skipped.length > 0) {
        toast({
          title: 'Some recipients not notified',
          description: `${skipped.join(', ')} ${skipped.length === 1 ? "doesn't" : "don't"} have a ConstructIQ account, so no email was sent to them.`,
        });
      }

      registered.forEach(email => {
        invokeFunction('sendEmail', { to: email, subject, htmlBody }).catch((e) => {
          console.warn('[RFIDetail] failed to notify recipient by email:', email, e?.message || e);
          toast({ variant: 'destructive', title: `Could not notify ${email} by email` });
        });
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfi', id] });
      queryClient.invalidateQueries({ queryKey: ['rfis'] });
      logProjectActivity({
        projectId: rfi.project_id,
        entityType: 'rfi',
        entityId: id,
        eventType: 'rfi_response',
        user,
        description: `Response added to RFI-${String(rfi.number).padStart(3, '0')}`,
      }).catch(() => {});
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

  const projectName = project?.name || '';

  // Back navigation: go back to the project view if we came from a project
  const handleBack = () => navigate(-1);

  // Status options based on role
  const statusOptions = isOwner
    ? ['Open', 'Answered', 'Closed']
    : isAssignee
    ? ['Open', 'Answered']
    : [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm text-muted-foreground cursor-pointer hover:text-foreground" onClick={handleBack}>RFIs</span>
        {projectName && (
          <>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">{projectName}</span>
          </>
        )}
      </div>

      <PageHeader
        title={
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-mono text-primary">RFI-{String(rfi.number).padStart(3, '0')}</span>
            <span>{rfi.title}</span>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            {statusOptions.length > 0 && (
              <Select value={rfi.status} onValueChange={v => statusMutation.mutate(v)}>
                <SelectTrigger className="w-36"><StatusBadge status={rfi.status} /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {!statusOptions.length && <StatusBadge status={rfi.status} />}
            <Badge
              variant={rfi.is_public ? 'secondary' : 'outline'}
              className={`gap-1 ${isOwner || isAdminOrInternal ? 'cursor-pointer' : ''}`}
              onClick={() => {
                if (isOwner || isAdminOrInternal) visibilityMutation.mutate(!rfi.is_public);
              }}
              title={isOwner || isAdminOrInternal ? 'Click to toggle visibility' : undefined}
            >
              {rfi.is_public ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {rfi.is_public ? 'Public' : 'Private'}
            </Badge>
            {isAdminOrInternal && (
              <Button variant="destructive" size="icon" onClick={() => setShowDeleteDialog(true)} disabled={deleteMutation.isPending} title="Delete RFI">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        }
      />

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-foreground whitespace-pre-wrap">{rfi.description || 'No description provided'}</p>
            {rfi.attachments?.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">Attachments</p>
                {rfi.attachments.map((a, i) => (
                  <SecureFileLink key={i} value={a.url} className="flex items-center gap-2 text-sm text-primary hover:underline">
                    <Paperclip className="w-3 h-3" /> {a.name}
                  </SecureFileLink>
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
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Assigned To</p>
                {(isOwner || isAdminOrInternal) && (
                  <button
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={() => setShowAssigneesDialog(true)}
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>
              {(rfi.assignees?.length > 0) ? (
                <div className="mt-0.5 space-y-0.5">
                  {rfi.assignees.map((a, i) => (
                    <p key={i} className="text-sm font-medium flex items-center gap-1">
                      <UserIcon className="w-3 h-3 flex-shrink-0" /> {a.name}
                      {a.role && <span className="text-xs text-muted-foreground font-normal">· {a.role}</span>}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-medium mt-0.5 flex items-center gap-1">
                  <UserIcon className="w-3 h-3" /> {rfi.assigned_to_name || '—'}
                </p>
              )}
            </div>
            {rfi.created_by_name && (
              <div>
                <p className="text-xs text-muted-foreground">Created By</p>
                <p className="text-sm font-medium mt-0.5">{rfi.created_by_name}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Due Date</p>
              <p className="text-sm font-medium mt-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {rfi.due_date ? format(new Date(rfi.due_date), 'MMM d, yyyy') : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm font-medium mt-0.5">{format(new Date(rfi.created_at), 'MMM d, yyyy')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

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
                  <span className="text-xs text-muted-foreground">{resp.timestamp ? format(new Date(resp.timestamp), 'MMM d, yyyy h:mm a') : 'Date unknown'}</span>
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap">{resp.content}</p>
                {resp.attachments?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {resp.attachments.map((a, j) => (
                      <SecureFileLink key={j} value={a.url} className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Paperclip className="w-3 h-3" /> {a.name}
                      </SecureFileLink>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Reply form — visible if not closed */}
          {showReplyForm && (
            <div className="border-t pt-4">
              <Textarea
                placeholder="Type your response..."
                value={response}
                onChange={e => setResponse(e.target.value)}
                rows={3}
                className="mb-3"
              />
              <div className="flex items-center justify-between">
                <Input type="file" className="w-auto text-xs" onChange={e => setResponseFile(e.target.files[0])} />
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
          )}

          {/* Owner can close/reopen */}
          {isOwner && rfi.status === 'Answered' && (
            <div className="flex justify-end pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => statusMutation.mutate('Closed')}>
                Close RFI
              </Button>
            </div>
          )}
          {isOwner && rfi.status === 'Closed' && (
            <div className="flex justify-end pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => statusMutation.mutate('Open')}>
                Re-open RFI
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isAdminOrInternal && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
          <CardContent>
            <ActivityFeed projectId={rfi.project_id} entityType="rfi" entityId={rfi.id} compact />
          </CardContent>
        </Card>
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete RFI?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>RFI-{String(rfi.number).padStart(3, '0')}: {rfi.title}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RFIAssigneesDialog
        open={showAssigneesDialog}
        onOpenChange={setShowAssigneesDialog}
        rfi={rfi}
        project={project}
      />
    </div>
  );
}