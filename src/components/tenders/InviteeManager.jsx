/**
 * InviteeManager — Phase 1 refactor
 *
 * SOURCE OF TRUTH: TenderInvitation only.
 * Tender.invitees[] is NOT read or written here.
 * All invitee state is owned by TenderInvitation records.
 */
import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Users, Plus, Trash2, Send, UserCheck, Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection'
];

const STATUS_STYLES = {
  Pending:      'bg-gray-100 text-gray-600',
  Sent:         'bg-blue-100 text-blue-700',
  Viewed:       'bg-cyan-100 text-cyan-700',
  Submitted:    'bg-green-100 text-green-700',
  Cancelled:    'bg-gray-100 text-gray-500',
  // legacy compat
  Invited:      'bg-blue-100 text-blue-700',
  Awarded:      'bg-emerald-100 text-emerald-700',
  Unsuccessful: 'bg-red-100 text-red-700',
};

const emptyForm = { full_name: '', business_name: '', email: '', phone: '', trade: '' };

/** Upsert into TenderContact directory. Non-fatal — logs on failure. */
async function upsertContact(contacts, form, queryClient) {
  if (!form.full_name) return;

  const emailLower = form.email?.toLowerCase();
  let existing = emailLower ? contacts.find(c => c.email?.toLowerCase() === emailLower) : null;
  if (!existing && form.full_name && form.business_name) {
    existing = contacts.find(
      c => c.full_name?.toLowerCase() === form.full_name.toLowerCase() &&
           c.business_name?.toLowerCase() === form.business_name.toLowerCase()
    );
  }

  if (existing) {
    await base44.entities.TenderContact.update(existing.id, {
      full_name:     form.full_name,
      business_name: form.business_name || existing.business_name || '',
      phone:         form.phone         || existing.phone         || '',
      trade:         form.trade         || existing.trade         || '',
    });
    console.log(`[upsertContact] UPDATED id=${existing.id}`);
  } else {
    const result = await base44.entities.TenderContact.create({
      full_name:     form.full_name,
      business_name: form.business_name || '',
      email:         form.email         || '',
      phone:         form.phone         || '',
      trade:         form.trade         || '',
    });
    if (!result?.id) throw new Error('TenderContact create returned no id');
    console.log(`[upsertContact] CREATED id=${result.id}`);
  }
  queryClient.invalidateQueries({ queryKey: ['tenderContacts'] });
}

export default function InviteeManager({ tender, onUpdate, canManage }) {
  const { toast }        = useToast();
  const queryClient      = useQueryClient();

  const [form, setForm]             = useState(emptyForm);
  const [nameSearch, setNameSearch] = useState('');
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const nameDebounce = useRef(null);

  const [showSearch, setShowSearch]     = useState(false);
  const [searchQ, setSearchQ]           = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const searchDebounce = useRef(null);

  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const [issuing, setIssuing]     = useState(false);
  const [adding, setAdding]       = useState(false);

  // ── PRIMARY DATA SOURCE: TenderInvitation ────────────────────────────────
  const { data: invitations = [], refetch: refetchInvitations } = useQuery({
    queryKey: ['tenderInvitations', tender.id],
    queryFn: () => base44.entities.TenderInvitation.filter({ tender_id: tender.id }),
    enabled: !!tender.id,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ['tenderContacts'],
    queryFn: () => base44.entities.TenderContact.list('-created_date', 500).catch(() => []),
  });

  // ── Name autocomplete ─────────────────────────────────────────────────────
  const handleNameInput = (val) => {
    setNameSearch(val);
    setForm(f => ({ ...f, full_name: val }));
    clearTimeout(nameDebounce.current);
    nameDebounce.current = setTimeout(() => {
      if (val.length >= 2) {
        const q = val.toLowerCase();
        setNameSuggestions(
          contacts.filter(c =>
            c.full_name?.toLowerCase().includes(q) ||
            c.business_name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q)
          ).slice(0, 6)
        );
      } else {
        setNameSuggestions([]);
      }
    }, 300);
  };

  const selectSuggestion = (c) => {
    setForm({ full_name: c.full_name || '', business_name: c.business_name || '', email: c.email || '', phone: c.phone || '', trade: c.trade || '' });
    setNameSearch(c.full_name || '');
    setNameSuggestions([]);
  };

  // ── Subcontractor search ──────────────────────────────────────────────────
  const handleSearchInput = (val) => {
    setSearchQ(val);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      if (val.length >= 1) {
        const q = val.toLowerCase();
        setSearchResults(
          contacts.filter(c =>
            c.full_name?.toLowerCase().includes(q) ||
            c.business_name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.trade?.toLowerCase().includes(q)
          ).slice(0, 20)
        );
      } else {
        setSearchResults([]);
      }
    }, 300);
  };

  // ── Core add logic ────────────────────────────────────────────────────────
  const addInviteeCore = async ({ full_name, business_name, email, phone, trade }) => {
    const emailLower = email?.toLowerCase();
    const alreadyAdded = emailLower && invitations.some(i => i.invitee_email?.toLowerCase() === emailLower);
    if (alreadyAdded) {
      toast({ title: 'Already added', description: `${email} is already in the invitee list`, duration: 3000 });
      return false;
    }

    setAdding(true);
    const token = crypto.randomUUID();
    console.log(`[addInvitee] START name=${full_name} email=${email} tender=${tender.id} token=${token}`);

    try {
      // Create TenderInvitation — this is the ONLY write required
      const record = await base44.entities.TenderInvitation.create({
        token,
        tender_id:     tender.id,
        invitee_email: email || '',
        invitee_name:  full_name || '',
        status:        'Pending',
        sent_date:     null,
      });

      if (!record?.id) throw new Error('TenderInvitation create returned no id');
      console.log(`[addInvitee] TenderInvitation CREATED id=${record.id}`);
      await refetchInvitations();
      setAdding(false);
      return true;
    } catch (err) {
      console.error(`[addInvitee] TenderInvitation create FAILED:`, err?.message, err?.stack);
      toast({
        title: 'Failed to add invitee',
        description: err?.message || 'TenderInvitation create failed',
        variant: 'destructive',
        duration: 8000,
      });
      setAdding(false);
      return false;
    }
  };

  const addFromSearch = async (c) => {
    const success = await addInviteeCore({
      full_name: c.full_name, business_name: c.business_name || '',
      email: c.email || '', phone: c.phone || '', trade: c.trade || '',
    });
    if (success) toast({ title: `${c.full_name} added`, duration: 2500 });
  };

  const addInvitee = async () => {
    if (!form.full_name) return;
    const success = await addInviteeCore({
      full_name: form.full_name, business_name: form.business_name || '',
      email: form.email || '', phone: form.phone || '',
      trade: form.trade === 'NONE' ? '' : (form.trade || ''),
    });
    if (success) {
      // Upsert into TenderContact directory (non-fatal)
      try {
        await upsertContact(contacts, form, queryClient);
        toast({ title: `${form.full_name} added`, description: 'Saved to subcontractor database', duration: 2500 });
      } catch (contactErr) {
        console.warn('[addInvitee] TenderContact upsert failed:', contactErr?.message);
        toast({ title: `${form.full_name} added`, description: 'Note: contact directory save failed', duration: 4000 });
      }
      setForm(emptyForm);
      setNameSearch('');
      setNameSuggestions([]);
    }
  };

  // ── Remove invitee ────────────────────────────────────────────────────────
  const removeInvitee = async (inv) => {
    console.log(`[removeInvitee] id=${inv.id} token=${inv.token} email=${inv.invitee_email}`);
    try {
      await base44.entities.TenderInvitation.delete(inv.id);
      console.log(`[removeInvitee] Deleted id=${inv.id}`);
      await refetchInvitations();
    } catch (err) {
      console.error(`[removeInvitee] FAILED id=${inv.id}:`, err?.message);
      toast({ title: 'Remove failed', description: err?.message, variant: 'destructive', duration: 5000 });
    }
  };

  // ── Issue tender ──────────────────────────────────────────────────────────
  const pendingInvitees  = invitations.filter(inv => !inv.status || inv.status === 'Pending');
  const emailableCount   = invitations.filter(i => i.invitee_email).length;
  const newInviteesCount = pendingInvitees.filter(i => i.invitee_email).length;
  const showIssueButton  = canManage && invitations.length > 0 &&
    (tender.status === 'Draft' || (tender.status === 'Issued' && pendingInvitees.length > 0));

  const issueTender = async () => {
    setIssuing(true);
    try {
      // Update tender status first
      try {
        const now = new Date().toISOString();
        await onUpdate({
          status:     'Issued',
          issue_date: tender.issue_date || now.split('T')[0],
        });
      } catch (saveErr) {
        console.error('[issueTender] tender status update failed:', saveErr?.message, saveErr?.stack);
        toast({ title: 'Failed to update tender status', description: saveErr?.message, variant: 'destructive', duration: 8000 });
        return;
      }

      const toEmail = pendingInvitees.filter(inv => inv.invitee_email);
      let sent = 0, failed = 0, sendErrors = [];

      if (toEmail.length > 0) {
        const result = await base44.functions.invoke('sendTenderInvitations', {
          tenderId: tender.id,
          tenderInfo: {
            title:                tender.title,
            tender_number:        tender.tender_number        || '',
            location:             tender.location             || '',
            closing_date:         tender.closing_date         || '',
            description:          tender.description          || '',
            trade_packages:       tender.trade_packages       || [],
            client_name:          tender.client_name          || '',
            architect_name:       tender.architect_name       || '',
            project_manager_name: tender.project_manager_name || '',
          },
          invitees: toEmail.map(inv => ({
            id:        inv.id,
            email:     inv.invitee_email,
            full_name: inv.invitee_name,
            token:     inv.token,
          })),
          appUrl: window.location.origin,
        });
        sent       = result.data?.sent   ?? 0;
        failed     = result.data?.failed ?? 0;
        sendErrors = result.data?.errors ?? [];
        if (sendErrors.length > 0) console.error('[issueTender] partial failures:', sendErrors);
      }

      await refetchInvitations();

      if (toEmail.length === 0) {
        toast({ title: 'Tender status updated', description: 'No pending invitees to email', duration: 4000 });
      } else if (sent > 0 && failed === 0) {
        toast({ title: `Tender issued — ${sent} invitation${sent !== 1 ? 's' : ''} sent`, duration: 5000 });
      } else if (sent > 0) {
        toast({ title: `${sent} sent, ${failed} failed`, description: sendErrors.slice(0, 3).join('; '), variant: 'destructive', duration: 10000 });
      } else {
        toast({ title: 'No invitations sent', description: sendErrors.slice(0, 3).join('; ') || 'Check invitees have valid emails', variant: 'destructive', duration: 10000 });
      }
    } catch (err) {
      console.error('[issueTender] FATAL:', err?.message, err?.stack);
      toast({ title: 'Issue Tender Failed', description: err?.message, variant: 'destructive', duration: 10000 });
    } finally {
      setIssuing(false);
      setShowIssueConfirm(false);
    }
  };

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
                ? `${pendingInvitees.length} new invitee${pendingInvitees.length !== 1 ? 's' : ''} will receive an invitation email`
                : `${invitations.length} invitee${invitations.length !== 1 ? 's' : ''} · ${emailableCount} with email addresses`}
            </p>
          </div>
          <Button onClick={() => setShowIssueConfirm(true)} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Send className="w-4 h-4" /> {tender.status === 'Issued' ? 'Send to New' : 'Issue Tender'}
          </Button>
        </div>
      )}

      {canManage && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant={!showSearch ? 'default' : 'outline'} size="sm" className="gap-2" onClick={() => setShowSearch(false)}>
              <Plus className="w-4 h-4" /> Add New
            </Button>
            <Button variant={showSearch ? 'default' : 'outline'} size="sm" className="gap-2"
              onClick={() => { setShowSearch(true); setSearchQ(''); setSearchResults([]); }}>
              <Search className="w-4 h-4" /> Add from Database ({contacts.length})
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
                    const added = invitations.some(i => i.invitee_email?.toLowerCase() === c.email?.toLowerCase());
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
                <div className="relative sm:col-span-2">
                  <Label className="text-xs">Full Name *</Label>
                  <Input value={nameSearch} onChange={e => handleNameInput(e.target.value)}
                    placeholder="Search contacts or enter name…" autoComplete="off" />
                  {nameSuggestions.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg max-h-44 overflow-y-auto">
                      {nameSuggestions.map(c => (
                        <button key={c.id} type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
                          onClick={() => selectSuggestion(c)}>
                          <UserCheck className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                          <span className="font-medium">{c.full_name}</span>
                          {c.business_name && <span className="text-muted-foreground text-xs">{c.business_name}</span>}
                          {c.email && <span className="text-muted-foreground text-xs ml-auto">{c.email}</span>}
                        </button>
                      ))}
                    </div>
                  )}
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
              <p className="text-xs text-muted-foreground">Contact will be saved to the subcontractor database.</p>
              <Button onClick={addInvitee} disabled={!form.full_name || adding} className="gap-2" size="sm">
                <Plus className="w-4 h-4" /> {adding ? 'Adding…' : 'Add Invitee'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Invitee list — sourced entirely from TenderInvitation */}
      {invitations.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No invitees added yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{invitations.length} Invitee{invitations.length !== 1 ? 's' : ''}</p>
          {invitations.map(inv => (
            <div key={inv.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{inv.invitee_name || '—'}</span>
                  {inv.status && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                      {inv.status}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {inv.invitee_email || 'No email'}
                  {inv.sent_date && <span className="ml-2 opacity-60">Sent {new Date(inv.sent_date).toLocaleDateString()}</span>}
                </div>
              </div>
              {canManage && (!inv.status || inv.status === 'Pending' || inv.status === 'Sent') && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                  onClick={() => removeInvitee(inv)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Issue confirm dialog */}
      <AlertDialog open={showIssueConfirm} onOpenChange={(open) => { if (!issuing) setShowIssueConfirm(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tender.status === 'Issued' ? 'Send to New Invitees?' : 'Issue Tender?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {tender.status === 'Issued'
                ? `Send invitation emails to ${newInviteesCount} new invitee${newInviteesCount !== 1 ? 's' : ''}? Previously invited subcontractors will not receive another email.`
                : `Send tender invitation to ${emailableCount} subcontractor${emailableCount !== 1 ? 's' : ''} with email addresses? This will set the tender status to Issued.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2 mt-2">
            <AlertDialogCancel disabled={issuing}>Cancel</AlertDialogCancel>
            <Button onClick={issueTender} disabled={issuing} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {issuing ? 'Sending…' : tender.status === 'Issued' ? 'Send Invitations' : 'Issue Tender'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}