import { supabase } from '@/api/supabaseClient';
import React, { useState, useEffect } from 'react';
import { EmailBranding, EmailTemplate, User } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Save, Shield, Bell, Mail, Palette, Tag, RefreshCw, Trash2, FolderOpen, FileSignature, Users, FlaskConical } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/shared/PageHeader';
import { DEFAULT_TEMPLATES } from '@/lib/emailTemplates';
import { isAdmin as checkAdmin, canAccess } from '@/lib/permissions';
import AppearanceSettings from '@/components/settings/AppearanceSettings';
import RoleManager from '@/components/settings/RoleManager';
import SubcontractorDirectory from '@/components/settings/SubcontractorDirectory';
import EmailBrandingPanel from '@/components/settings/EmailBrandingPanel';
import EmailTemplateEditor from '@/components/settings/EmailTemplateEditor';
import DocumentFolderTemplates from '@/components/settings/DocumentFolderTemplates';
import TenderSettingsPanel from '@/components/settings/TenderSettingsPanel';
import PeopleSettings from '@/components/settings/PeopleSettings';
import TestUtilities from '@/components/settings/TestUtilities';
import SystemHealth from '@/components/settings/SystemHealth';


export default function Settings() {
  const { user } = useAuth();
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
      queryClient.invalidateQueries({ queryKey: ['auth'] });
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
    { key: 'team_invited', label: 'Project Invitation' },
    { key: 'tender_invitation', label: 'Tender Invitation' },
    { key: 'tender_outcome_unsuccessful', label: 'Tender Outcome — Unsuccessful (We Lost)' },
    { key: 'tender_sub_awarded', label: 'Sub Awarded' },
    { key: 'tender_sub_unsuccessful', label: 'Sub Not Selected' },
    { key: 'user_invite', label: 'User Invite' },
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
          {(isAdmin || isInternal) && (
            <TabsTrigger value="people">
              <Users className="w-3.5 h-3.5 mr-1" /> People
            </TabsTrigger>
          )}
          {(isAdmin || isInternal) && (
            <TabsTrigger value="roles">
              <Tag className="w-3.5 h-3.5 mr-1" /> Roles
            </TabsTrigger>
          )}
          {(isAdmin || isInternal) && (
            <TabsTrigger value="appearance">
              <Palette className="w-3.5 h-3.5 mr-1" /> Appearance
            </TabsTrigger>
          )}
          {(isAdmin || isInternal) && (
            <TabsTrigger value="emails">
              <Mail className="w-3.5 h-3.5 mr-1" /> Email Templates
            </TabsTrigger>
          )}
          {(isAdmin || isInternal || isPricingUser) && (
            <TabsTrigger value="subcontractors">
              Subcontractors
            </TabsTrigger>
          )}
          {(isAdmin || isInternal || isPricingUser) && (
            <TabsTrigger value="documents">
              <FolderOpen className="w-3.5 h-3.5 mr-1" /> Documents
            </TabsTrigger>
          )}
          {(isAdmin || isInternal || isPricingUser) && (
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
              <div className="grid sm:grid-cols-2 gap-4">
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

        {/* People (Admin + Internal) */}
        {(isAdmin || isInternal) && (
          <TabsContent value="people">
            <PeopleSettings />
          </TabsContent>
        )}

        {/* Roles (Admin + Internal) */}
        {(isAdmin || isInternal) && (
          <TabsContent value="roles">
            <RoleManager />
          </TabsContent>
        )}

        {/* Appearance (Admin + Internal) */}
        {(isAdmin || isInternal) && (
          <TabsContent value="appearance">
            <AppearanceSettings user={user} />
          </TabsContent>
        )}

        {/* Email Templates (Admin + Internal) */}
        {(isAdmin || isInternal) && (
          <TabsContent value="emails">
            <div className="space-y-4">
              <EmailBrandingPanel />

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
        {(isAdmin || isInternal || isPricingUser) && (
          <TabsContent value="subcontractors">
            <SubcontractorDirectory />
          </TabsContent>
        )}
        {(isAdmin || isInternal || isPricingUser) && (
          <TabsContent value="documents">
            <DocumentFolderTemplates />
          </TabsContent>
        )}
        {(isAdmin || isInternal || isPricingUser) && (
          <TabsContent value="tender-defaults">
            <TenderSettingsPanel />
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