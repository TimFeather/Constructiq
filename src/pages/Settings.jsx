import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Save, UserPlus, Shield, Bell, Mail, Clock, RefreshCw, Palette, Tag } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { DEFAULT_TEMPLATES } from '@/lib/emailTemplates';
import UserManagement from '@/components/settings/UserManagement';
import AppearanceSettings from '@/components/settings/AppearanceSettings';
import RoleManager from '@/components/settings/RoleManager';

const ROLES = [
  'Architect', 'Client', 'External Project Manager',
  'Internal Project Manager', 'Site Manager', 'Quantity Surveyor', 'Subcontractor'
];

export default function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState({
    first_name: '', last_name: '', phone: '', business_name: '',
    construction_role: '', notify_rfis: true, notify_documents: true,
  });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('external');
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateForm, setTemplateForm] = useState({ subject: '', body: '', logo_url: '' });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: user?.role === 'admin',
  });

  const { data: invitedUsers = [] } = useQuery({
    queryKey: ['invitedUsers'],
    queryFn: () => base44.entities.InvitedUser.list('-created_date', 100),
    enabled: user?.role === 'admin',
  });

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => base44.entities.EmailTemplate.list(),
    enabled: user?.role === 'admin',
  });

  useEffect(() => {
    if (user) {
      setProfile({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        phone: user.phone || '',
        business_name: user.business_name || '',
        construction_role: user.construction_role || '',
        notify_rfis: user.notify_rfis !== false,
        notify_documents: user.notify_documents !== false,
      });
    }
  }, [user]);

  const profileMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  });

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }) => {
      await base44.users.inviteUser(email, role === 'admin' ? 'admin' : 'user');
    },
    onSuccess: () => {
      setInviteEmail('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }) => base44.entities.User.update(userId, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async ({ key, subject, body, logo_url }) => {
      const existing = emailTemplates.find(t => t.template_key === key);
      if (existing) {
        return base44.entities.EmailTemplate.update(existing.id, { subject, body, logo_url });
      } else {
        return base44.entities.EmailTemplate.create({
          template_key: key,
          name: DEFAULT_TEMPLATES[key]?.name || key,
          subject,
          body,
          logo_url,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailTemplates'] });
      setEditingTemplate(null);
    }
  });

  const isAdmin = user?.role === 'admin';
  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user?.full_name || '';

  const openEditTemplate = (key) => {
    const saved = emailTemplates.find(t => t.template_key === key);
    const def = DEFAULT_TEMPLATES[key];
    setTemplateForm({
      subject: saved?.subject || def?.subject || '',
      body: saved?.body || def?.body || '',
      logo_url: saved?.logo_url || '',
    });
    setEditingTemplate(key);
  };

  const TEMPLATE_KEYS = [
    { key: 'rfi_assigned', label: 'RFI Assigned', vars: '{rfi_ref}, {title}, {project_name}, {assignee_name}, {priority}, {due_date}, {description}, {url}' },
    { key: 'rfi_response', label: 'RFI Response', vars: '{rfi_ref}, {title}, {project_name}, {responder_name}, {response_text}, {url}' },
    { key: 'team_added', label: 'Added to Project', vars: '{name}, {project_name}, {role}' },
    { key: 'team_invited', label: 'Project Invitation', vars: '{project_name}, {role}' },
  ];

  return (
    <div>
      <PageHeader title="Settings" description="Manage your profile and preferences" />

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="w-3.5 h-3.5 mr-1" /> Notifications
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users">
              <Shield className="w-3.5 h-3.5 mr-1" /> Users
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
        </TabsList>

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
                <div>
                  <Label>Role</Label>
                  <Select value={profile.construction_role} onValueChange={v => setProfile({...profile, construction_role: v})}>
                    <SelectTrigger><SelectValue placeholder="Select your role" /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Platform Role</Label>
                <div className="mt-1"><Badge variant="outline">{user?.role || 'external'}</Badge></div>
              </div>
              <Button onClick={() => profileMutation.mutate(profile)} disabled={profileMutation.isPending} className="gap-2">
                <Save className="w-4 h-4" />
                {profileMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
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

        {/* User Management (Admin only) */}
        {isAdmin && (
          <TabsContent value="users">
            <UserManagement />
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
              <p className="text-sm text-muted-foreground">Customise the emails sent by the system. Use the variable names shown in each template to insert dynamic content.</p>
              {TEMPLATE_KEYS.map(({ key, label, vars }) => {
                const saved = emailTemplates.find(t => t.template_key === key);
                const isEditing = editingTemplate === key;
                const def = DEFAULT_TEMPLATES[key];
                return (
                  <Card key={key}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{label}</CardTitle>
                        <div className="flex gap-2">
                          {saved && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => {
                              base44.entities.EmailTemplate.delete(saved.id).then(() => {
                                queryClient.invalidateQueries({ queryKey: ['emailTemplates'] });
                                if (editingTemplate === key) setEditingTemplate(null);
                              });
                            }}>
                              <RefreshCw className="w-3 h-3" /> Reset to default
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => isEditing ? setEditingTemplate(null) : openEditTemplate(key)}>
                            {isEditing ? 'Cancel' : 'Edit'}
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Variables: <code className="bg-muted px-1 rounded text-[10px]">{vars}</code></p>
                    </CardHeader>
                    {isEditing ? (
                      <CardContent className="space-y-3">
                        <div>
                          <Label className="text-xs">Subject</Label>
                          <Input value={templateForm.subject} onChange={e => setTemplateForm(f => ({...f, subject: e.target.value}))} />
                        </div>
                        <div>
                          <Label className="text-xs">Body</Label>
                          <Textarea value={templateForm.body} onChange={e => setTemplateForm(f => ({...f, body: e.target.value}))} rows={8} className="font-mono text-xs" />
                        </div>
                        <div>
                          <Label className="text-xs">Logo / Image URL (optional)</Label>
                          <Input
                            value={templateForm.logo_url || ''}
                            onChange={e => setTemplateForm(f => ({...f, logo_url: e.target.value}))}
                            placeholder="https://... or upload via Appearance settings"
                            className="text-xs"
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">Paste your logo URL to prepend it to the email. Use your company logo from Appearance settings.</p>
                          {templateForm.logo_url && (
                            <img src={templateForm.logo_url} alt="Logo preview" className="mt-2 h-10 object-contain rounded border" />
                          )}
                        </div>
                        <Button size="sm" className="gap-1.5" onClick={() => saveTemplateMutation.mutate({ key, ...templateForm })} disabled={saveTemplateMutation.isPending}>
                          <Save className="w-3 h-3" /> {saveTemplateMutation.isPending ? 'Saving...' : 'Save Template'}
                        </Button>
                      </CardContent>
                    ) : (
                      <CardContent className="pt-0">
                        <div className="bg-muted/40 rounded p-3 text-xs font-mono whitespace-pre-wrap text-muted-foreground max-h-24 overflow-hidden relative">
                          {(saved?.body || def?.body || '').substring(0, 200)}
                          {(saved?.body || def?.body || '').length > 200 && <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted/40 to-transparent" />}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}