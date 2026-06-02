import React, { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import StatusBadge from '@/components/shared/StatusBadge';
import { Plus, MessageSquare, ChevronDown, ChevronUp, Calendar, Send, Paperclip, ExternalLink, X, Loader2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { resolveTemplate, applyTemplate } from '@/lib/emailTemplates';

const PRIORITY_COLORS = {
  Low: 'bg-blue-100 text-blue-700',
  Medium: 'bg-amber-100 text-amber-700',
  High: 'bg-orange-100 text-orange-700',
  Critical: 'bg-red-100 text-red-700',
};

function RFICard({ rfi, project, emailTemplates = [] }) {
  const [expanded, setExpanded] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isAdminOrInternal = user?.role === 'admin' || user?.role === 'internal';
  const isOwner = rfi.created_by_email === user?.email || (!rfi.created_by_email && isAdminOrInternal);
  const isAssignee = rfi.assignees?.some(a => a.email === user?.email) || rfi.assigned_to_email === user?.email;

  const statusMutation = useMutation({
    mutationFn: (status) => base44.entities.RFI.update(rfi.id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rfis', project.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.RFI.delete(rfi.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rfis', project.id] }),
  });

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    setAttachments(prev => [...prev, ...files.map(f => ({ name: f.name, file: f }))]);
    e.target.value = '';
  };

  const removeAttachment = (idx) => setAttachments(prev => prev.filter((_, i) => i !== idx));

  const handleSendReply = async () => {
    if (!replyText.trim() && attachments.length === 0) return;
    setUploading(true);

    const uploadedAttachments = await Promise.all(
      attachments.map(async (a) => {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: a.file });
        return { name: a.name, url: file_url };
      })
    );

    const newResponse = {
      author_email: user?.email || '',
      author_name: user?.full_name || user?.email || 'Unknown',
      content: replyText.trim(),
      timestamp: new Date().toISOString(),
      attachments: uploadedAttachments,
    };

    const updatedResponses = [...(rfi.responses || []), newResponse];
    // Auto-mark as Answered when a response is sent
    const newStatus = rfi.status === 'Open' ? 'Answered' : rfi.status;
    await base44.entities.RFI.update(rfi.id, { responses: updatedResponses, status: newStatus });

    // Notify the RFI owner/creator
    const rfiRef = `RFI-${String(rfi.number).padStart(3, '0')}`;
    const rfiUrl = `${window.location.origin}/rfis/${rfi.id}`;
    const tpl = resolveTemplate(emailTemplates, 'rfi_response');
    const { subject, body } = applyTemplate(tpl, {
      rfi_ref: rfiRef,
      title: rfi.title,
      responder_name: user?.full_name || 'A team member',
      response_text: replyText.trim(),
      url: rfiUrl,
    });

    const notifyEmails = new Set();
    if (rfi.created_by_email && rfi.created_by_email !== user?.email) notifyEmails.add(rfi.created_by_email);
    (rfi.assignees || []).forEach(a => { if (a.email && a.email !== user?.email) notifyEmails.add(a.email); });
    if (rfi.assigned_to_email && rfi.assigned_to_email !== user?.email) notifyEmails.add(rfi.assigned_to_email);

    notifyEmails.forEach(email => {
      base44.integrations.Core.SendEmail({ to: email, subject, body });
    });

    queryClient.invalidateQueries({ queryKey: ['rfis', project.id] });
    setReplyText('');
    setAttachments([]);
    setUploading(false);
  };

  // Status options based on role
  const statusOptions = isOwner
    ? ['Open', 'Answered', 'Closed']
    : isAssignee
    ? ['Open', 'Answered']
    : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div
          className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground">#{String(rfi.number).padStart(3, '0')}</span>
              <span className="text-sm font-semibold">{rfi.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[rfi.priority] || ''}`}>
                {rfi.priority}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              {rfi.assigned_to_name && <span>→ {rfi.assigned_to_name}</span>}
              {rfi.due_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {format(new Date(rfi.due_date), 'MMM d, yyyy')}
                </span>
              )}
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {(rfi.responses || []).length} response{(rfi.responses || []).length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={rfi.status} />
            {isAdminOrInternal && (
              <button
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                onClick={e => { e.stopPropagation(); deleteMutation.mutate(); }}
                title="Delete RFI"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>

        {expanded && (
          <div className="border-t px-4 pb-4 space-y-4">
            {rfi.description && (
              <div className="pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                <p className="text-sm">{rfi.description}</p>
              </div>
            )}

            {(rfi.attachments || []).length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Attachments</p>
                <div className="flex flex-wrap gap-2">
                  {rfi.attachments.map((att, i) => (
                    <a key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-1 rounded hover:bg-primary/20 transition-colors">
                      <Paperclip className="w-3 h-3" />{att.name}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {(rfi.responses || []).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Responses</p>
                {rfi.responses.map((resp, i) => (
                  <div key={i} className="bg-muted/40 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{resp.author_name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {resp.timestamp ? format(new Date(resp.timestamp), 'MMM d, HH:mm') : ''}
                      </span>
                    </div>
                    {resp.content && <p className="text-sm">{resp.content}</p>}
                    {(resp.attachments || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {resp.attachments.map((att, j) => (
                          <a key={j} href={att.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-1 rounded hover:bg-primary/20 transition-colors">
                            <ExternalLink className="w-3 h-3" />{att.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Status change for assignees */}
            {statusOptions && rfi.status !== 'Closed' && (
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Change status:</p>
                {statusOptions.filter(s => s !== rfi.status).map(s => (
                  <Button key={s} size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => statusMutation.mutate(s)} disabled={statusMutation.isPending}>
                    {s}
                  </Button>
                ))}
              </div>
            )}

            {/* Reply box */}
            {rfi.status !== 'Closed' && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium text-muted-foreground">Add Response</p>
                <Textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type your response..."
                  rows={3}
                  className="text-sm resize-none"
                />
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((a, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
                        <Paperclip className="w-3 h-3 text-muted-foreground" />
                        <span>{a.name}</span>
                        <button onClick={() => removeAttachment(i)} className="ml-1 hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      <Paperclip className="w-3 h-3" /> Attach
                    </Button>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                    {/* Only owner can close */}
                    {isOwner && (
                      <Button size="sm" variant="outline" className="text-xs h-8"
                        onClick={() => statusMutation.mutate('Closed')} disabled={statusMutation.isPending || uploading}>
                        Close RFI
                      </Button>
                    )}
                  </div>
                  <Button size="sm" className="gap-1.5 h-8 text-xs"
                    onClick={handleSendReply}
                    disabled={(!replyText.trim() && attachments.length === 0) || uploading}>
                    {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    {uploading ? 'Sending...' : 'Send Response'}
                  </Button>
                </div>
              </div>
            )}

            {rfi.status === 'Closed' && isOwner && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" className="text-xs h-8"
                  onClick={() => statusMutation.mutate('Open')} disabled={statusMutation.isPending}>
                  Re-open RFI
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProjectRFIPanel({ project, rfis = [] }) {
  const { user } = useAuth();
  const isAdminOrInternal = user?.role === 'admin' || user?.role === 'internal';
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'Medium', due_date: '', assigned_to_email: '', assigned_to_name: '' });
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();
  const teamMembers = project?.team || [];

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => base44.entities.EmailTemplate.list(),
  });

  const handleAssigneeChange = (value) => {
    if (value === 'unassigned') {
      setForm(f => ({ ...f, assigned_to_email: '', assigned_to_name: '' }));
      return;
    }
    const member = teamMembers.find(m => m.user_email === value);
    if (member) setForm(f => ({ ...f, assigned_to_email: member.user_email, assigned_to_name: member.full_name }));
  };

  const handleCreate = async () => {
    if (!form.title) return;
    setUploading(true);

    const projectRFIs = await base44.entities.RFI.filter({ project_id: project.id }, '-number', 1);
    const nextNumber = projectRFIs.length > 0 ? (projectRFIs[0].number || 0) + 1 : 1;

    const uploadedAttachments = await Promise.all(
      attachments.map(async (a) => {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: a.file });
        return { name: a.name, url: file_url };
      })
    );

    const rfi = await base44.entities.RFI.create({
      ...form,
      project_id: project.id,
      number: nextNumber,
      status: 'Open',
      responses: [],
      attachments: uploadedAttachments,
      created_by_email: user?.email || '',
      created_by_name: user?.full_name || '',
    });

    if (form.assigned_to_email) {
      base44.integrations.Core.SendEmail({
        to: form.assigned_to_email,
        subject: `New RFI Assigned: ${form.title}`,
        body: `You have been assigned RFI-${String(nextNumber).padStart(3, '0')}: ${form.title}\n\nDescription: ${form.description || 'No description'}\n\nPlease log in to respond.`,
      });
    }

    queryClient.invalidateQueries({ queryKey: ['rfis', project.id] });
    setShowCreate(false);
    setForm({ title: '', description: '', priority: 'Medium', due_date: '', assigned_to_email: '', assigned_to_name: '' });
    setAttachments([]);
    setUploading(false);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    setAttachments(prev => [...prev, ...files.map(f => ({ name: f.name, file: f }))]);
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rfis.length} RFI{rfis.length !== 1 ? 's' : ''}</p>
        {isAdminOrInternal && (
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setShowCreate(true)}>
            <Plus className="w-3 h-3" /> New RFI
          </Button>
        )}
      </div>

      {rfis.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg">
          No RFIs for this project yet.
        </div>
      )}

      {rfis.map(rfi => (
        <RFICard key={rfi.id} rfi={rfi} project={project} emailTemplates={emailTemplates} />
      ))}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New RFI — {project.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="RFI title" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Describe the information needed" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Assign To</Label>
              {teamMembers.length > 0 ? (
                <Select value={form.assigned_to_email || 'unassigned'} onValueChange={handleAssigneeChange}>
                  <SelectTrigger><SelectValue placeholder="Select team member" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">— Unassigned —</SelectItem>
                    {teamMembers.map(m => (
                      <SelectItem key={m.user_email} value={m.user_email}>{m.full_name} — {m.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Input value={form.assigned_to_name} onChange={e => setForm({ ...form, assigned_to_name: e.target.value })} placeholder="Name" />
                  <Input type="email" value={form.assigned_to_email} onChange={e => setForm({ ...form, assigned_to_email: e.target.value })} placeholder="Email" />
                </div>
              )}
            </div>
            <div>
              <Label>Attachments</Label>
              <div className="space-y-2">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((a, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
                        <Paperclip className="w-3 h-3 text-muted-foreground" />
                        <span>{a.name}</span>
                        <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="ml-1 hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="w-3 h-3" /> Add Files
                </Button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.title || uploading}>
              {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Creating...</> : 'Create RFI'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}