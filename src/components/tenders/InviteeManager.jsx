import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Users, Plus, Trash2, Send, UserCheck } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
// Email sending is handled by the sendTenderInvitations backend function (supports external recipients)
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

const emptyInvitee = { full_name: '', business_name: '', email: '', phone: '', trade: '' };

export default function InviteeManager({ tender, onUpdate, canManage }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyInvitee);
  const [saveToDirectory, setSaveToDirectory] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const { data: contacts = [] } = useQuery({
    queryKey: ['tenderContacts'],
    queryFn: () => base44.entities.TenderContact.list('-created_date', 200),
  });


  const invitees = tender.invitees || [];

  const handleSearch = (val) => {
    setSearchQ(val);
    setForm(f => ({ ...f, full_name: val }));
    if (val.length >= 2) {
      const q = val.toLowerCase();
      const matches = contacts.filter(c =>
        c.full_name?.toLowerCase().includes(q) ||
        c.business_name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
      ).slice(0, 5);
      setSuggestions(matches);
    } else {
      setSuggestions([]);
    }
  };

  const selectSuggestion = (c) => {
    setForm({ full_name: c.full_name || '', business_name: c.business_name || '', email: c.email || '', phone: c.phone || '', trade: c.trade || '' });
    setSearchQ(c.full_name || '');
    setSuggestions([]);
  };

  const addInvitee = async () => {
    if (!form.full_name) return;
    const newInvitee = { ...form, id: uuidv4(), token: uuidv4(), status: 'Pending', invited_at: null, submission: null };
    await onUpdate({ invitees: [...invitees, newInvitee] });

    if (saveToDirectory && form.full_name) {
      const existing = contacts.find(c => c.email?.toLowerCase() === form.email?.toLowerCase());
      if (!existing) {
        try {
          await base44.entities.TenderContact.create({
            full_name: form.full_name,
            business_name: form.business_name,
            email: form.email,
            phone: form.phone,
            trade: form.trade,
          });
          queryClient.invalidateQueries({ queryKey: ['tenderContacts'] });
        } catch (_err) {
          // Saving to contacts directory is optional — invitee was already added above
        }
      }
    }

    setForm(emptyInvitee);
    setSearchQ('');
    setSuggestions([]);
  };

  const removeInvitee = async (id) => {
    await onUpdate({ invitees: invitees.filter(i => i.id !== id) });
  };

  // Only email invitees that haven't been invited yet (Pending status), or all if re-issuing to new ones
  const pendingInvitees = invitees.filter(inv => !inv.invited_at || inv.status === 'Pending');

  const issueTender = async () => {
    setIssuing(true);
    try {
      // Step 1 — Assign tokens; only update status for pending/uninvited ones
      const updatedInvitees = invitees.map(inv => {
        const isPending = !inv.invited_at || inv.status === 'Pending';
        return {
          ...inv,
          token: inv.token || uuidv4(),
          status: isPending ? 'Invited' : inv.status,
          invited_at: isPending ? new Date().toISOString() : inv.invited_at,
        };
      });

      // Step 2 — Save to DB first (separate try so email loop still runs if save succeeds)
      try {
        await onUpdate({
          invitees: updatedInvitees,
          status: 'Issued',
          issue_date: tender.issue_date || new Date().toISOString().split('T')[0],
        });
      } catch (saveErr) {
        toast({
          title: 'Failed to save tender — emails not sent',
          description: saveErr?.message,
          variant: 'destructive',
          duration: 8000,
        });
        return;
      }

      // Step 3 — Send emails only to newly invited invitees via backend (supports external recipients)
      const toEmail = updatedInvitees.filter(inv => {
        const original = invitees.find(i => i.id === inv.id);
        const wasPending = !original?.invited_at || original?.status === 'Pending';
        return inv.email && wasPending;
      });

      let sent = 0;
      let failed = 0;

      if (toEmail.length > 0) {
        const result = await base44.functions.invoke('sendTenderInvitations', {
          tenderId: tender.id,
          inviteeIds: toEmail.map(i => i.id),
          appUrl: window.location.origin,
        });
        sent = result.data?.sent ?? 0;
        failed = result.data?.failed ?? 0;
      }

      if (sent > 0) {
        toast({
          title: `Tender issued — ${sent} email${sent !== 1 ? 's' : ''} sent`,
          description: failed > 0 ? `${failed} failed to send — check console for details` : undefined,
          duration: 5000,
        });
      } else if (toEmail.length === 0) {
        toast({ title: 'Tender status updated', description: 'No new invitees to email', duration: 4000 });
      } else {
        toast({
          title: 'Tender saved but no emails were sent',
          description: 'Check that invitees have valid email addresses',
          variant: 'destructive',
          duration: 8000,
        });
      }
    } finally {
      setIssuing(false);
      setShowIssueConfirm(false);
    }
  };

  const emailableInvitees = invitees.filter(i => i.email);
  const newInviteesCount = pendingInvitees.filter(i => i.email).length;
  // Show issue button for Draft, or re-issue button for Issued when there are pending invitees
  const showIssueButton = canManage && invitees.length > 0 &&
    (tender.status === 'Draft' || (tender.status === 'Issued' && pendingInvitees.length > 0));

  return (
    <div className="space-y-6">
      {/* Issue / Re-issue Tender button */}
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

      {/* Add Invitee form */}
      {canManage && (
        <div className="border rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> Add Invitee</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative sm:col-span-2">
              <Label className="text-xs">Full Name * (search contacts)</Label>
              <Input
                value={searchQ}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search contacts or enter name..."
                autoComplete="off"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {suggestions.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
                      onClick={() => selectSuggestion(c)}
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
              <Select value={form.trade} onValueChange={v => setForm(f => ({ ...f, trade: v }))}>
                <SelectTrigger><SelectValue placeholder="Select trade" /></SelectTrigger>
                <SelectContent>
                  {TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={saveToDirectory} onCheckedChange={setSaveToDirectory} id="save-dir" />
            <Label htmlFor="save-dir" className="text-xs font-normal cursor-pointer">Save to contacts directory</Label>
          </div>
          <Button onClick={addInvitee} disabled={!form.full_name} className="gap-2" size="sm">
            <Plus className="w-4 h-4" /> Add Invitee
          </Button>
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
              {canManage && (!inv.status || inv.status === 'Invited') && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0" onClick={() => removeInvitee(inv.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Issue confirm */}
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
            <Button
              onClick={issueTender}
              disabled={issuing}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {issuing ? 'Sending...' : tender.status === 'Issued' ? 'Send Invitations' : 'Issue Tender'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}