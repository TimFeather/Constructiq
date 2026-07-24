import React, { useState } from 'react';
import { InvitedUser, User } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { invokeFunction } from '@/api/supabaseClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Clock, Pencil, ShieldOff, ShieldCheck, KeyRound, Copy, Check, Loader2, Mail } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';

export default function UserManagement() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('external');
  const [editingUser, setEditingUser] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [pendingRoleChange, setPendingRoleChange] = useState(null);
  const [resetUser, setResetUser] = useState(null);   // user whose reset dialog is open
  const [resetLink, setResetLink] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => User.list(),
    enabled: user?.role === 'admin',
  });

  const { data: invitedUsers = [] } = useQuery({
    queryKey: ['invitedUsers'],
    queryFn: () => InvitedUser.list('-created_at', 100),
    enabled: user?.role === 'admin',
  });

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }) => {
      await InvitedUser.create({
        email,
        app_role: role,
        status: 'Pending',
        invited_by_email: user?.email,
      });
    },
    onSuccess: () => {
      setInviteEmail('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['invitedUsers'] });
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, role }) => User.update(userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
    }
  });

  const deactivateUserMutation = useMutation({
    mutationFn: (userId) => User.update(userId, { disabled: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleteConfirm(null);
    }
  });

  const reactivateUserMutation = useMutation({
    mutationFn: (userId) => User.update(userId, { disabled: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const resetLinkMutation = useMutation({
    mutationFn: ({ userId, send }) => invokeFunction('adminResetPassword', { userId, send }),
    onSuccess: ({ data }) => {
      setResetLink(data?.action_link || '');
      setResetSent(!!data?.sent);
      setResetError(data?.warning || '');
    },
    onError: (err) => setResetError(err?.message || 'Failed to generate reset link'),
  });

  const openEdit = (u) => {
    setEditingUser(u);
    setEditRole(u.role || 'external');
  };

  const openReset = (u) => {
    setResetUser(u);
    setResetLink('');
    setResetSent(false);
    setResetError('');
    setCopied(false);
    resetLinkMutation.reset();
  };

  const copyResetLink = async () => {
    try {
      await navigator.clipboard.writeText(resetLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setResetError('Could not copy automatically — select the link and copy it manually.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Invite */}
      <Card>
        <CardHeader>
          <CardTitle>Invite User</CardTitle>
          <CardDescription>Send an invitation to join the platform</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input type="email" placeholder="Email address" value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)} className="flex-1" />
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="pricing">Pricing</SelectItem>
                <SelectItem value="external">External</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
              disabled={!inviteEmail || inviteMutation.isPending} className="gap-2">
              <UserPlus className="w-4 h-4" />
              {inviteMutation.isPending ? 'Inviting...' : 'Invite'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pending */}
      {invitedUsers.filter(i => i.status === 'Pending').length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" /> Pending Invitations ({invitedUsers.filter(i => i.status === 'Pending').length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invitedUsers.filter(i => i.status === 'Pending').map(inv => (
                <div key={inv.id} className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                  <div>
                    <p className="text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.project_name ? `Invited to: ${inv.project_name}` : 'Direct invite'}
                      {inv.invited_by_email ? ` · by ${inv.invited_by_email}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-amber-600 border-amber-400">Pending</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Registered Users */}
      <Card>
        <CardHeader>
          <CardTitle>Registered Users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {users.map(u => {
              const isDeactivated = u.disabled === true;
              return (
              <div key={u.id} className={`flex items-center justify-between p-3 rounded-lg ${isDeactivated ? 'bg-muted/30 opacity-70' : 'bg-muted/50'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{u.full_name || u.email}</p>
                    {isDeactivated
                      ? <Badge variant="outline" className="text-xs bg-red-50 text-red-600 border-red-300 gap-1"><ShieldOff className="w-2.5 h-2.5" /> Deactivated</Badge>
                      : <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300 gap-1"><ShieldCheck className="w-2.5 h-2.5" /> Active</Badge>
                    }
                  </div>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                  <Badge variant="outline" className={`text-xs mt-1 ${
                    (u.role || 'external') === 'admin' ? 'bg-purple-100 text-purple-700 border-purple-300' :
                    (u.role || 'external') === 'internal' ? 'bg-blue-100 text-blue-700 border-blue-300' :
                    (u.role || 'external') === 'pricing' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                    'bg-gray-100 text-gray-600'
                  }`}>{u.role || 'external'}</Badge>
                </div>
                {u.id !== user?.id && (
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {!isDeactivated && (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => openEdit(u)}>
                        <Pencil className="w-3 h-3" /> Edit
                      </Button>
                    )}
                    {!isDeactivated && (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => openReset(u)}>
                        <KeyRound className="w-3 h-3" /> Reset password
                      </Button>
                    )}
                    {isDeactivated ? (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-green-700 border-green-400 hover:bg-green-50"
                        disabled={reactivateUserMutation.isPending}
                        onClick={() => reactivateUserMutation.mutate(u.id)}>
                        <ShieldCheck className="w-3 h-3" /> Reactivate
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                        onClick={() => setDeleteConfirm(u)}>
                        <ShieldOff className="w-3 h-3" /> Deactivate
                      </Button>
                    )}
                  </div>
                )}
                {u.id === user?.id && <Badge variant="secondary" className="text-xs">You</Badge>}
              </div>
              );
            })}
            {users.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No users found</p>}
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit User — {editingUser?.full_name || editingUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Platform Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="internal">Internal</SelectItem>
                  <SelectItem value="pricing">Pricing</SelectItem>
                  <SelectItem value="external">External</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
            <Button onClick={() => {
              if (editRole !== (editingUser.role || 'external')) {
                setPendingRoleChange({ userId: editingUser.id, currentRole: editingUser.role || 'external', newRole: editRole, userName: editingUser.full_name || editingUser.email });
              } else {
                setEditingUser(null);
              }
            }} disabled={updateUserMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role change confirmation */}
      <AlertDialog open={!!pendingRoleChange} onOpenChange={open => { if (!open) setPendingRoleChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change user role?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to change <strong>{pendingRoleChange?.userName}</strong> from{' '}
              <strong>{pendingRoleChange?.currentRole}</strong> to <strong>{pendingRoleChange?.newRole}</strong>.
              This will affect what they can see and do in ConstructIQ.
              {pendingRoleChange?.newRole === 'admin' && ' This gives them full admin access including user management.'}
              {pendingRoleChange?.currentRole === 'admin' && ' This removes their admin access.'}
              {pendingRoleChange?.newRole === 'pricing' && ' This gives them access to Tenders and all internal features except Settings.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction
            onClick={() => {
              updateUserMutation.mutate({ userId: pendingRoleChange.userId, role: pendingRoleChange.newRole });
              setPendingRoleChange(null);
              setEditingUser(null);
            }}
            disabled={updateUserMutation.isPending}
          >
            {updateUserMutation.isPending ? 'Saving...' : 'Confirm change'}
          </AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset password link */}
      <Dialog open={!!resetUser} onOpenChange={(open) => { if (!open) setResetUser(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset password — {resetUser?.full_name || resetUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Generate a one-time reset link for <strong>{resetUser?.email}</strong>. They can open it to set a new
              password — no existing password needed. Email it to them directly, or copy it to send yourself.
            </p>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                className="gap-2 flex-1"
                disabled={resetLinkMutation.isPending}
                onClick={() => resetLinkMutation.mutate({ userId: resetUser.id, send: true })}
              >
                {resetLinkMutation.isPending && resetLinkMutation.variables?.send
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Emailing…</>
                  : <><Mail className="w-4 h-4" /> Email reset link</>}
              </Button>
              <Button
                variant="outline"
                className="gap-2 flex-1"
                disabled={resetLinkMutation.isPending}
                onClick={() => resetLinkMutation.mutate({ userId: resetUser.id, send: false })}
              >
                {resetLinkMutation.isPending && !resetLinkMutation.variables?.send
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                  : <><KeyRound className="w-4 h-4" /> Generate link to copy</>}
              </Button>
            </div>

            {resetError && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{resetError}</div>
            )}

            {resetSent && (
              <div className="p-3 rounded-lg bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 text-sm flex items-center gap-2">
                <Check className="w-4 h-4 flex-shrink-0" /> Reset link emailed to {resetUser?.email}.
              </div>
            )}

            {resetLink && (
              <div className="space-y-1.5">
                <Label className="text-xs">Reset link{resetSent ? ' (also emailed above)' : ''}</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={resetLink} onFocus={(e) => e.target.select()} className="flex-1 text-xs" />
                  <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0" onClick={copyResetLink}>
                    {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </Button>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              The link can only be used once and expires after a while. Users can also reset it themselves from the
              “Forgot password?” link on the log-in page.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUser(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate User</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Deactivate <strong>{deleteConfirm?.full_name || deleteConfirm?.email}</strong>? Their account will be disabled but their history and project memberships are preserved. They can be reactivated later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deactivateUserMutation.mutate(deleteConfirm.id)}
              disabled={deactivateUserMutation.isPending}>
              {deactivateUserMutation.isPending ? 'Deactivating...' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}