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
import { Users, Clock, BookUser, RotateCcw, XCircle, Search, Pencil, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [pendingRoleChange, setPendingRoleChange] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: user?.role === 'admin',
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, role }) => base44.entities.User.update(userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
      setPendingRoleChange(null);
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId) => base44.entities.User.delete(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleteConfirm(null);
    },
  });

  const roleColour = (role) => {
    if (role === 'admin')    return 'bg-purple-100 text-purple-700 border-purple-300';
    if (role === 'internal') return 'bg-blue-100 text-blue-700 border-blue-300';
    if (role === 'pricing')  return 'bg-amber-100 text-amber-700 border-amber-300';
    return 'bg-gray-100 text-gray-600';
  };

  if (isLoading) return <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>;

  return (
    <div className="space-y-2">
      {users.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No registered users</p>
        </div>
      )}

      {users.map(u => (
        <div key={u.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{u.full_name || u.email}</p>
            <p className="text-xs text-muted-foreground">{u.email}</p>
            <Badge variant="outline" className={`text-xs mt-1 ${roleColour(u.role || 'external')}`}>
              {u.role || 'external'}
            </Badge>
          </div>
          {u.id === user?.id ? (
            <Badge variant="secondary" className="text-xs flex-shrink-0">You</Badge>
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                onClick={() => { setEditingUser(u); setEditRole(u.role || 'external'); }}>
                <Pencil className="w-3 h-3" /> Edit Role
              </Button>
              <Button size="sm" variant="destructive" className="h-8 gap-1.5 text-xs"
                onClick={() => setDeleteConfirm(u)}>
                <Trash2 className="w-3 h-3" /> Remove
              </Button>
            </div>
          )}
        </div>
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
            onClick={() => updateUserMutation.mutate({ userId: pendingRoleChange.userId, role: pendingRoleChange.newRole })}
            disabled={updateUserMutation.isPending}
          >
            {updateUserMutation.isPending ? 'Saving...' : 'Confirm'}
          </AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Remove User</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Remove <strong>{deleteConfirm?.full_name || deleteConfirm?.email}</strong>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteUserMutation.isPending}
              onClick={() => deleteUserMutation.mutate(deleteConfirm.id)}>
              {deleteUserMutation.isPending ? 'Removing...' : 'Remove'}
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
    mutationFn: (invitedUserId) =>
      base44.functions.invoke('invitationService', { action: 'resend', invitedUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitedUsers'] });
      toast({ title: 'Invitation resent' });
    },
    onError: (e) => toast({ title: 'Failed to resend', description: e.message, variant: 'destructive' }),
  });

  const cancelMutation = useMutation({
    mutationFn: (invitedUserId) =>
      base44.functions.invoke('invitationService', { action: 'cancel', invitedUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitedUsers'] });
      queryClient.invalidateQueries({ queryKey: ['pendingAssignments'] });
      toast({ title: 'Invitation cancelled' });
    },
    onError: (e) => toast({ title: 'Failed to cancel', description: e.message, variant: 'destructive' }),
  });

  // Only show Pending status invitations
  const filtered = invitedUsers.filter(i =>
    i.status === 'Pending' &&
    (!search || i.email?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
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
                      {inv.app_role && (
                        <Badge variant="outline" className="text-xs">{inv.app_role}</Badge>
                      )}
                      {isExpired && (
                        <Badge variant="outline" className="text-xs text-red-600 border-red-300 bg-red-50">Expired</Badge>
                      )}
                      {inv.resend_count > 0 && (
                        <span className="text-xs text-muted-foreground">Sent {inv.resend_count + 1}×</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {inv.last_invited_at && (
                        <p>Sent: {format(new Date(inv.last_invited_at), 'dd MMM yyyy')}</p>
                      )}
                      {isExpired && inv.token_expires_at && (
                        <p className="text-red-500">Expired: {format(new Date(inv.token_expires_at), 'dd MMM yyyy')}</p>
                      )}
                      {inv.invited_by_email && <p>Invited by: {inv.invited_by_email}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      size="sm" variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      disabled={resendMutation.isPending}
                      onClick={() => resendMutation.mutate(inv.id)}
                    >
                      <RotateCcw className="w-3 h-3" /> Resend
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-8 gap-1.5 text-xs text-destructive border-destructive/40 hover:bg-destructive/5"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(inv.id)}
                    >
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

// ─── Contacts Tab ─────────────────────────────────────────────────────────────

function ContactsTab() {
  const [search, setSearch] = useState('');
  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['tenderContacts'],
    queryFn: () => base44.entities.TenderContact.list('-created_date', 500),
  });

  const filtered = contacts.filter(c =>
    !search ||
    c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.business_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.trade?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search contacts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} contacts</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <BookUser className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No contacts found</p>
          <p className="text-xs mt-1">Contacts are added via the Subcontractor Directory or Tender workflow</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(c => (
          <div key={c.id} className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg border border-transparent hover:border-border transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{c.full_name}</span>
                {c.business_name && <span className="text-xs text-muted-foreground">{c.business_name}</span>}
                {c.trade && <Badge variant="secondary" className="text-xs">{c.trade}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {[c.email, c.phone].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function PeopleSettings() {
  return (
    <div className="space-y-1">
      <Tabs defaultValue="users">
        <TabsList className="mb-4">
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="w-3.5 h-3.5" /> Users
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Pending Invitations
          </TabsTrigger>
          <TabsTrigger value="contacts" className="gap-1.5">
            <BookUser className="w-3.5 h-3.5" /> Contacts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersTab />
        </TabsContent>

        <TabsContent value="pending">
          <PendingInvitationsTab />
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}