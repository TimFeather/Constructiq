import { invokeFunction } from '@/api/supabaseClient';
import React, { useState } from 'react';
import { Project, User, TenderSubmission } from '@/api/entities';
import { fetchTaskAssignees, linkProgrammeToTeam } from '@/api/programmeData';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Trash2, HardHat, Building2, Mail, Phone, UserCheck, Loader2, Pencil, FileText, Send, Link2, CalendarDays } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { normalizeEmail } from '@/lib/normalizeEmail';
import { isUserDeactivated } from '@/lib/userStatus';
import { isDraftMember, memberEmail } from '@/lib/teamInvites';
import { linkTradeAssignees } from '@/lib/scheduleImportResources';
import { useTradeList } from '@/hooks/useTradeList';
import PersonAutocomplete from '@/components/shared/PersonAutocomplete';
import TradeSelect from '@/components/projects/TradeSelect';

const emptyForm = { user_email: '', full_name: '', business_name: '', phone: '', trade: '', quote_ref: '' };

/**
 * ProjectSubcontractors — combined Subcontractors tab.
 *
 * Single source of truth is project.team (members with role 'Subcontractor').
 * Tender conversion copies awarded submissions into the team, so this shows
 * tender-awarded and manually added subs alike ("From Tender" badge).
 *
 * Invites work like a tender's invitee list: adding a sub with an email puts
 * them on the team as a Draft — the email is held in `invite_email`, not
 * `user_email`, so they can't see the project and get no notifications yet.
 * "Send Invites" then runs each Draft through invitationService (detect →
 * addExistingUser | invite) and turns it into a real member. See
 * lib/teamInvites.js for the member shapes.
 *
 * Trades come from Settings → Trades, the list tenders use, and after invites
 * go out (or a trade is edited) the project's programme is relinked: tasks
 * resourced by a trade ("Plumber") or business name move onto the sub.
 */
export default function ProjectSubcontractors({ project, linkedTenderId }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAllowed = ['admin', 'internal', 'pricing'].includes(user?.role);
  const queryClient = useQueryClient();
  const trades = useTradeList();

  const [form, setForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [linking, setLinking] = useState(false);

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

  // Who is on which programme task — for the per-sub task count and the
  // "link the programme" prompt.
  const { data: taskAssignees = [] } = useQuery({
    queryKey: ['taskAssignees', project.id],
    queryFn: () => fetchTaskAssignees(project.id),
    enabled: isAllowed,
    staleTime: 30_000,
  });

  const updateTeam = useMutation({
    mutationFn: (team) => Project.update(project.id, { team }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
  });

  // Subcontractors with their index into the full team array (for edit/remove).
  const team = project.team || [];
  const subs = team
    .map((m, index) => ({ ...m, index }))
    .filter(m => m.role === 'Subcontractor');
  const draftSubs = subs.filter(isDraftMember);

  const grouped = subs.reduce((acc, s) => {
    const trade = s.trade || 'Unspecified';
    (acc[trade] = acc[trade] || []).push(s);
    return acc;
  }, {});

  const tasksByEmail = new Map();
  for (const t of taskAssignees) {
    for (const a of t.assignees || []) {
      const email = normalizeEmail(a.email);
      if (email) tasksByEmail.set(email, (tasksByEmail.get(email) || 0) + 1);
    }
  }
  const unlinkedTaskCount = linkTradeAssignees(taskAssignees, team).length;

  const busy = sending || linking;

  const refreshAfterTeamChange = () => {
    queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['invitedUsers'] });
    queryClient.invalidateQueries({ queryKey: ['pendingAssignments'] });
  };

  // Relink the programme to the current team. Never fails the caller: the
  // team change already happened, and the prompt offers the link again.
  const linkProgramme = async (latestTeam) => {
    try {
      const linked = await linkProgrammeToTeam(project.id, latestTeam, user?.id);
      if (linked > 0) {
        queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      }
      return linked;
    } catch (e) {
      console.warn('[ProjectSubcontractors] programme link failed:', e?.message);
      return 0;
    } finally {
      queryClient.invalidateQueries({ queryKey: ['taskAssignees', project.id] });
      queryClient.invalidateQueries({ queryKey: ['programme', project.id] });
    }
  };

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

  const emailTaken = (email, exceptIndex = null) =>
    !!email && team.some((m, i) => i !== exceptIndex && memberEmail(m) === email);

  // Adding never emails anyone. A sub with an email waits as a Draft until
  // "Send Invites"; one without is just recorded on the team.
  const addSubcontractor = async () => {
    if (!form.full_name) return;
    const email = normalizeEmail(form.user_email);
    if (emailTaken(email)) {
      toast({ title: 'Already on this project', description: `${email} is already in the team.` });
      return;
    }
    setAdding(true);
    try {
      const base = {
        full_name: form.full_name.trim(),
        business_name: form.business_name.trim(),
        phone: form.phone.trim(),
        role: 'Subcontractor',
        trade: form.trade || '',
        quote_ref: form.quote_ref.trim(),
      };
      const member = email
        ? { ...base, invite_email: email, invite_status: 'Draft', draft_id: crypto.randomUUID(), added_at: new Date().toISOString() }
        : { ...base, user_email: '' };
      await updateTeam.mutateAsync([...team, member]);
      toast({
        title: `${member.full_name} added`,
        description: email ? 'Not invited yet — click Send Invites when you’re ready.' : undefined,
      });
      setForm(emptyForm);
    } catch (e) {
      toast({ title: 'Failed to add subcontractor', description: e?.message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  // Send every Draft: existing accounts are added + notified, everyone else
  // gets an invite to register. Same invitationService calls as before, just
  // batched behind one button like issuing a tender.
  const sendInvites = async () => {
    setSending(true);
    const outcomes = new Map(); // draft_id → 'existing' | 'new'
    const failures = [];
    let reused = 0;

    for (const d of draftSubs) {
      const email = normalizeEmail(d.invite_email);
      const details = {
        fullName: d.full_name,
        businessName: d.business_name,
        phone: d.phone,
        trade: d.trade,
        quoteRef: d.quote_ref || '',
      };
      try {
        const detected = (await invokeFunction('invitationService', { action: 'detect', email }))?.data;
        if (detected?.status === 'existing_user' && detected.user) {
          await invokeFunction('invitationService', {
            action: 'addExistingUser',
            targetUserId: detected.user.id,
            projectId: project.id,
            role: 'Subcontractor',
            ...details,
          });
          outcomes.set(d.draft_id, 'existing');
        } else {
          const res = await invokeFunction('invitationService', {
            action: 'invite',
            email,
            projectId: project.id,
            projectName: project.name,
            role: 'Subcontractor',
            appRole: 'external',
            projectRole: 'Subcontractor',
            ...details,
          });
          if (res?.data?.duplicateAssignment) reused++;
          outcomes.set(d.draft_id, 'new');
        }
      } catch (e) {
        failures.push(`${d.full_name || email}: ${e?.message || 'failed'}`);
      }
    }

    let latestTeam = team;
    let listError = null;
    if (outcomes.size) {
      // addExistingUser wrote the team server-side, so start from the saved
      // copy. Existing users: drop the Draft (the server added the real
      // member). New invitees: the Draft becomes the member, email and all.
      try {
        const fresh = await Project.get(project.id);
        const now = new Date().toISOString();
        latestTeam = (fresh?.team || []).flatMap(m => {
          const outcome = m.draft_id ? outcomes.get(m.draft_id) : null;
          if (!outcome) return [m];
          if (outcome === 'existing') return [];
          const { invite_email, invite_status: _status, draft_id: _id, ...rest } = m;
          return [{ ...rest, user_email: normalizeEmail(invite_email), invite_status: 'Invited', invited_at: now }];
        });
        await Project.update(project.id, { team: latestTeam });
      } catch (e) {
        listError = e?.message || 'save failed';
      }
    }

    const linked = outcomes.size && !listError ? await linkProgramme(latestTeam) : 0;
    refreshAfterTeamChange();
    setSending(false);
    setShowSendConfirm(false);

    const sentCount = outcomes.size;
    const linkedNote = linked > 0 ? ` ${linked} programme task${linked !== 1 ? 's' : ''} linked to their trades.` : '';
    if (listError) {
      toast({
        title: `${sentCount} invite${sentCount !== 1 ? 's' : ''} sent, but the list didn't update`,
        description: `${listError}. Click Send Invites again to tidy up — nobody is emailed twice.`,
        variant: 'destructive',
        duration: 10000,
      });
    } else if (failures.length === 0) {
      toast({
        title: `${sentCount} invite${sentCount !== 1 ? 's' : ''} sent`,
        description: (reused ? `${reused} already had an invite for this project, so weren't emailed again.` : '') + linkedNote || undefined,
        duration: 5000,
      });
    } else {
      toast({
        title: `${sentCount} sent, ${failures.length} failed`,
        description: `${failures.slice(0, 3).join('; ')} — those are still waiting, so Send Invites again to retry.`,
        variant: 'destructive',
        duration: 10000,
      });
    }
  };

  const linkNow = async () => {
    setLinking(true);
    const linked = await linkProgramme(team);
    setLinking(false);
    toast({
      title: linked > 0 ? `${linked} programme task${linked !== 1 ? 's' : ''} linked` : 'Nothing to link',
      description: linked > 0 ? 'Those subs now see the tasks under My Tasks.' : undefined,
    });
  };

  const removeSub = (index) => {
    const member = team[index];
    updateTeam.mutate(team.filter((_, i) => i !== index));
    // A Draft was never invited, so there's nothing to cancel.
    if (member?.user_email) {
      invokeFunction('invitationService', {
        action: 'cancelProjectInvite',
        email: member.user_email,
        projectId: project.id,
      }).catch(() => { /* non-critical */ });
    }
  };

  const startEdit = (index) => { setEditingIndex(index); setEditValues({ ...team[index] }); };
  const saveEdit = async () => {
    const before = team[editingIndex];
    const next = { ...editValues };
    if (isDraftMember(next)) {
      next.invite_email = normalizeEmail(next.invite_email);
      if (!next.invite_email) {
        toast({ title: 'Email needed', description: 'A sub waiting to be invited needs an email. Remove them instead if they’re not coming.' });
        return;
      }
      if (emailTaken(next.invite_email, editingIndex)) {
        toast({ title: 'Already on this project', description: `${next.invite_email} is already in the team.` });
        return;
      }
    }
    const nextTeam = team.map((m, i) => i === editingIndex ? next : m);
    try {
      await updateTeam.mutateAsync(nextTeam);
    } catch (e) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
      return;
    }
    setEditingIndex(null);
    setEditValues({});
    // A real member's trade or business changed → the programme may now
    // have tasks resourced by it.
    const relevantChange = (before?.trade || '') !== (next.trade || '') || (before?.business_name || '') !== (next.business_name || '');
    if (next.user_email && relevantChange) {
      const linked = await linkProgramme(nextTeam);
      if (linked > 0) toast({ title: `${linked} programme task${linked !== 1 ? 's' : ''} linked to ${next.business_name || next.full_name}` });
    }
  };

  const renderSubCard = (sub) => {
    const email = memberEmail(sub);
    const isDraft = isDraftMember(sub);
    const matchedUser = sub.user_email ? allUsers.find(u => normalizeEmail(u.email) === normalizeEmail(sub.user_email)) : null;
    const isRegistered = !!matchedUser;
    const isDeactivated = matchedUser ? isUserDeactivated(matchedUser) : false;
    const fromTender = email && awardedEmails.has(email);
    const taskCount = sub.user_email ? tasksByEmail.get(normalizeEmail(sub.user_email)) || 0 : 0;
    return (
      <Card key={sub.index} className={isDraft ? 'border-dashed' : undefined}>
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
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(sub.index)} disabled={busy} aria-label={`Edit ${sub.full_name}`}>
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeSub(sub.index)} disabled={busy} aria-label={`Remove ${sub.full_name}`}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1">
            {email && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="w-3 h-3" />
                <a href={`mailto:${email}`} className="hover:text-foreground transition-colors truncate">{email}</a>
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
            {taskCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="w-3 h-3" /> On {taskCount} programme task{taskCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            {fromTender && <Badge variant="outline" className="text-xs">From Tender</Badge>}
            {isDraft && (
              <Badge variant="secondary" className="text-xs text-gray-600 bg-gray-100">Not invited yet</Badge>
            )}
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
      {/* Send invites — the tender "Issue" step for project subs */}
      {isAllowed && draftSubs.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Ready to invite?</p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {draftSubs.length} subcontractor{draftSubs.length !== 1 ? 's' : ''} added but not invited yet
            </p>
          </div>
          <Button onClick={() => setShowSendConfirm(true)} disabled={busy} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Send className="w-4 h-4" /> Send Invites ({draftSubs.length})
          </Button>
        </div>
      )}

      {/* Programme tasks resourced by a trade/business one sub covers */}
      {isAllowed && unlinkedTaskCount > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Programme not linked to subs</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {unlinkedTaskCount} programme task{unlinkedTaskCount !== 1 ? 's are' : ' is'} resourced by a trade or business one of these subs covers
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={linkNow} disabled={busy}
            className="gap-2 border-amber-300 text-amber-800 hover:bg-amber-100">
            {linking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            Link to Subs
          </Button>
        </div>
      )}

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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map(renderSubCard)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit (inline) */}
      {editingIndex !== null && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium">Edit Subcontractor</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-xs">Full Name</Label><Input className="h-8" value={editValues.full_name || ''} onChange={e => setEditValues(v => ({ ...v, full_name: e.target.value }))} /></div>
              <div><Label className="text-xs">Business Name</Label><Input className="h-8" value={editValues.business_name || ''} onChange={e => setEditValues(v => ({ ...v, business_name: e.target.value }))} /></div>
              {isDraftMember(editValues) && (
                <div className="sm:col-span-2"><Label className="text-xs">Email</Label><Input type="email" className="h-8" value={editValues.invite_email || ''} onChange={e => setEditValues(v => ({ ...v, invite_email: e.target.value }))} autoComplete="off" /></div>
              )}
              <div><Label className="text-xs">Phone</Label><Input className="h-8" value={editValues.phone || ''} onChange={e => setEditValues(v => ({ ...v, phone: e.target.value }))} /></div>
              <div><Label className="text-xs">Accepted Quote</Label><Input className="h-8" value={editValues.quote_ref || ''} onChange={e => setEditValues(v => ({ ...v, quote_ref: e.target.value }))} placeholder="e.g. Q-1042" /></div>
              <div>
                <Label className="text-xs">Trade</Label>
                <TradeSelect key={editingIndex} trades={trades} value={editValues.trade} onChange={val => setEditValues(v => ({ ...v, trade: val }))} />
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
          <div>
            <p className="text-sm font-medium">Add Subcontractor</p>
            <p className="text-xs text-muted-foreground">Nobody is emailed when you add them — use Send Invites once everyone is in.</p>
          </div>
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
              <TradeSelect compact={false} trades={trades} value={form.trade} onChange={v => setForm(f => ({ ...f, trade: v }))} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.user_email} onChange={e => setForm({ ...form, user_email: e.target.value })} placeholder="Email — they're invited when you click Send Invites" autoComplete="off" />
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
              <Input value={form.quote_ref} onChange={e => setForm({ ...form, quote_ref: e.target.value })} placeholder="e.g. Q-1042 — included in the invite so they know which quote was accepted (optional)" autoComplete="off" />
            </div>
          </div>
          <Button onClick={addSubcontractor} disabled={!form.full_name || adding || busy} className="gap-2">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {adding ? 'Adding...' : 'Add Subcontractor'}
          </Button>
        </div>
      )}

      {/* Send confirm */}
      <AlertDialog open={showSendConfirm} onOpenChange={(open) => { if (!sending) setShowSendConfirm(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send invites?</AlertDialogTitle>
            <AlertDialogDescription>
              Email {draftSubs.length} subcontractor{draftSubs.length !== 1 ? 's' : ''} about {project.name}. Anyone who already has an account is added to the project straight away; everyone else gets a link to register. Accepted quote numbers are included.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <ul className="max-h-48 overflow-y-auto text-sm space-y-1 border rounded-md p-2">
            {draftSubs.map(d => (
              <li key={d.draft_id || d.index} className="flex justify-between gap-2">
                <span className="truncate">{d.business_name || d.full_name}{d.trade ? ` · ${d.trade}` : ''}</span>
                <span className="text-xs text-muted-foreground truncate">{d.invite_email}</span>
              </li>
            ))}
          </ul>

          {sending && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
              <p className="text-sm text-blue-800 dark:text-blue-200">Sending invites… do not close this window.</p>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <Button onClick={sendInvites} disabled={sending} className="gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? 'Sending…' : `Send ${draftSubs.length} Invite${draftSubs.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
