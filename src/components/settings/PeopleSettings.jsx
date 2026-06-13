/**
 * PeopleSettings
 * Settings → People tab
 * Tabs: Users | Pending Invitations | Contacts
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Clock, BookUser, RotateCcw, XCircle, CheckCircle2, Search, UserPlus, Mail } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import UserManagement from '@/components/settings/UserManagement';

const statusBadge = (status) => {
  const map = {
    Pending:   'bg-amber-50 text-amber-700 border-amber-300',
    Accepted:  'bg-green-50 text-green-700 border-green-300',
    Expired:   'bg-gray-100 text-gray-500 border-gray-300',
    Cancelled: 'bg-red-50 text-red-600 border-red-300',
  };
  return map[status] || 'bg-gray-100 text-gray-500';
};

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

  const { data: assignments = [] } = useQuery({
    queryKey: ['pendingAssignments'],
    queryFn: () => base44.entities.PendingProjectAssignment.list('-created_date', 500),
    enabled: user?.role === 'admin',
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list(),
  });

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

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

  const filtered = invitedUsers.filter(i =>
    !search ||
    i.email?.toLowerCase().includes(search.toLowerCase())
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
          const invAssignments = assignments.filter(a => a.invitation_id === inv.id);
          const isExpired = inv.token_expires_at && new Date(inv.token_expires_at) < new Date();
          return (
            <Card key={inv.id} className="border">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{inv.email}</span>
                      <Badge variant="outline" className={`text-xs ${statusBadge(inv.status)}`}>
                        {isExpired && inv.status === 'Pending' ? 'Expired' : inv.status}
                      </Badge>
                      {inv.resend_count > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Sent {inv.resend_count + 1}×
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {inv.last_invited_at && (
                        <p>Last sent: {format(new Date(inv.last_invited_at), 'dd MMM yyyy')}</p>
                      )}
                      {inv.token_expires_at && inv.status === 'Pending' && (
                        <p className={isExpired ? 'text-red-500' : ''}>
                          {isExpired ? 'Expired' : 'Expires'}: {format(new Date(inv.token_expires_at), 'dd MMM yyyy')}
                        </p>
                      )}
                      {inv.invited_by_email && <p>Invited by: {inv.invited_by_email}</p>}
                    </div>
                    {invAssignments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {invAssignments.map(a => (
                          <span key={a.id} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                            a.status === 'Activated' ? 'bg-green-50 text-green-700 border-green-200' :
                            a.status === 'Cancelled' ? 'bg-gray-100 text-gray-400 border-gray-200 line-through' :
                            'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>
                            {projectMap[a.project_id] || a.project_id} — {a.role}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {['Pending', 'Expired'].includes(inv.status) && (
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
                  )}
                  {inv.status === 'Accepted' && (
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-1" />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

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
          <UserManagement />
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