import { invokeFunction, supabase } from '@/api/supabaseClient';
/**
 * InviteeManager
 *
 * Source of truth: TenderInvitee entity only.
 * No direct writes to TenderContact (handled server-side via manageTenderInvitee).
 * No tokens or invitations created here — those happen at issue time via sendTenderInvitations.
 *
 * v2: Actions column (Resend, Delete/Archive), Resend All Outstanding button.
 */
import React, { useState, useRef } from 'react';
import { TenderContact, TenderInvitee, TenderSubmission, TradeTemplate } from '@/api/entities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Users, Plus, Trash2, Send, Search, RefreshCw, Archive, Link } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { deriveLegacyContactNames } from '@/lib/tenderContacts';
import PersonAutocomplete from '@/components/shared/PersonAutocomplete';
import { filterContacts } from '@/lib/contactFilter';
import {
  DELIVERY_STATUS_STYLES, DELIVERY_STATUS_LABELS,
  resolveDeliveryDisplay, formatDeliveryTime,
} from '@/lib/emailDelivery';

const DEFAULT_TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection'
];

const STATUS_STYLES = {
  Draft:      'bg-gray-100 text-gray-600',
  Invited:    'bg-blue-100 text-blue-700',
  Viewed:     'bg-cyan-100 text-cyan-700',
  Submitted:  'bg-green-100 text-green-700',
  Declined:   'bg-red-100 text-red-600',
  Archived:   'bg-gray-100 text-gray-400',
};

const emptyForm = { full_name: '', business_name: '', email: '', phone: '', trade: '' };

const RESENDABLE_STATUSES = ['Draft', 'Invited', 'Viewed'];

export default function InviteeManager({ tender, onUpdate, canManage }) {
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const { data: tradeTemplates = [] } = useQuery({
    queryKey: ['trade_templates'],
    queryFn: () => TradeTemplate.list('sort_order'),
    staleTime: 5 * 60_000,
  });
  const TRADES = tradeTemplates.length > 0 ? tradeTemplates.map(t => t.name) : DEFAULT_TRADES;

  const [form, setForm]             = useState(emptyForm);
  const [nameSearch, setNameSearch] = useState('');

  const [showSearch, setShowSearch]       = useState(false);
  const [searchQ, setSearchQ]             = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const searchDebounce = useRef(null);

  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueResult, setIssueResult] = useState(null);
  const [adding, setAdding]   = useState(false);

  // Per-invitee loading state: { [inviteeId]: 'resending' | 'deleting' }
  const [actionLoading, setActionLoading] = useState({});

  // Archive confirmation dialog
  const [archiveTarget, setArchiveTarget] = useState(null); // invitee record
  const [deleteTarget, setDeleteTarget]   = useState(null); // invitee to confirm delete

  // Resend all loading
  const [resendingAll, setResendingAll] = useState(false);

  // ── Primary data: TenderInvitee ───────────────────────────────────────────
  const { data: invitees = [], refetch: refetchInvitees } = useQuery({
    queryKey: ['tenderInvitees', tender.id],
    queryFn:  () => TenderInvitee.filter({ tender_id: tender.id }),
    enabled:  !!tender.id,
  });

  // Invitation tokens (for Copy Link button)
  const { data: invitations = [], refetch: refetchInvitations } = useQuery({
    queryKey: ['tenderInvitations', tender.id],
    queryFn:  async () => {
      const { data, error } = await supabase.from('tender_invitations').select('*').eq('tender_id', tender.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled:  !!tender.id,
  });

  // Map invitee_id → invitation record for quick lookup
  const invitationByInviteeId = Object.fromEntries(invitations.map(inv => [inv.invitee_id, inv]));

  // Latest Resend delivery status per invitee. Refetched on an interval
  // because webhook events land server-side, not in response to anything
  // the user does here.
  const { data: deliveries = [] } = useQuery({
    queryKey: ['tenderInviteeDelivery', tender.id],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('tender_invitee_delivery').select('*').eq('tender_id', tender.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled:  !!tender.id,
    refetchInterval: 60_000,
  });

  const deliveryByInviteeId = Object.fromEntries(deliveries.map(d => [d.invitee_id, d]));

  const copySubmissionLink = (inv) => {
    const invitation = invitationByInviteeId[inv.id];
    if (!invitation?.token) {
      toast({ title: 'No link yet', description: 'Issue the tender first to generate a submission link', duration: 4000 });
      return;
    }
    const url = `${window.location.origin}/tender-submit/${invitation.token}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: 'Link copied', description: url, duration: 4000 });
    }).catch(() => {
      toast({ title: 'Link', description: url, duration: 8000 });
    });
  };

  const { data: contacts = [] } = useQuery({
    queryKey: ['tenderContacts'],
    queryFn:  () => TenderContact.list('-created_at', 500).catch(() => []),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tender', tender.id] });
    queryClient.invalidateQueries({ queryKey: ['tenderInvitees', tender.id] });
    queryClient.invalidateQueries({ queryKey: ['tenderInvitations', tender.id] });
  };

  // ── Name autocomplete ─────────────────────────────────────────────────────
  const handleNameInput = (val) => {
    setNameSearch(val);
    setForm(f => ({ ...f, full_name: val }));
  };

  const selectSuggestion = (c) => {
    setForm({ full_name: c.full_name || '', business_name: c.business_name || '', email: c.email || '', phone: c.phone || '', trade: c.trade || '' });
    setNameSearch(c.full_name || '');
  };

  // ── Subcontractor search ──────────────────────────────────────────────────
  const handleSearchInput = (val) => {
    setSearchQ(val);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      if (val.length >= 1) {
        setSearchResults(filterContacts(contacts, val).slice(0, 20));
      } else {
        setSearchResults([]);
      }
    }, 300);
  };

  // ── Add invitee ───────────────────────────────────────────────────────────
  const addInviteeCore = async ({ full_name, business_name, email, phone, trade }) => {
    if (!full_name) return false;

    const emailLower = email?.toLowerCase();
    if (emailLower && invitees.some(i => i.email?.toLowerCase() === emailLower)) {
      toast({ title: 'Already added', description: `${email} is already in the invitee list`, duration: 3000 });
      return false;
    }

    setAdding(true);
    try {
      const result = await invokeFunction('manageTenderInvitee', {
        action:       'create',
        tenderId:     tender.id,
        fullName:     full_name,
        businessName: business_name || '',
        email:        email         || '',
        phone:        phone         || '',
        trade:        trade         || '',
      });
      if (!result.data?.invitee?.id) throw new Error('No invitee id returned');
      await refetchInvitees();
      queryClient.invalidateQueries({ queryKey: ['tenderContacts'] });
      return true;
    } catch (err) {
      toast({ title: 'Failed to add invitee', description: err?.message, variant: 'destructive', duration: 8000 });
      return false;
    } finally {
      setAdding(false);
    }
  };

  const addFromSearch = async (c) => {
    const ok = await addInviteeCore({ full_name: c.full_name, business_name: c.business_name, email: c.email, phone: c.phone, trade: c.trade });
    if (ok) toast({ title: `${c.full_name} added`, duration: 2500 });
  };

  const addInvitee = async () => {
    const ok = await addInviteeCore({ ...form, trade: form.trade === 'NONE' ? '' : form.trade });
    if (ok) {
      toast({ title: `${form.full_name} added`, duration: 2500 });
      setForm(emptyForm);
      setNameSearch('');
      setNameSuggestions([]);
    }
  };

  // ── Resend invitation ─────────────────────────────────────────────────────
  const resendInvitation = async (inv) => {
    if (actionLoading[inv.id]) return;
    setActionLoading(s => ({ ...s, [inv.id]: 'resending' }));
    try {
      await invokeFunction('resendInvitation', { inviteeId: inv.id });
      toast({ title: `Invitation resent to ${inv.full_name}`, duration: 3000 });
      invalidateAll();
      await refetchInvitees();
    } catch (err) {
      toast({ title: 'Resend failed', description: err?.response?.data?.error || err?.message, variant: 'destructive', duration: 6000 });
    } finally {
      setActionLoading(s => ({ ...s, [inv.id]: null }));
    }
  };

  // ── Resend all outstanding (Sent + Viewed, excludes Submitted/Archived) ───
  const resendAllOutstanding = async () => {
    const outstanding = invitees.filter(i => i.status === 'Invited' || i.status === 'Viewed');
    if (outstanding.length === 0) {
      toast({ title: 'No outstanding invitations', description: 'All invitees have either submitted or not yet been sent an invitation.', duration: 4000 });
      return;
    }
    setResendingAll(true);
    let succeeded = 0, failed = 0;
    for (const inv of outstanding) {
      try {
        await invokeFunction('resendInvitation', { inviteeId: inv.id });
        succeeded++;
      } catch {
        failed++;
      }
    }
    invalidateAll();
    await refetchInvitees();
    setResendingAll(false);
    if (failed === 0) {
      toast({ title: `${succeeded} invitation${succeeded !== 1 ? 's' : ''} resent`, duration: 3500 });
    } else {
      toast({ title: `${succeeded} resent, ${failed} failed`, variant: 'destructive', duration: 6000 });
    }
  };

  // ── Delete / Archive invitee ──────────────────────────────────────────────
  const handleDeleteInvitee = async (inv) => {
    // Check if a submission exists
    const submissions = await TenderSubmission.filter({ invitee_id: inv.id }).catch(() => []);
    if (submissions.length > 0) {
      // Show archive confirmation
      setArchiveTarget(inv);
      return;
    }
    // Hard delete
    setActionLoading(s => ({ ...s, [inv.id]: 'deleting' }));
    try {
      await invokeFunction('manageTenderInvitee', { action: 'delete', inviteeId: inv.id });
      invalidateAll();
      await refetchInvitees();
      toast({ title: `${inv.full_name} removed`, duration: 2500 });
    } catch (err) {
      toast({ title: 'Remove failed', description: err?.message, variant: 'destructive', duration: 5000 });
    } finally {
      setActionLoading(s => ({ ...s, [inv.id]: null }));
    }
  };

  const archiveInvitee = async () => {
    if (!archiveTarget) return;
    const inv = archiveTarget;
    setArchiveTarget(null);
    setActionLoading(s => ({ ...s, [inv.id]: 'deleting' }));
    try {
      await TenderInvitee.update(inv.id, { status: 'Archived' });
      invalidateAll();
      await refetchInvitees();
      toast({ title: `${inv.full_name} archived`, duration: 2500 });
    } catch (err) {
      toast({ title: 'Archive failed', description: err?.message, variant: 'destructive', duration: 5000 });
    } finally {
      setActionLoading(s => ({ ...s, [inv.id]: null }));
    }
  };

  // ── Issue tender ──────────────────────────────────────────────────────────
  const draftInvitees  = invitees.filter(i => (!i.status || i.status === 'Draft') && i.status !== 'Archived');
  const emailableCount = invitees.filter(i => i.email && i.status !== 'Archived').length;
  const newCount       = draftInvitees.filter(i => i.email).length;

  const showIssueButton = canManage && invitees.filter(i => i.status !== 'Archived').length > 0 &&
    (tender.status === 'Draft' || (tender.status === 'Issued' && draftInvitees.length > 0));

  const outstandingCount = invitees.filter(i => i.status === 'Invited' || i.status === 'Viewed').length;

  const issueTender = async () => {
    setIssuing(true);
    try {
      await onUpdate({
        status:     'Issued',
        issue_date: tender.issue_date || new Date().toISOString().split('T')[0],
      });

      const result = await invokeFunction('sendTenderInvitations', {
        tenderId: tender.id,
        tenderInfo: {
          title:                tender.title,
          tender_number:        tender.tender_number        || '',
          location:             tender.location             || '',
          closing_date:         tender.closing_date         || '',
          description:          tender.description          || '',
          trade_packages:       tender.trade_packages       || [],
          ...deriveLegacyContactNames(tender),
        },
        appUrl: window.location.origin,
      });

      const { sent = 0, failed = 0, errors = [] } = result.data || {};

      invalidateAll();
      await Promise.all([refetchInvitees(), refetchInvitations()]);

      setIssueResult({ sent, failed, errors });

      if (sent > 0 && failed === 0) {
        toast({ title: `Tender issued — ${sent} invitation${sent !== 1 ? 's' : ''} sent`, duration: 5000 });
      } else if (sent > 0) {
        toast({ title: `${sent} sent, ${failed} failed`, description: errors.slice(0, 3).join('; '), variant: 'destructive', duration: 10000 });
      } else if (newCount === 0) {
        toast({ title: 'Tender status updated', description: 'No uninvited contacts to email', duration: 4000 });
      } else {
        toast({ title: 'No invitations sent', description: errors.slice(0, 3).join('; ') || 'Check invitees have valid emails', variant: 'destructive', duration: 10000 });
      }
    } catch (err) {
      toast({ title: 'Issue Tender Failed', description: err?.message, variant: 'destructive', duration: 10000 });
    } finally {
      setIssuing(false);
      setShowIssueConfirm(false);
      setIssueResult(null);
    }
  };

  // Visible invitees: exclude Archived from default view
  const visibleInvitees = invitees.filter(i => i.status !== 'Archived');
  const archivedCount   = invitees.filter(i => i.status === 'Archived').length;

  return (
    <div className="space-y-6">
      {/* Issue button */}
      {showIssueButton && (
        <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {tender.status === 'Issued' ? 'New invitees to send' : 'Ready to issue?'}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {tender.status === 'Issued'
                ? `${draftInvitees.length} new invitee${draftInvitees.length !== 1 ? 's' : ''} will receive an invitation email`
                : `${visibleInvitees.length} invitee${visibleInvitees.length !== 1 ? 's' : ''} · ${emailableCount} with email addresses`}
            </p>
          </div>
          <Button onClick={() => setShowIssueConfirm(true)} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Send className="w-4 h-4" /> {tender.status === 'Issued' ? 'Send to New' : 'Issue Tender'}
          </Button>
        </div>
      )}

      {/* Resend all outstanding */}
      {canManage && outstandingCount > 0 && tender.status === 'Issued' && (
        <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Outstanding invitations</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {outstandingCount} invitee{outstandingCount !== 1 ? 's' : ''} sent/viewed but not yet submitted
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-amber-300 text-amber-800 hover:bg-amber-100"
            onClick={resendAllOutstanding}
            disabled={resendingAll}
          >
            {resendingAll
              ? <><div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /> Resending…</>
              : <><RefreshCw className="w-3.5 h-3.5" /> Resend Outstanding</>
            }
          </Button>
        </div>
      )}

      {/* Add invitee UI */}
      {canManage && !issuing && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant={!showSearch ? 'default' : 'outline'} size="sm" className="gap-2" onClick={() => setShowSearch(false)}>
              <Plus className="w-4 h-4" /> Add New
            </Button>
            <Button variant={showSearch ? 'default' : 'outline'} size="sm" className="gap-2"
              onClick={() => { setShowSearch(true); setSearchQ(''); setSearchResults([]); }}>
              <Search className="w-4 h-4" /> From Database ({contacts.length})
            </Button>
          </div>

          {showSearch && (
            <div className="border rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-muted-foreground">Search subcontractor database</p>
              <Input autoFocus value={searchQ} onChange={e => handleSearchInput(e.target.value)}
                placeholder="Search by name, business, email or trade…" />
              {searchQ.length >= 1 && searchResults.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">No matches found</p>
              )}
              {searchResults.length > 0 && (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {searchResults.map(c => {
                    const added = invitees.some(i => i.email?.toLowerCase() === c.email?.toLowerCase());
                    return (
                      <div key={c.id} className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/40 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{c.full_name}</span>
                            {c.business_name && <span className="text-xs text-muted-foreground">{c.business_name}</span>}
                            {c.trade && <span className="text-xs bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">{c.trade}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{[c.email, c.phone].filter(Boolean).join(' · ')}</p>
                        </div>
                        <Button size="sm" variant="outline" className="ml-3 flex-shrink-0 gap-1"
                          onClick={() => addFromSearch(c)} disabled={added || adding}>
                          {added ? 'Added' : adding ? '…' : <><Plus className="w-3.5 h-3.5" /> Add</>}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              {searchQ.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Start typing to search {contacts.length} subcontractor{contacts.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {!showSearch && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Label className="text-xs">Full Name *</Label>
                  <PersonAutocomplete
                    value={nameSearch}
                    onChange={handleNameInput}
                    onSelect={selectSuggestion}
                    placeholder="Search contacts or enter name…"
                  />
                </div>
                <div>
                  <Label className="text-xs">Business Name</Label>
                  <Input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} placeholder="Company" />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@company.com" />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" />
                </div>
                <div>
                  <Label className="text-xs">Trade</Label>
                  <Select value={form.trade || 'NONE'} onValueChange={v => setForm(f => ({ ...f, trade: v === 'NONE' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select trade" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE"><span className="text-muted-foreground">— No trade —</span></SelectItem>
                      {TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={addInvitee} disabled={!form.full_name || adding} className="gap-2" size="sm">
                <Plus className="w-4 h-4" /> {adding ? 'Adding…' : 'Add Invitee'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Invitee list */}
      {visibleInvitees.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No invitees added yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            {visibleInvitees.length} Invitee{visibleInvitees.length !== 1 ? 's' : ''}
            {archivedCount > 0 && <span className="ml-2 text-xs text-gray-400">({archivedCount} archived)</span>}
          </p>
          {visibleInvitees.map(inv => {
            const isLoading = !!actionLoading[inv.id];
            const canResend = canManage && RESENDABLE_STATUSES.includes(inv.status || 'Draft') && tender.status === 'Issued';
            const canDelete = canManage && inv.status !== 'Archived';
            const delivery = resolveDeliveryDisplay(deliveryByInviteeId[inv.id]);

            return (
              <div key={inv.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{inv.full_name || '—'}</span>
                    {inv.business_name && <span className="text-xs text-muted-foreground">{inv.business_name}</span>}
                    {inv.trade && <span className="text-xs bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">{inv.trade}</span>}
                    {inv.status && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                        {inv.status}
                      </span>
                    )}
                    {delivery && (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${DELIVERY_STATUS_STYLES[delivery.status] || 'bg-gray-100 text-gray-700'}`}
                        title={formatDeliveryTime(deliveryByInviteeId[inv.id]?.last_event_at)}
                      >
                        {DELIVERY_STATUS_LABELS[delivery.status] || delivery.status}
                      </span>
                    )}
                    {delivery?.retryInFlight && (
                      <span className="text-xs text-muted-foreground">resend in progress</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{inv.email || 'No email'}</p>
                  {delivery?.isProblem && (
                    <p className="text-xs text-red-600 mt-1">{delivery.explanation}</p>
                  )}
                </div>

                {/* Actions */}
                {canManage && (
                  <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                    {invitationByInviteeId[inv.id] && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => copySubmissionLink(inv)}
                        title="Copy submission link"
                      >
                        <Link className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {canResend && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 gap-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        onClick={() => resendInvitation(inv)}
                        disabled={isLoading}
                        title="Resend invitation email"
                      >
                        {actionLoading[inv.id] === 'resending'
                          ? <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          : <RefreshCw className="w-3.5 h-3.5" />
                        }
                        <span className="hidden sm:inline">Resend</span>
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(inv)}
                        disabled={isLoading}
                        title="Remove invitee"
                      >
                        {actionLoading[inv.id] === 'deleting'
                          ? <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                          : <Trash2 className="w-4 h-4" />
                        }
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Issue confirm dialog */}
      <AlertDialog open={showIssueConfirm} onOpenChange={(open) => { if (!issuing) setShowIssueConfirm(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tender.status === 'Issued' ? 'Send to New Invitees?' : 'Issue Tender?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {tender.status === 'Issued'
                ? `Send invitation emails to ${newCount} new invitee${newCount !== 1 ? 's' : ''}?`
                : `Send tender invitation to ${emailableCount} subcontractor${emailableCount !== 1 ? 's' : ''} with email addresses? This will set the tender status to Issued.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {issuing && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-sm text-blue-800 dark:text-blue-200">Sending invitations… do not close this window.</p>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <AlertDialogCancel disabled={issuing}>Cancel</AlertDialogCancel>
            <Button onClick={issueTender} disabled={issuing}>
              {issuing ? 'Sending…' : tender.status === 'Issued' ? 'Send Invitations' : 'Issue Tender'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete invitee confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove invitee?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{deleteTarget?.full_name}</strong> from this tender? Their invitation will be revoked and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { handleDeleteInvitee(deleteTarget); setDeleteTarget(null); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive confirmation dialog */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Preserve Submission History?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{archiveTarget?.full_name}</strong> has submitted pricing. Historical tender records must be preserved.
              <br /><br />
              This invitee will be archived and hidden from the default view, but their submission data will remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2 mt-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline" className="gap-2" onClick={archiveInvitee}>
              <Archive className="w-4 h-4" /> Archive Invitee
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}