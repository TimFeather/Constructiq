import { invokeFunction } from '@/api/supabaseClient';
import React, { useState } from 'react';
import { Project, User, TenderSubmission } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, HardHat, Building2, Mail, Phone, UserCheck, Loader2, Pencil, FileText } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { normalizeEmail } from '@/lib/normalizeEmail';
import { isUserDeactivated } from '@/lib/userStatus';
import PersonAutocomplete from '@/components/shared/PersonAutocomplete';

const TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection',
];

const emptyForm = { user_email: '', full_name: '', business_name: '', phone: '', trade: '', quote_ref: '' };

/**
 * ProjectSubcontractors — combined Subcontractors tab.
 *
 * Single source of truth is project.team (members with role 'Subcontractor').
 * Tender conversion already copies awarded submissions into the team as
 * Subcontractors, so this view shows both tender-awarded and manually-added
 * subs. Subs whose email matches an Awarded submission on the linked tender are
 * badged "From Tender". Add/invite reuses the same invitationService flow as
 * TeamManager (detect → addExistingUser | invite) so behaviour is identical.
 */
export default function ProjectSubcontractors({ project, linkedTenderId }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAllowed = ['admin', 'internal', 'pricing'].includes(user?.role);
  const queryClient = useQueryClient();

  const [form, setForm] = useState(emptyForm);
  const [customTrade, setCustomTrade] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editValues, setEditValues] = useState({});

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => User.list(),
    enabled: isAllowed,
  });

  // Awarded submissions on the linked tender — used to badge "From Tender".
  const { data: awardedSubs = [] } = useQuery({
    queryKey: ['tenderSubmissions', linkedTenderId],
    queryFn: () => TenderSubmission.filter({ tender_id: linkedTenderId }),
    enabled: !!linkedTenderId,
  });
  const awardedEmails = new Set(
    awardedSubs.filter(s => s.outcome === 'Awarded').map(s => normalizeEmail(s.invitee_email)),
  );

  const updateTeam = useMutation({
    mutationFn: (team) => Project.update(project.id, { team }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
  });

  // Subcontractors with their index into the full team array (for edit/remove).
  const team = project.team || [];
  const subs = team
    .map((m, index) => ({ ...m, index }))
    .filter(m => m.role === 'Subcontractor');

  const grouped = subs.reduce((acc, s) => {
    const trade = s.trade || 'Unspecified';
    (acc[trade] = acc[trade] || []).push(s);
    return acc;
  }, {});

  const selectSuggestion = (p) => {
    setForm(f => ({
      ...f,
      full_name: p.full_name || f.full_name,
      user_email: p.email || f.user_email,
      phone: p.phone || f.phone,
      business_name: p.business_name || f.business_name,
      trade: p.trade || f.trade,
    }));
  };

  const addSubcontractor = async () => {
    if (!form.full_name) return;
    setAdding(true);
    try {
      const trade = form.trade === 'custom' ? customTrade : form.trade;
      const quoteRef = form.quote_ref.trim();
      const member = {
        user_email: normalizeEmail(form.user_email),
        full_name: form.full_name,
        business_name: form.business_name,
        phone: form.phone,
        role: 'Subcontractor',
        trade: trade || '',
        quote_ref: quoteRef,
      };

      // Detect whether this email is already a user (mirrors TeamManager).
      let status = 'new';
      let detected = null;
      if (member.user_email) {
        try {
          const res = await invokeFunction('invitationService', { action: 'detect', email: member.user_email });
          status = res.data?.status || 'new';
          detected = res.data || null;
        } catch (_e) { /* fall through as new */ }
      }

      if (status === 'existing_user' && detected?.user) {
        await invokeFunction('invitationService', {
          action: 'addExistingUser',
          targetUserId: detected.user.id,
          projectId: project.id,
          role: 'Subcontractor',
          fullName: member.full_name,
          businessName: member.business_name,
          phone: member.phone,
          trade: member.trade,
          quoteRef,
        });
        toast({ title: `${member.full_name} added to project` });
      } else if (member.user_email) {
        await updateTeam.mutateAsync([...team, member]);
        const res = await invokeFunction('invitationService', {
          action: 'invite',
          email: member.user_email,
          fullName: member.full_name,
          businessName: member.business_name,
          phone: member.phone,
          trade: member.trade,
          quoteRef,
          projectId: project.id,
          projectName: project.name,
          role: 'Subcontractor',
          appRole: 'external',
          projectRole: 'Subcontractor',
        });
        const data = res?.data;
        if (data?.duplicateAssignment) toast({ title: `${member.full_name} added`, description: 'Existing invitation reused.' });
        else if (data?.isNewInvite) toast({ title: `${member.full_name} added`, description: 'Invitation email sent.' });
        else toast({ title: `${member.full_name} added to project` });
      } else {
        // No email — just record on the team.
        await updateTeam.mutateAsync([...team, member]);
        toast({ title: `${member.full_name} added to project` });
      }

      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['invitedUsers'] });
      queryClient.invalidateQueries({ queryKey: ['pendingAssignments'] });
      setForm(emptyForm);
      setCustomTrade('');
    } catch (e) {
      toast({ title: 'Failed to add subcontractor', description: e?.message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const removeSub = (index) => {
    const member = team[index];
    updateTeam.mutate(team.filter((_, i) => i !== index));
    if (member?.user_email) {
      invokeFunction('invitationService', {
        action: 'cancelProjectInvite',
        email: member.user_email,
        projectId: project.id,
      }).catch(() => { /* non-critical */ });
    }
  };

  const startEdit = (index) => { setEditingIndex(index); setEditValues({ ...team[index] }); };
  const saveEdit = () => {
    updateTeam.mutate(team.map((m, i) => i === editingIndex ? { ...editValues } : m));
    setEditingIndex(null);
    setEditValues({});
  };

  const renderSubCard = (sub) => {
    const matchedUser = allUsers.find(u => normalizeEmail(u.email) === normalizeEmail(sub.user_email));
    const isRegistered = !!matchedUser;
    const isDeactivated = matchedUser ? isUserDeactivated(matchedUser) : false;
    const fromTender = sub.user_email && awardedEmails.has(normalizeEmail(sub.user_email));
    return (
      <Card key={sub.index}>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{sub.full_name || '—'}</p>
              {sub.business_name && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                  <Building2 className="w-3 h-3" /> {sub.business_name}
                </div>
              )}
            </div>
            {isAllowed && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(sub.index)}>
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeSub(sub.index)}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1">
            {sub.user_email && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="w-3 h-3" />
                <a href={`mailto:${sub.user_email}`} className="hover:text-foreground transition-colors truncate">{sub.user_email}</a>
              </div>
            )}
            {sub.phone && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Phone className="w-3 h-3" /> {sub.phone}
              </div>
            )}
            {sub.quote_ref && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="w-3 h-3" /> Accepted quote: {sub.quote_ref}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            {fromTender && <Badge variant="outline" className="text-xs">From Tender</Badge>}
            {sub.user_email && isRegistered && !isDeactivated && (
              <Badge variant="secondary" className="text-xs text-green-700 bg-green-50 gap-1"><UserCheck className="w-3 h-3" /> Registered</Badge>
            )}
            {sub.user_email && !isRegistered && (
              <Badge variant="secondary" className="text-xs text-amber-600 bg-amber-50">Invite Pending</Badge>
            )}
            {isDeactivated && (
              <Badge variant="outline" className="text-xs text-red-600 border-red-300 bg-red-50">Deactivated</Badge>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-5">
      {subs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6 border rounded-lg">
          No subcontractors on this project yet.{isAllowed && ' Add one below.'}
        </p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([trade, list]) => (
            <div key={trade}>
              <div className="flex items-center gap-2 mb-2">
                <HardHat className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">{trade}</h3>
                <span className="text-xs text-muted-foreground">({list.length})</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map(renderSubCard)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit dialog (inline) */}
      {editingIndex !== null && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium">Edit Subcontractor</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-xs">Full Name</Label><Input className="h-8" value={editValues.full_name || ''} onChange={e => setEditValues(v => ({ ...v, full_name: e.target.value }))} /></div>
              <div><Label className="text-xs">Business Name</Label><Input className="h-8" value={editValues.business_name || ''} onChange={e => setEditValues(v => ({ ...v, business_name: e.target.value }))} /></div>
              <div><Label className="text-xs">Phone</Label><Input className="h-8" value={editValues.phone || ''} onChange={e => setEditValues(v => ({ ...v, phone: e.target.value }))} /></div>
              <div><Label className="text-xs">Accepted Quote</Label><Input className="h-8" value={editValues.quote_ref || ''} onChange={e => setEditValues(v => ({ ...v, quote_ref: e.target.value }))} placeholder="e.g. Q-1042" /></div>
              <div>
                <Label className="text-xs">Trade</Label>
                <Select value={editValues.trade || ''} onValueChange={val => setEditValues(v => ({ ...v, trade: val }))}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Select trade" /></SelectTrigger>
                  <SelectContent>{TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={saveEdit} disabled={updateTeam.isPending}>Save</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditingIndex(null); setEditValues({}); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add form */}
      {isAllowed && editingIndex === null && (
        <div className="border-t pt-4 space-y-3">
          <p className="text-sm font-medium">Add Subcontractor</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Full Name *</Label>
              <PersonAutocomplete
                value={form.full_name}
                onChange={val => setForm(f => ({ ...f, full_name: val }))}
                onSelect={selectSuggestion}
                includeUsers
                placeholder="Search contacts or enter name…"
              />
            </div>
            <div>
              <Label className="text-xs">Trade</Label>
              <Select value={form.trade} onValueChange={v => setForm({ ...form, trade: v })}>
                <SelectTrigger><SelectValue placeholder="Select or type trade" /></SelectTrigger>
                <SelectContent>
                  {TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  <SelectItem value="custom">Other (type below)</SelectItem>
                </SelectContent>
              </Select>
              {form.trade === 'custom' && (
                <Input className="mt-2" value={customTrade} onChange={e => setCustomTrade(e.target.value)} placeholder="Enter trade" />
              )}
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.user_email} onChange={e => setForm({ ...form, user_email: e.target.value })} placeholder="Email — an invitation is sent if they don't have an account" autoComplete="off" />
            </div>
            <div>
              <Label className="text-xs">Business Name</Label>
              <Input value={form.business_name} onChange={e => setForm({ ...form, business_name: e.target.value })} placeholder="Business name" />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Accepted Quote</Label>
              <Input value={form.quote_ref} onChange={e => setForm({ ...form, quote_ref: e.target.value })} placeholder="e.g. Q-1042 — included in the email so they know which quote was accepted (optional)" autoComplete="off" />
            </div>
          </div>
          <Button onClick={addSubcontractor} disabled={!form.full_name || adding} className="gap-2">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {adding ? 'Adding...' : 'Add Subcontractor'}
          </Button>
        </div>
      )}
    </div>
  );
}
