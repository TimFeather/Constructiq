import { supabase, invokeFunction } from '@/api/supabaseClient';
import React, { useState, useEffect } from 'react';
import { EmailBranding, EmailTemplate, User, TradeTemplate } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Save, Bell, Mail, Palette, Tag, Trash2, FolderOpen, FileSignature, Users, FlaskConical, PlayCircle, Loader2, AlertTriangle } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/shared/PageHeader';
import { DEFAULT_TEMPLATES } from '@/lib/emailTemplates';
import { isAdmin as checkAdmin } from '@/lib/permissions';
import AppearanceSettings from '@/components/settings/AppearanceSettings';
import RoleManager from '@/components/settings/RoleManager';
import SubcontractorDirectory from '@/components/settings/SubcontractorDirectory';
import EmailBrandingPanel from '@/components/settings/EmailBrandingPanel';
import EmailDeliveryLog from '@/components/settings/EmailDeliveryLog';
import EmailTemplateEditor from '@/components/settings/EmailTemplateEditor';
import DocumentFolderTemplates from '@/components/settings/DocumentFolderTemplates';
import TenderSettingsPanel from '@/components/settings/TenderSettingsPanel';
import PeopleSettings from '@/components/settings/PeopleSettings';
import TestUtilities from '@/components/settings/TestUtilities';
import SystemHealth from '@/components/settings/SystemHealth';


export default function Settings() {
  const { user, checkUserAuth } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState({
    first_name: '', last_name: '', phone: '', business_name: '',
    notify_rfis: true, notify_documents: true,
  });

  const [editingTemplate, setEditingTemplate] = useState(null);
  const [deleteStep, setDeleteStep] = useState(0);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => User.list(),
    enabled: user?.role === 'admin' || user?.role === 'internal',
  });

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => EmailTemplate.list(),
    enabled: user?.role === 'admin' || user?.role === 'internal',
  });

  useEffect(() => {
    if (user) {
      setProfile({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        phone: user.phone || '',
        business_name: user.business_name || '',
        notify_rfis: user.notify_rfis !== false,
        notify_documents: user.notify_documents !== false,
      });
    }
  }, [user]);

  const profileMutation = useMutation({
    mutationFn: async (data) => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      return supabase.from('users').update(data).eq('id', authUser.id);
    },
    onSuccess: () => {
      checkUserAuth();
      toast({ title: 'Profile saved', duration: 4000 });
    },
    onError: (err) => {
      toast({
        title: 'Failed to save profile',
        description: err.message,
        variant: 'destructive',
        duration: 8000,
      });
    },
  });

  const { data: emailBrandingList = [] } = useQuery({
    queryKey: ['emailBranding'],
    queryFn: () => EmailBranding.list(),
    enabled: user?.role === 'admin',
  });
  const emailBranding = emailBrandingList[0] || {};

  const saveTemplateMutation = useMutation({
    mutationFn: async ({ key, subject, body_html, body_text }) => {
      const existing = emailTemplates.find(t => t.template_key === key);
      if (existing) {
        return EmailTemplate.update(existing.id, { subject, body_html, body_text });
      } else {
        return EmailTemplate.create({
          template_key: key,
          name: DEFAULT_TEMPLATES[key]?.name || key,
          subject,
          body_html,
          body_text,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailTemplates'] });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      await User.delete(user.id);
      await supabase.auth.signOut();
    },
    onSuccess: () => { window.location.href = '/login'; },
    onError: (e) => {
      toast({ title: 'Failed to delete account', description: e.message, variant: 'destructive', duration: 8000 });
      setDeleteStep(0);
    }
  });

  const isAdmin    = checkAdmin(user);
  const isInternal = user?.role === 'internal';
  const isPricingUser = user?.role === 'pricing';

  // external users only get profile + notifications
  const isExternal = user?.role === 'external';

  if (!user) {
    return null;
  }

  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user?.full_name || '';

  const TEMPLATE_KEYS = [
    { key: 'rfi_assigned', label: 'RFI Assigned' },
    { key: 'rfi_response', label: 'RFI Response' },
    { key: 'team_added', label: 'Added to Project' },
    { key: 'tender_invitation', label: 'Tender Invitation' },
    { key: 'tender_sub_awarded', label: 'Sub Awarded' },
    { key: 'tender_sub_unsuccessful', label: 'Sub Not Selected' },
    { key: 'user_invite', label: 'User Invite' },
    { key: 'password_reset', label: 'Password Reset' },
    { key: 'subcontractor_invite', label: 'Subcontractor Invite' },
    { key: 'subcontractor_invite_quote', label: 'Subcontractor Invite — Quote Accepted' },
    { key: 'team_added_quote', label: 'Added to Project — Quote Accepted' },
    { key: 'programme_published', label: 'Programme Update Notification' },
    { key: 'contract_instruction', label: 'Contract Instruction Issued' },
    { key: 'tender_question_posted', label: 'Tender Question — Admin Notification' },
    { key: 'tender_question_answered', label: 'Tender Question — Answer Notification' },
    { key: 'tender_notice_issued', label: 'Notice to Tenderers (NTT)' },
    { key: 'tender_reminder_external', label: 'Tender Closing Reminder — Subcontractor' },
    { key: 'tender_reminder_internal', label: 'Tender Closing Reminder — Internal' },
    { key: 'rfi_reminder', label: 'RFI Questions Deadline Reminder' },
  ];

  return (
    <div>
      <PageHeader title="Settings" description="Manage your profile and preferences" />

      <Tabs defaultValue="profile" className="space-y-6">
        <div className="overflow-x-auto -mx-1 px-1 pb-1"><TabsList className="inline-flex w-max h-auto p-1 gap-0.5">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="w-3.5 h-3.5 mr-1" /> Notifications
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="people">
              <Users className="w-3.5 h-3.5 mr-1" /> People
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="roles">
              <Tag className="w-3.5 h-3.5 mr-1" /> Roles
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="appearance">
              <Palette className="w-3.5 h-3.5 mr-1" /> Appearance
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="emails">
              <Mail className="w-3.5 h-3.5 mr-1" /> Email Templates
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="subcontractors">
              Subcontractors
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="documents">
              <FolderOpen className="w-3.5 h-3.5 mr-1" /> Documents
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="tender-defaults">
              <FileSignature className="w-3.5 h-3.5 mr-1" /> Tender Defaults
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="system">
              <FlaskConical className="w-3.5 h-3.5 mr-1" /> System
            </TabsTrigger>
          )}
        </TabsList></div>

        {/* Profile */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>First Name</Label>
                  <Input value={profile.first_name} onChange={e => setProfile({...profile, first_name: e.target.value})} placeholder="First name" />
                </div>
                <div>
                  <Label>Last Name</Label>
                  <Input value={profile.last_name} onChange={e => setProfile({...profile, last_name: e.target.value})} placeholder="Last name" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={user?.email || ''} disabled className="bg-muted" />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} placeholder="Phone number" />
                </div>
                <div>
                  <Label>Organisation</Label>
                  <Input value={profile.business_name} onChange={e => setProfile({...profile, business_name: e.target.value})} placeholder="Your company" />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role Information</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <span className="text-muted-foreground">Project Role</span>
                  <span className="font-medium">{user?.construction_role || '—'}</span>
                  <span className="text-muted-foreground">Permission Role</span>
                  <span className="font-medium">{user?.role || '—'}</span>
                </div>
              </div>
              <Button onClick={() => profileMutation.mutate(profile)} disabled={profileMutation.isPending} className="gap-2">
                <Save className="w-4 h-4" />
                {profileMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>

              <div className="border-t border-destructive/20 mt-6 pt-6">
                <p className="text-sm font-medium text-destructive mb-1">Danger Zone</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Permanently delete your account. This cannot be undone.
                </p>
                {deleteStep === 0 && (
                  <Button variant="outline"
                    className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => setDeleteStep(1)}>
                    Delete my account
                  </Button>
                )}
                {deleteStep === 1 && (
                  <div className="bg-destructive/5 border border-destructive/30 rounded-lg p-4 space-y-3">
                    <p className="text-sm font-medium text-destructive">Are you sure?</p>
                    <p className="text-xs text-muted-foreground">
                      You will be permanently removed. Any projects or RFIs you created will
                      remain but will no longer be associated with your account.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDeleteStep(0)}>Cancel</Button>
                      <Button variant="destructive" size="sm" onClick={() => setDeleteStep(2)}>
                        Yes, delete my account
                      </Button>
                    </div>
                  </div>
                )}
                {deleteStep === 2 && (
                  <div className="bg-destructive/10 border-2 border-destructive rounded-lg p-4 space-y-3">
                    <p className="text-sm font-bold text-destructive">
                      Final confirmation — permanent and irreversible.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Account for <strong>{user?.email}</strong> will be deleted immediately.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDeleteStep(0)}>
                        Cancel — keep my account
                      </Button>
                      <Button variant="destructive" size="sm"
                        disabled={deleteAccountMutation.isPending}
                        onClick={() => deleteAccountMutation.mutate()}>
                        {deleteAccountMutation.isPending ? 'Deleting...' : 'Permanently delete my account'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Choose which email notifications you receive</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">RFI Notifications</p>
                  <p className="text-xs text-muted-foreground">Emails when RFIs are assigned or responses added</p>
                </div>
                <Switch checked={profile.notify_rfis} onCheckedChange={v => setProfile({...profile, notify_rfis: v})} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Document Notifications</p>
                  <p className="text-xs text-muted-foreground">Emails when document status changes</p>
                </div>
                <Switch checked={profile.notify_documents} onCheckedChange={v => setProfile({...profile, notify_documents: v})} />
              </div>
              <Button onClick={() => profileMutation.mutate(profile)} disabled={profileMutation.isPending} className="gap-2">
                <Save className="w-4 h-4" /> Save Preferences
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* People (Admin only) */}
        {isAdmin && (
          <TabsContent value="people">
            <PeopleSettings />
          </TabsContent>
        )}

        {/* Roles (Admin only) */}
        {isAdmin && (
          <TabsContent value="roles">
            <RoleManager />
          </TabsContent>
        )}

        {/* Appearance (Admin only) */}
        {isAdmin && (
          <TabsContent value="appearance">
            <AppearanceSettings user={user} />
          </TabsContent>
        )}

        {/* Email Templates (Admin only) */}
        {isAdmin && (
          <TabsContent value="emails">
            <div className="space-y-4">
              <EmailBrandingPanel />

              <EmailDeliveryLog />

              <p className="text-sm text-muted-foreground pt-2">Customise the emails sent by the system. Click a template to expand the editor.</p>
              {TEMPLATE_KEYS.map(({ key, label }) => {
                const saved = emailTemplates.find(t => t.template_key === key);
                const isEditing = editingTemplate === key;
                return (
                  <Card key={key}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm">{label}</CardTitle>
                          {saved ? (
                            <Badge variant="outline" className="text-[10px] text-green-700 border-green-300 bg-green-50">Customised</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">Using default</Badge>
                          )}
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingTemplate(isEditing ? null : key)}>
                          {isEditing ? 'Close' : 'Edit'}
                        </Button>
                      </div>
                    </CardHeader>
                    {isEditing && (
                      <CardContent>
                        <EmailTemplateEditor
                          templateKey={key}
                          template={saved || null}
                          branding={emailBranding}
                          saving={saveTemplateMutation.isPending}
                          onSave={(subject, body_html, body_text) =>
                            saveTemplateMutation.mutate({ key, subject, body_html, body_text })
                          }
                        />
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="subcontractors">
            <SubcontractorDirectory />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="documents">
            <DocumentFolderTemplates />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="tender-defaults" className="space-y-8">
            <TenderSettingsPanel />
            {isAdmin && <TradeTemplatesPanel />}
            {isAdmin && <ReminderSettingsPanel />}
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="system">
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-1">System Health</h3>
                <p className="text-xs text-muted-foreground mb-3">Read-only diagnostics for the current user session, permission state, and project membership.</p>
                <SystemHealth />
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-1">Test Utilities</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Admin-only reset tools for development and QA. Disable via <code className="bg-muted px-1 rounded text-[11px]">TEST_UTILITIES_DISABLED=true</code> environment variable before deploying to production.
                </p>
                <TestUtilities />
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function TradeTemplatesPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['trade_templates'],
    queryFn: () => TradeTemplate.list('sort_order'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => TradeTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade_templates'] });
      toast({ title: 'Trade removed' });
    },
  });

  const addMutation = useMutation({
    mutationFn: () => TradeTemplate.create({ name: newName.trim(), category: newCategory.trim() || null, sort_order: trades.length + 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade_templates'] });
      setNewName('');
      setNewCategory('');
      toast({ title: 'Trade added' });
    },
    onError: (e) => toast({ title: 'Failed to add trade', description: e.message, variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Trade Templates</CardTitle>
        <CardDescription className="text-xs">
          Manage the list of trades available when creating tenders and inviting subcontractors.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Trade name" className="flex-1" onKeyDown={e => e.key === 'Enter' && newName.trim() && addMutation.mutate()} />
          <Input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Category (optional)" className="w-40" />
          <Button onClick={() => addMutation.mutate()} disabled={!newName.trim() || addMutation.isPending} size="sm">Add</Button>
        </div>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : (
          <div className="border rounded-lg divide-y">
            {trades.length === 0 && (
              <p className="text-xs text-muted-foreground p-3">No trades configured — defaults will be used.</p>
            )}
            {trades.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 text-sm font-medium">{t.name}</span>
                {t.category && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{t.category}</span>}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => deleteMutation.mutate(t.id)} disabled={deleteMutation.isPending}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const REMINDER_LABELS = {
  tender_external: { label: 'Tender Closing Reminder — Subcontractors', desc: 'Sent to invited subcontractors before the tender closes.' },
  tender_internal: { label: 'Tender Closing Reminder — Internal', desc: 'Sent to admins and tender lead before the tender closes.' },
  rfi_reminder:    { label: 'RFI Questions Deadline Reminder', desc: 'Sent to invitees before the questions deadline.' },
};

// A dead cron and a quiet week where nothing was due look identical unless
// this line calls it out — red when the last run errored, or when nothing
// has run in the last 48h (the daily schedule should mean this never happens).
function LastRunLine({ lastRun }) {
  if (!lastRun) {
    return (
      <p className="text-xs font-medium text-destructive flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" /> Last run: never
      </p>
    );
  }
  const ranAt = new Date(lastRun.ran_at);
  const isStale = Date.now() - ranAt.getTime() > 48 * 60 * 60 * 1000;
  const isError = !!lastRun.error;
  const isBad = isStale || isError;

  return (
    <p className={`text-xs flex items-center gap-1.5 ${isBad ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
      {isBad && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
      Last run: {formatDistanceToNow(ranAt, { addSuffix: true })} ({lastRun.trigger})
      {isError ? ` — failed: ${lastRun.error}` : ` — ${lastRun.sent} sent, ${lastRun.skipped} skipped`}
    </p>
  );
}

function ReminderSettingsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [runResult, setRunResult] = useState(null);

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['reminder_settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('reminder_settings').select('*').order('reminder_type');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60_000,
  });

  const { data: recentLog = [], isLoading: logLoading } = useQuery({
    queryKey: ['reminder_log_recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reminder_log')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const { data: lastRun, isLoading: lastRunLoading } = useQuery({
    queryKey: ['reminder_runs_latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reminder_runs')
        .select('*')
        .order('ran_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, changes }) => {
      const { error } = await supabase.from('reminder_settings').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminder_settings'] });
      toast({ title: 'Reminder settings saved' });
    },
    onError: (e) => toast({ title: 'Failed to save', description: e.message, variant: 'destructive' }),
  });

  const runMutation = useMutation({
    mutationFn: async () => invokeFunction('sendReminders'),
    onSuccess: (data) => {
      setRunResult(data);
      queryClient.invalidateQueries({ queryKey: ['reminder_log_recent'] });
      queryClient.invalidateQueries({ queryKey: ['reminder_runs_latest'] });
      toast({ title: `Reminders run: ${data?.sent ?? 0} sent, ${data?.skipped ?? 0} skipped` });
    },
    onError: (e) => {
      setRunResult({ error: e.message });
      // The edge function records a reminder_runs row on its own failure
      // path too (before returning the error), so this is worth a refresh.
      queryClient.invalidateQueries({ queryKey: ['reminder_runs_latest'] });
      toast({ title: 'Reminder run failed', description: e.message, variant: 'destructive' });
    },
  });

  // Group run details by reminder type for display, matching REMINDER_LABELS keys.
  const detailsByType = (runResult?.details || []).reduce((acc, d) => {
    const key = d.type === 'tender_ext' ? 'tender_external' : d.type === 'tender_int' ? 'tender_internal' : d.type;
    (acc[key] = acc[key] || []).push(d);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reminder Settings</CardTitle>
        <CardDescription className="text-xs">Configure automated reminder emails. Reminders run daily and will not send duplicates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded animate-pulse" />)}</div>
        ) : settings.map(s => (
          <div key={s.id} className="flex items-start gap-4 p-4 border rounded-lg bg-muted/30">
            <Switch
              checked={s.enabled}
              onCheckedChange={v => updateMutation.mutate({ id: s.id, changes: { enabled: v } })}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{REMINDER_LABELS[s.reminder_type]?.label || s.reminder_type}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{REMINDER_LABELS[s.reminder_type]?.desc}</p>
              <div className="flex items-center gap-2 mt-3">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Send</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={s.days_before}
                  onChange={e => updateMutation.mutate({ id: s.id, changes: { days_before: parseInt(e.target.value) || 1 } })}
                  className="h-7 w-16 text-xs"
                  disabled={!s.enabled}
                />
                <Label className="text-xs text-muted-foreground whitespace-nowrap">day(s) before deadline</Label>
              </div>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
              {s.enabled ? 'Active' : 'Disabled'}
            </span>
          </div>
        ))}

        <div className="border-t pt-3 space-y-1">
          {lastRunLoading ? (
            <div className="h-4 w-48 bg-muted rounded animate-pulse" />
          ) : (
            <LastRunLine lastRun={lastRun} />
          )}
          <p className="text-xs text-muted-foreground">
            Reminders run automatically once a day at 7:00 AM NZ. Use Run now to test.
          </p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" disabled={runMutation.isPending}>
              {runMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
              Run reminders now
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Run reminders now?</AlertDialogTitle>
              <AlertDialogDescription>
                This sends real reminder emails to subcontractors immediately. Reminders already sent are skipped.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => runMutation.mutate()}>
                Yes, run now
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {runResult && (
          <div className="border rounded-lg p-4 space-y-3">
            {runResult.error ? (
              <p className="text-sm text-destructive">Run failed: {runResult.error}</p>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {runResult.sent ?? 0} sent, {runResult.skipped ?? 0} skipped
                </p>
                {Object.entries(detailsByType).map(([type, rows]) => (
                  <div key={type} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {REMINDER_LABELS[type]?.label || type}
                    </p>
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs h-8">Tender</TableHead>
                            <TableHead className="text-xs h-8">Days</TableHead>
                            <TableHead className="text-xs h-8">Action</TableHead>
                            <TableHead className="text-xs h-8">Reason</TableHead>
                            <TableHead className="text-xs h-8">Recipients</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((d, i) => (
                            <TableRow key={i} className={d.reason === 'settings disabled' ? 'bg-amber-50' : ''}>
                              <TableCell className="text-xs py-1.5">{d.title || '—'}</TableCell>
                              <TableCell className="text-xs py-1.5">{d.days ?? '—'}</TableCell>
                              <TableCell className="text-xs py-1.5">
                                <span className={d.action === 'sent' ? 'text-green-700 font-medium' : 'text-muted-foreground'}>
                                  {d.action}
                                </span>
                              </TableCell>
                              <TableCell className={`text-xs py-1.5 ${d.reason === 'settings disabled' ? 'font-medium text-amber-700' : ''}`}>
                                {d.reason || '—'}
                              </TableCell>
                              <TableCell className="text-xs py-1.5">{(d.recipients || []).join(', ') || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Recently sent</p>
          {logLoading ? (
            <div className="h-16 bg-muted rounded animate-pulse" />
          ) : recentLog.length === 0 ? (
            <p className="text-xs text-muted-foreground">No reminders have been sent yet.</p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs h-8">Type</TableHead>
                    <TableHead className="text-xs h-8">Recipient</TableHead>
                    <TableHead className="text-xs h-8">Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLog.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs py-1.5 font-mono">{row.reminder_type}</TableCell>
                      <TableCell className="text-xs py-1.5">{row.recipient_email}</TableCell>
                      <TableCell className="text-xs py-1.5" title={row.sent_at ? format(new Date(row.sent_at), 'PPpp') : ''}>
                        {row.sent_at ? formatDistanceToNow(new Date(row.sent_at), { addSuffix: true }) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}