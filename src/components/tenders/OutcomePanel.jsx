import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { resolveTemplate, applyTemplate } from '@/lib/emailTemplates';
import { useQuery } from '@tanstack/react-query';

export default function OutcomePanel({ tender, onUpdate, onConvert, canManage }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [ourResult, setOurResult] = useState(tender.our_result || '');
  const [ourNotes, setOurNotes] = useState(tender.our_result_notes || '');
  const [subResults, setSubResults] = useState(() => {
    const m = {};
    (tender.invitees || []).forEach(inv => { m[inv.id] = inv.status || ''; });
    return m;
  });
  const [subNotes, setSubNotes] = useState(() => {
    const m = {};
    (tender.invitees || []).forEach(inv => { m[inv.id] = inv.outcome_notes || ''; });
    return m;
  });
  const [sending, setSending] = useState(false);
  const [savingOur, setSavingOur] = useState(false);

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => base44.entities.EmailTemplate.list(),
  });

  const submitted = (tender.invitees || []).filter(i => i.submission?.submitted_at);

  const saveOurResult = async () => {
    setSavingOur(true);
    await onUpdate({ our_result: ourResult, our_result_notes: ourNotes });
    setSavingOur(false);
    toast({ title: 'Result saved' });
  };

  const notifyWeUnsuccessful = async () => {
    setSending(true);
    const tpl = resolveTemplate(emailTemplates, 'tender_outcome_unsuccessful');
    let sent = 0;
    for (const inv of submitted) {
      if (!inv.email) continue;
      try {
        const { subject, body } = applyTemplate(tpl, {
          tender_number: tender.tender_number || '',
          title: tender.title || '',
          invitee_name: inv.full_name || '',
          sender_name: user?.full_name || '',
          company_name: user?.company_name || 'ConstructIQ',
        });
        await base44.integrations.Core.SendEmail({ to: inv.email, subject, body });
        sent++;
      } catch (_e) {}
    }
    toast({ title: `Notified ${sent} subcontractor${sent !== 1 ? 's' : ''}` });
    setSending(false);
  };

  const sendAllOutcomeNotifications = async () => {
    setSending(true);
    // Update invitee statuses & notes
    const updatedInvitees = (tender.invitees || []).map(inv => ({
      ...inv,
      status: subResults[inv.id] || inv.status,
      outcome_notes: subNotes[inv.id] || inv.outcome_notes,
      outcome_notified_at: submitted.some(s => s.id === inv.id) ? new Date().toISOString() : inv.outcome_notified_at,
    }));

    let sent = 0;
    for (const inv of submitted) {
      if (!inv.email) continue;
      const result = subResults[inv.id];
      const tplKey = result === 'Awarded' ? 'tender_sub_awarded' : 'tender_sub_unsuccessful';
      const tpl = resolveTemplate(emailTemplates, tplKey);
      try {
        const { subject, body } = applyTemplate(tpl, {
          tender_number: tender.tender_number || '',
          title: tender.title || '',
          invitee_name: inv.full_name || '',
          sender_name: user?.full_name || '',
          company_name: user?.company_name || 'ConstructIQ',
        });
        await base44.integrations.Core.SendEmail({ to: inv.email, subject, body });
        sent++;
      } catch (_e) {}
    }

    // Determine overall tender status
    const anyAwarded = Object.values(subResults).some(s => s === 'Awarded');
    const newStatus = anyAwarded ? 'Awarded' : 'Unsuccessful';

    await onUpdate({
      invitees: updatedInvitees,
      status: newStatus,
      award_date: anyAwarded ? new Date().toISOString().split('T')[0] : tender.award_date,
    });

    toast({ title: `Outcome notifications sent to ${sent} subcontractor${sent !== 1 ? 's' : ''}` });
    setSending(false);
  };

  const sendSingleNotification = async (inv) => {
    const result = subResults[inv.id];
    const tplKey = result === 'Awarded' ? 'tender_sub_awarded' : 'tender_sub_unsuccessful';
    const tpl = resolveTemplate(emailTemplates, tplKey);
    if (!inv.email) { toast({ title: 'No email address for this invitee', variant: 'destructive' }); return; }
    try {
      const { subject, body } = applyTemplate(tpl, {
        tender_number: tender.tender_number || '',
        title: tender.title || '',
        invitee_name: inv.full_name || '',
        sender_name: user?.full_name || '',
        company_name: user?.company_name || 'ConstructIQ',
      });
      await base44.integrations.Core.SendEmail({ to: inv.email, subject, body });
      toast({ title: `Notification sent to ${inv.full_name}` });

      // Update notified_at
      const updatedInvitees = (tender.invitees || []).map(i =>
        i.id === inv.id ? { ...i, outcome_notified_at: new Date().toISOString(), status: subResults[inv.id] || i.status } : i
      );
      await onUpdate({ invitees: updatedInvitees });
    } catch (_e) {
      toast({ title: 'Failed to send notification', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Our result */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Our Tender Result</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <button
              onClick={() => setOurResult('awarded')}
              className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition-all ${ourResult === 'awarded' ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' : 'border-border hover:border-border/80'}`}
            >
              <CheckCircle2 className="w-4 h-4" />
              We were awarded this tender
            </button>
            <button
              onClick={() => setOurResult('unsuccessful')}
              className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition-all ${ourResult === 'unsuccessful' ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400' : 'border-border hover:border-border/80'}`}
            >
              <XCircle className="w-4 h-4" />
              We were unsuccessful
            </button>
          </div>
          {ourResult === 'unsuccessful' && (
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={ourNotes} onChange={e => setOurNotes(e.target.value)} rows={2} placeholder="Reason or comments..." />
            </div>
          )}
          {canManage && ourResult && (
            <div className="flex gap-2">
              <Button onClick={saveOurResult} disabled={savingOur} size="sm">
                {savingOur ? 'Saving...' : 'Save Result'}
              </Button>
              {ourResult === 'awarded' && (
                <Button onClick={onConvert} variant="outline" size="sm" className="gap-2 border-green-500 text-green-700 hover:bg-green-50">
                  <CheckCircle2 className="w-4 h-4" /> Convert to Project
                </Button>
              )}
              {ourResult === 'unsuccessful' && submitted.length > 0 && (
                <Button onClick={notifyWeUnsuccessful} disabled={sending} variant="outline" size="sm" className="gap-2">
                  <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Notify subcontractors'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subcontractor results */}
      {(tender.our_result || ourResult) && submitted.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Subcontractor Results</CardTitle>
              {canManage && (
                <Button onClick={sendAllOutcomeNotifications} disabled={sending} size="sm" className="gap-2">
                  <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send All Notifications'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {submitted.map(inv => (
              <div key={inv.id} className="p-3 border rounded-lg space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="font-medium text-sm">{inv.full_name}</span>
                    {inv.business_name && <span className="text-xs text-muted-foreground ml-2">{inv.business_name}</span>}
                    {inv.submission?.lump_sum_price && (
                      <span className="text-xs text-muted-foreground ml-2">
                        NZD {Number(inv.submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  {inv.outcome_notified_at && (
                    <span className="text-xs text-green-600">Notified ✓</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSubResults(r => ({ ...r, [inv.id]: 'Awarded' }))}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${subResults[inv.id] === 'Awarded' ? 'bg-green-100 text-green-700 border-green-400' : 'border-border hover:bg-muted'}`}
                  >
                    Awarded
                  </button>
                  <button
                    onClick={() => setSubResults(r => ({ ...r, [inv.id]: 'Unsuccessful' }))}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${subResults[inv.id] === 'Unsuccessful' ? 'bg-red-100 text-red-700 border-red-400' : 'border-border hover:bg-muted'}`}
                  >
                    Unsuccessful
                  </button>
                  {canManage && (
                    <Button
                      variant="outline" size="sm" className="ml-auto gap-1 h-7 text-xs"
                      onClick={() => sendSingleNotification(inv)}
                    >
                      <Send className="w-3 h-3" /> Send
                    </Button>
                  )}
                </div>
                <Textarea
                  value={subNotes[inv.id] || ''}
                  onChange={e => setSubNotes(n => ({ ...n, [inv.id]: e.target.value }))}
                  placeholder="Optional notes..."
                  className="h-14 text-xs"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}