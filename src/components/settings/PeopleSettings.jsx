import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Users, Clock, RotateCcw, XCircle, Search, Pencil, ShieldOff, ShieldCheck, UserX } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

const ROLE_COLOURS = {
  admin:    'bg-purple-100 text-purple-700 border-purple-300',
  internal: 'bg-blue-100 text-blue-700 border-blue-300',
  pricing:  'bg-amber-100 text-amber-700 border-amber-300',
  external: 'bg-gray-100 text-gray-600 border-gray-200',
};

function roleColour(role) {
  return ROLE_COLOURS[role] || ROLE_COLOURS.external;
}

// Shared user card layout
function UserRow({ u, actions }) {
  const displayName = u.full_name || u.email;
  const company = u.data?.company_name || u.company_name || '';
  const role = u.role || 'external';

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{displayName}</p>
        {company && <p className="text-xs text-muted-foreground truncate">{company}</p>}
        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
        <Badge variant="outline" className={`text-xs mt-1 ${roleColour(role)}`}>{role}</Badge>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

// ─── Active Users Tab ─────────────────────────────────────────────────────────

function ActiveUsersTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [deactivateConfirm, setDeactivateConfirm] = useState(null);
  const [pendingRoleChange, setPendingRoleChange] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: user?.role === 'admin',
  });

  const activeUsers = users.filter(u => u.data?.disabled !== true);

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }) => base44.entities.User.update(userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
      setPendingRoleChange(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (u) => {
      // 1. Mark user disabled
      await base44.entities.User.update(u.id, { data: { disabled: true } });
      // 2. Remove from all active project teams
      await base44.functions.invoke('invitationService', {
        action: 'removeFromProjectTeams',
        targetEmail: u.email,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeactivateConfirm(null);
      toast({ title: 'User deactivated', description: 'Account disabled and removed from active project teams.' });
    },
    onError: (e) => toast({ title: 'Deactivation failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>;

  return (
    <div className="space-y-2">
      {activeUsers.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No active users</p>
        </div>
      )}

      {activeUsers.map(u => (
        <UserRow key={u.id} u={u} actions={
          u.id === user?.id ? (
            <Badge variant="secondary" className="text-xs">You</Badge>
          ) : (
            <>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                onClick={() => { setEditingUser(u); setEditRole(u.role || 'external'); }}>
                <Pencil className="w-3 h-3" /> Edit Role
              </Button>
              <Button size="sm" variant="outline"
                className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                onClick={() => setDeactivateConfirm(u)}>
                <ShieldOff className="w-3 h-3" /> Deactivate
              </Button>
            </>
          )
        } />
      ))}

      {/* Edit role dialog */}
      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Role — {editingUser?.full_name || editingUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
            <Button onClick={() => {
              if (editRole !== (editingUser.role || 'external')) {
                setPendingRoleChange({ userId: editingUser.id, currentRole: editingUser.role || 'external', newRole: editRole, userName: editingUser.full_name || editingUser.email });
              } else {
                setEditingUser(null);
              }
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role change confirm */}
      <AlertDialog open={!!pendingRoleChange} onOpenChange={open => { if (!open) setPendingRoleChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change user role?</AlertDialogTitle>
            <AlertDialogDescription>
              Change <strong>{pendingRoleChange?.userName}</strong> from <strong>{pendingRoleChange?.currentRole}</strong> to <strong>{pendingRoleChange?.newRole}</strong>.
              This affects what they can access in ConstructIQ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction
            onClick={() => updateRoleMutation.mutate({ userId: pendingRoleChange.userId, role: pendingRoleChange.newRole })}
            disabled={updateRoleMutation.isPending}
          >
            {updateRoleMutation.isPending ? 'Saving...' : 'Confirm'}
          </AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deactivate confirm */}
      <Dialog open={!!deactivateConfirm} onOpenChange={() => setDeactivateConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Deactivate User</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Deactivate <strong>{deactivateConfirm?.full_name || deactivateConfirm?.email}</strong>?
            Their account will be disabled and they will be removed from all active project teams.
            Historical data (RFIs, tasks, documents, audit logs) is preserved.
            They can be reactivated later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivateConfirm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deactivateMutation.isPending}
              onClick={() => deactivateMutation.mutate(deactivateConfirm)}>
              {deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Pending Invitations Tab ──────────────────────────────────────────────────

function PendingInvitationsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: invitedUsers = [], isLoading } = useQuery({
    queryKey: ['invitedUsers'],
    queryFn: () => base44.entities.InvitedUser.list('-created_date', 200),
    enabled: user?.role === 'admin',
  });

  const resendMutation = useMutation({
    mutationFn: (id) => base44.functions.invoke('invitationService', { action: 'resend', invitedUserId: id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invitedUsers'] }); toast({ title: 'Invitation resent' }); },
    onError: (e) => toast({ title: 'Failed to resend', description: e.message, variant: 'destructive' }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => base44.functions.invoke('invitationService', { action: 'cancel', invitedUserId: id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invitedUsers'] }); toast({ title: 'Invitation cancelled' }); },
    onError: (e) => toast({ title: 'Failed to cancel', description: e.message, variant: 'destructive' }),
  });

  const filtered = invitedUsers.filter(i =>
    i.status === 'Pending' &&
    (!search || i.email?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by email..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No pending invitations</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(inv => {
          const isExpired = inv.token_expires_at && new Date(inv.token_expires_at) < new Date();
          return (
            <Card key={inv.id} className="border">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{inv.email}</span>
                      {inv.app_role && <Badge variant="outline" className={`text-xs ${roleColour(inv.app_role)}`}>{inv.app_role}</Badge>}
                      {isExpired && <Badge variant="outline" className="text-xs text-red-600 border-red-300 bg-red-50">Expired</Badge>}
                      {inv.resend_count > 0 && <span className="text-xs text-muted-foreground">Sent {inv.resend_count + 1}×</span>}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {inv.last_invited_at && <p>Sent: {format(new Date(inv.last_invited_at), 'dd MMM yyyy')}</p>}
                      {isExpired && inv.token_expires_at && <p className="text-red-500">Expired: {format(new Date(inv.token_expires_at), 'dd MMM yyyy')}</p>}
                      {inv.invited_by_email && <p>Invited by: {inv.invited_by_email}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                      disabled={resendMutation.isPending} onClick={() => resendMutation.mutate(inv.id)}>
                      <RotateCcw className="w-3 h-3" /> Resend
                    </Button>
                    <Button size="sm" variant="outline"
                      className="h-8 gap-1.5 text-xs text-destructive border-destructive/40 hover:bg-destructive/5"
                      disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(inv.id)}>
                      <XCircle className="w-3 h-3" /> Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Deactivated Users Tab ────────────────────────────────────────────────────

function DeactivatedUsersTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: user?.role === 'admin',
  });

  const deactivatedUsers = users.filter(u => u.data?.disabled === true);

  const reactivateMutation = useMutation({
    mutationFn: (userId) => base44.entities.User.update(userId, { data: { disabled: false } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User reactivated', description: 'They can now log in. Project access must be granted manually.' });
    },
    onError: (e) => toast({ title: 'Reactivation failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>;

  return (
    <div className="space-y-2">
      {deactivatedUsers.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <UserX className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No deactivated users</p>
        </div>
      )}

      {deactivatedUsers.map(u => (
        <UserRow key={u.id} u={u} actions={
          <Button size="sm" variant="outline"
            className="h-8 gap-1.5 text-xs text-green-700 border-green-400 hover:bg-green-50"
            disabled={reactivateMutation.isPending}
            onClick={() => reactivateMutation.mutate(u.id)}>
            <ShieldCheck className="w-3 h-3" /> Reactivate
          </Button>
        } />
      ))}

      {deactivatedUsers.length > 0 && (
        <p className="text-xs text-muted-foreground pt-2">
          Reactivating a user restores login access only. Project memberships must be re-added manually.
        </p>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function PeopleSettings() {
  return (
    <div className="space-y-1">
      <Tabs defaultValue="active">
        <TabsList className="mb-4">
          <TabsTrigger value="active" className="gap-1.5">
            <Users className="w-3.5 h-3.5" /> Active Users
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Pending Invitations
          </TabsTrigger>
          <TabsTrigger value="deactivated" className="gap-1.5">
            <UserX className="w-3.5 h-3.5" /> Deactivated Users
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <ActiveUsersTab />
        </TabsContent>
        <TabsContent value="pending">
          <PendingInvitationsTab />
        </TabsContent>
        <TabsContent value="deactivated">
          <DeactivatedUsersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}