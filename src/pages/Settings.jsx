import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Save, UserPlus, Shield, Bell } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';

export default function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState({
    phone: '', business_name: '', notify_rfis: true, notify_documents: true,
  });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('external');

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: user?.role === 'admin',
  });

  useEffect(() => {
    if (user) {
      setProfile({
        phone: user.phone || '',
        business_name: user.business_name || '',
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

  const isAdmin = user?.role === 'admin';

  return (
    <div>
      <PageHeader title="Settings" description="Manage your profile and preferences" />

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="w-3.5 h-3.5 mr-1" /> Notifications
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users">
              <Shield className="w-3.5 h-3.5 mr-1" /> User Management
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
                  <Label>Full Name</Label>
                  <Input value={user?.full_name || ''} disabled className="bg-muted" />
                  <p className="text-xs text-muted-foreground mt-1">Name cannot be changed here</p>
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={user?.email || ''} disabled className="bg-muted" />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={profile.phone}
                    onChange={e => setProfile({...profile, phone: e.target.value})}
                    placeholder="Phone number"
                  />
                </div>
                <div>
                  <Label>Business Name</Label>
                  <Input
                    value={profile.business_name}
                    onChange={e => setProfile({...profile, business_name: e.target.value})}
                    placeholder="Your company"
                  />
                </div>
              </div>
              <div>
                <Label>Role</Label>
                <div className="mt-1">
                  <Badge variant="outline">{user?.role || 'user'}</Badge>
                </div>
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
                <Switch
                  checked={profile.notify_rfis}
                  onCheckedChange={v => setProfile({...profile, notify_rfis: v})}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Document Notifications</p>
                  <p className="text-xs text-muted-foreground">Emails when document status changes</p>
                </div>
                <Switch
                  checked={profile.notify_documents}
                  onCheckedChange={v => setProfile({...profile, notify_documents: v})}
                />
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
            <div className="space-y-6">
              {/* Invite User */}
              <Card>
                <CardHeader>
                  <CardTitle>Invite User</CardTitle>
                  <CardDescription>Send an invitation to join the platform</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      type="email"
                      placeholder="Email address"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      className="flex-1"
                    />
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="internal">Internal</SelectItem>
                        <SelectItem value="external">External</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
                      disabled={!inviteEmail || inviteMutation.isPending}
                      className="gap-2"
                    >
                      <UserPlus className="w-4 h-4" />
                      {inviteMutation.isPending ? 'Inviting...' : 'Invite'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* User list */}
              <Card>
                <CardHeader>
                  <CardTitle>All Users ({users.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {users.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">{u.full_name || u.email}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                        <Select
                          value={u.role || 'external'}
                          onValueChange={v => roleMutation.mutate({ userId: u.id, role: v })}
                        >
                          <SelectTrigger className="w-28 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="internal">Internal</SelectItem>
                            <SelectItem value="external">External</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    {users.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}