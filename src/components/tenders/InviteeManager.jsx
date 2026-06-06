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

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection'
];

const STATUS_STYLES = {
  Invited:      'bg-blue-100 text-blue-700',
  Viewed:       'bg-cyan-100 text-cyan-700',
  Submitted:    'bg-green-100 text-green-700',
  Awarded:      'bg-emerald-100 text-emerald-700',
  Unsuccessful: 'bg-red-100 text-red-700',
  Withdrawn:    'bg-gray-100 text-gray-600',
};

const emptyForm = { full_name: '', business_name: '', email: '', phone: '', trade: undefined };

// Upsert a contact into TenderContact directory
async function upsertContact(contacts, form, queryClient) {
  if (!form.full_name) return;
  const existing = contacts.find(c => c.email?.toLowerCase() === form.email?.toLowerCase() && form.email);
  try {
    if (existing) {
      await base44.entities.TenderContact.update(existing.id, {
        full_name:     form.full_name,
        business_name: form.business_name || existing.business_name,
        phone:         form.phone         || existing.phone,
        trade:         form.trade         || existing.trade || '',
      });
    } else {
      await base44.entities.TenderContact.create({
        full_name:     form.full_name,
        business_name: form.business_name,
        email:         form.email,
        phone:         form.phone,
        trade:         form.trade || '',
      });
    }
    queryClient.invalidateQueries({ queryKey: ['tenderContacts'] });
  } catch (_err) {
    // Directory save is non-blocking
  }
}

export default function InviteeManager({ tender, onUpdate, canManage }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Manual add form
  const [form, setForm] = useState(emptyForm);
  const [nameSearch, setNameSearch] = useState('');
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const nameDebounce = useRef(null);

  // Existing subcontractor search panel
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const searchDebounce = useRef(null);

  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const { data: contacts = [] } = useQuery({
    queryKey: ['tenderContacts'],
    queryFn: () => base44.entities.TenderContact.list('-created_date', 500),
  });

  const invitees = tender.invitees || [];

  // ── Name field autocomplete ──────────────────────────────────────────────
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

  const selectNameSuggestion = (c) => {
    setForm({ full_name: c.full_name || '', business_name: c.business_name || '', email: c.email || '', phone: c.phone || '', trade: c.trade || undefined });
    setNameSearch(c.full_name || '');
    setNameSuggestions([]);
  };

  // ── Existing subcontractor search ────────────────────────────────────────
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

  const addFromSearch = async (c) => {
    const alreadyAdded = invitees.some(i => i.email?.toLowerCase() === c.email?.toLowerCase());
    if (alreadyAdded) {
      toast({ title: 'Already added', description: `${c.full_name} is already in the invitee list`, duration: 3000 });
      return;
    }
    const newInvitee = {
      full_name:     c.full_name,
      business_name: c.business_name || '',
      email:         c.email,
      phone:         c.phone || '',
      trade:         c.trade || '',
      id:            uuidv4(),
      token:         uuidv4(),
      status:        'Pending',
      invited_at:    null,
      submission:    null,
    };
    await onUpdate({ invitees: [...invitees, newInvitee] });
    toast({ title: `${c.full_name} added`, duration: 2500 });
  };

  // ── Add manually ─────────────────────────────────────────────────────────
  const addInvitee = async () => {
    if (!form.full_name) return;
    const alreadyAdded = form.email && invitees.some(i => i.email?.toLowerCase() === form.email?.toLowerCase());
    if (alreadyAdded) {
      toast({ title: 'Already added', description: `${form.email} is already in the invitee list`, duration: 3000 });
      return;
    }
    const newInvitee = { ...form, trade: form.trade === '__none__' ? '' : (form.trade || ''), id: uuidv4(), token: uuidv4(), status: 'Pending', invited_at: null, submission: null };
    await onUpdate({ invitees: [...invitees, newInvitee] });
    // Only upsert into TenderContact directory if user has permission
    if (user?.role === 'admin' || user?.role === 'pricing') {
      await upsertContact(contacts, form, queryClient);
    }
    setForm(emptyForm);
    setNameSearch('');
    setNameSuggestions([]);
  };

  // ── Remove invitee ───────────────────────────────────────────────────────
  const removeInvitee = async (id) => {
    await onUpdate({ invitees: invitees.filter(i => i.id !== id) });
  };

  // ── Issue tender ─────────────────────────────────────────────────────────
  const pendingInvitees = invitees.filter(inv => !inv.invited_at || inv.status === 'Pending');

  const issueTender = async () => {
    setIssuing(true);
    try {
      const updatedInvitees = invitees.map(inv => {
        const isPending = !inv.invited_at || inv.status === 'Pending';
        return {
          ...inv,
          token:      inv.token || uuidv4(),
          status:     isPending ? 'Invited' : inv.status,
          invited_at: isPending ? new Date().toISOString() : inv.invited_at,
        };
      });

      try {
        await onUpdate({
          invitees:   updatedInvitees,
          status:     'Issued',
          issue_date: tender.issue_date || new Date().toISOString().split('T')[0],
        });
      } catch (saveErr) {
        toast({ title: 'Failed to save tender — emails not sent', description: saveErr?.message, variant: 'destructive', duration: 8000 });
        return;
      }

      const toEmail = updatedInvitees.filter(inv => {
        const original = invitees.find(i => i.id === inv.id);
        const wasPending = !original?.invited_at || original?.status === 'Pending';
        return inv.email && wasPending;
      });

      let sent = 0;
      let failed = 0;

      if (toEmail.length > 0) {
        try {
          const result = await base44.functions.invoke('sendTenderInvitations', {
            tenderId:   tender.id,
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
              email:     inv.email,
              full_name: inv.full_name,
              token:     inv.token,
            })),
            appUrl: window.location.origin,
          });
          sent   = result.data?.sent   ?? 0;
          failed = result.data?.failed ?? 0;
          if (result.data?.errors?.length > 0) console.warn('partial failures:', result.data.errors);
        } catch (emailErr) {
          console.error('Failed to call sendTenderInvitations:', emailErr);
          failed = toEmail.length;
        }
      }

      if (sent > 0) {
        toast({
          title: `Tender issued — ${sent} email${sent !== 1 ? 's' : ''} sent`,
          description: failed > 0 ? `${failed} failed to send` : undefined,
          duration: 5000,
        });
      } else if (toEmail.length === 0) {
        toast({ title: 'Tender status updated', description: 'No new invitees to email', duration: 4000 });
      } else {
        toast({ title: 'Tender saved but no emails were sent', description: 'Check invitees have valid email addresses', variant: 'destructive', duration: 8000 });
      }
    } finally {
      setIssuing(false);
      setShowIssueConfirm(false);
    }
  };

  const emailableInvitees = invitees.filter(i => i.email);
  const newInviteesCount = pendingInvitees.filter(i => i.email).length;
  const showIssueButton = canManage && invitees.length > 0 &&
    (tender.status === 'Draft' || (tender.status === 'Issued' && pendingInvitees.length > 0));

  return (
    <div className="space-y-6">
      {/* Issue / Re-issue button */}
      {showIssueButton && (
        <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {tender.status === 'Issued' ? 'New invitees to send' : 'Ready to issue?'}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {tender.status === 'Issued'
                ? `${pendingInvitees.length} new invitee${pendingInvitees.length !== 1 ? 's' : ''} will receive an invitation email`
                : `${invitees.length} invitee${invitees.length !== 1 ? 's' : ''} added · ${emailableInvitees.length} with email addresses`}
            </p>
          </div>
          <Button onClick={() => setShowIssueConfirm(true)} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Send className="w-4 h-4" /> {tender.status === 'Issued' ? 'Send to New' : 'Issue Tender'}
          </Button>
        </div>
      )}

      {canManage && (
        <div className="space-y-3">
          {/* Toggle buttons */}
          <div className="flex gap-2">
            <Button
              variant={!showSearch ? 'default' : 'outline'}
              size="sm"
              className="gap-2"
              onClick={() => setShowSearch(false)}
            >
              <Plus className="w-4 h-4" /> Add New
            </Button>
            <Button
              variant={showSearch ? 'default' : 'outline'}
              size="sm"
              className="gap-2"
              onClick={() => { setShowSearch(true); setSearchQ(''); setSearchResults([]); }}
            >
              <Search className="w-4 h-4" /> Add from Database ({contacts.length})
            </Button>
          </div>

          {/* ── Add from database panel ── */}
          {showSearch && (
            <div className="border rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-muted-foreground">Search subcontractor database</p>
              <Input
                autoFocus
                value={searchQ}
                onChange={e => handleSearchInput(e.target.value)}
                placeholder="Search by name, business, email or trade…"
              />
              {searchQ.length >= 1 && searchResults.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">No matches found</p>
              )}
              {searchResults.length > 0 && (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {searchResults.map(c => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{c.full_name}</span>
                          {c.business_name && <span className="text-xs text-muted-foreground">{c.business_name}</span>}
                          {c.trade && <span className="text-xs bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">{c.trade}</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{[c.email, c.phone].filter(Boolean).join(' · ')}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-3 flex-shrink-0 gap-1"
                        onClick={() => addFromSearch(c)}
                        disabled={invitees.some(i => i.email?.toLowerCase() === c.email?.toLowerCase())}
                      >
                        {invitees.some(i => i.email?.toLowerCase() === c.email?.toLowerCase())
                          ? 'Added'
                          : <><Plus className="w-3.5 h-3.5" /> Add</>}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {searchQ.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Start typing to search {contacts.length} subcontractor{contacts.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {/* ── Manual add form ── */}
          {!showSearch && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Name with autocomplete */}
                <div className="relative sm:col-span-2">
                  <Label className="text-xs">Full Name *</Label>
                  <Input
                    value={nameSearch}
                    onChange={e => handleNameInput(e.target.value)}
                    placeholder="Search contacts or enter name…"
                    autoComplete="off"
                  />
                  {nameSuggestions.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg max-h-44 overflow-y-auto">
                      {nameSuggestions.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
                          onClick={() => selectNameSuggestion(c)}
                        >
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
                  <Select value={form.trade ?? ''} onValueChange={v => setForm(f => ({ ...f, trade: v === '__none__' ? undefined : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select trade" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— No trade —</SelectItem>
                      {TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {(user?.role === 'admin' || user?.role === 'pricing') ? 'Contact will be saved to the subcontractor database.' : 'Contact will be added to this tender only.'}
              </p>
              <Button onClick={addInvitee} disabled={!form.full_name} className="gap-2" size="sm">
                <Plus className="w-4 h-4" /> Add Invitee
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Invitee list */}
      {invitees.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No invitees added yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{invitees.length} Invitee{invitees.length !== 1 ? 's' : ''}</p>
          {invitees.map(inv => (
            <div key={inv.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{inv.full_name}</span>
                  {inv.business_name && <span className="text-xs text-muted-foreground">{inv.business_name}</span>}
                  {inv.status && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                      {inv.status}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {[inv.trade, inv.email, inv.phone].filter(Boolean).join(' · ')}
                </div>
              </div>
              {canManage && (!inv.status || inv.status === 'Pending' || inv.status === 'Invited') && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0" onClick={() => removeInvitee(inv.id)}>
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
                : `Send tender invitation to ${emailableInvitees.length} subcontractor${emailableInvitees.length !== 1 ? 's' : ''} with email addresses? This will set the tender status to Issued.`}
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