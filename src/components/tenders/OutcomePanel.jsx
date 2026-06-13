/**
 * OutcomePanel
 *
 * Reads submissions from TenderSubmission entity.
 * Saves outcome (Awarded/Unsuccessful) back to TenderSubmission records.
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, CheckCircle2, XCircle, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { resolveTemplate, applyTemplate, buildEmailHtml } from '@/lib/emailTemplates';

export default function OutcomePanel({ tender, onUpdate, onConvert, canManage }) {
  const { user }    = useAuth();
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const [ourResult, setOurResult] = useState(tender.our_result || '');
  const [ourNotes, setOurNotes]   = useState(tender.our_result_notes || '');
  const [sending, setSending]     = useState(false);
  const [savingOur, setSavingOur] = useState(false);

  const { data: submissions = [] } = useQuery({
    queryKey: ['tenderSubmissions', tender.id],
    queryFn:  () => base44.entities.TenderSubmission.filter({ tender_id: tender.id }),
    enabled:  !!tender.id,
  });

  // Local outcome state keyed by submission.id — synced from DB whenever submissions refetch
  const [subOutcomes, setSubOutcomes] = useState({});
  const [subNotes, setSubNotes]       = useState({});

  useEffect(() => {
    if (!submissions.length) return;
    setSubOutcomes(prev => {
      const m = {};
      submissions.forEach(s => { m[s.id] = prev[s.id] ?? s.outcome ?? ''; });
      return m;
    });
    setSubNotes(prev => {
      const m = {};
      submissions.forEach(s => { m[s.id] = prev[s.id] ?? s.outcome_notes ?? ''; });
      return m;
    });
  }, [submissions]);

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn:  () => base44.entities.EmailTemplate.list(),
  });
  const { data: emailBranding = {} } = useQuery({
    queryKey: ['emailBranding'],
    queryFn:  () => base44.entities.EmailBranding.list().then(r => r[0] ?? {}),
  });

  const saveOurResult = async () => {
    setSavingOur(true);
    await onUpdate({ our_result: ourResult, our_result_notes: ourNotes });
    queryClient.invalidateQueries({ queryKey: ['tender', tender.id] });
    queryClient.invalidateQueries({ queryKey: ['tenders'] });
    setSavingOur(false);
    toast({ title: 'Result saved' });
  };

  const notifyWeUnsuccessful = async () => {
    setSending(true);
    const tpl = resolveTemplate(emailTemplates, 'tender_outcome_unsuccessful');
    let sent = 0, failed = 0;
    for (const sub of submissions) {
      if (!sub.invitee_email) continue;
      try {
        const { subject, body } = applyTemplate(tpl, {
          tender_number: tender.tender_number || '',
          title:         tender.title || '',
          invitee_name:  sub.invitee_name || '',
          sender_name:   user?.full_name || '',
          company_name:  emailBranding?.company_name || 'ConstructIQ',
        });
        const htmlBody = buildEmailHtml(body, emailBranding);
        await base44.functions.invoke('sendEmail', { to: sub.invitee_email, toName: sub.invitee_name || '', subject, htmlBody });
        sent++;
      } catch (e) { failed++; console.error('Outcome email failed', sub.invitee_email, e); }
    }
    toast({
      title: sent > 0 ? `Notified ${sent} subcontractor${sent !== 1 ? 's' : ''}` : 'No emails sent',
      description: failed > 0 ? `${failed} failed` : undefined,
      variant: sent === 0 ? 'destructive' : 'default',
    });
    setSending(false);
  };

  const sendAllOutcomeNotifications = async () => {
    setSending(true);
    let sent = 0, failed = 0;
    const notifiedAt = new Date().toISOString();

    for (const sub of submissions) {
      if (!sub.invitee_email) continue;
      const outcome  = subOutcomes[sub.id];
      const tplKey   = outcome === 'Awarded' ? 'tender_sub_awarded' : 'tender_sub_unsuccessful';
      const tpl      = resolveTemplate(emailTemplates, tplKey);
      try {
        const { subject, body } = applyTemplate(tpl, {
          tender_number: tender.tender_number || '',
          title:         tender.title || '',
          invitee_name:  sub.invitee_name || '',
          sender_name:   user?.full_name || '',
          company_name:  emailBranding?.company_name || 'ConstructIQ',
        });
        const htmlBody = buildEmailHtml(body, emailBranding);
        await base44.functions.invoke('sendEmail', { to: sub.invitee_email, toName: sub.invitee_name || '', subject, htmlBody });
        // Save outcome to submission record
        await base44.entities.TenderSubmission.update(sub.id, {
          outcome:              outcome || '',
          outcome_notes:        subNotes[sub.id] || '',
          outcome_notified_at:  notifiedAt,
        });
        sent++;
      } catch (e) { failed++; console.error('Outcome email failed', sub.invitee_email, e); }
    }

    queryClient.invalidateQueries({ queryKey: ['tenderSubmissions', tender.id] });

    const anyAwarded = Object.values(subOutcomes).some(o => o === 'Awarded');
    await onUpdate({
      status:     anyAwarded ? 'Awarded' : 'Unsuccessful',
      award_date: anyAwarded ? new Date().toISOString().split('T')[0] : tender.award_date,
    });

    toast({
      title: sent > 0 ? `Notifications sent to ${sent} subcontractor${sent !== 1 ? 's' : ''}` : 'No emails sent',
      description: failed > 0 ? `${failed} failed` : undefined,
      variant: sent === 0 ? 'destructive' : 'default',
    });
    setSending(false);
  };

  const sendSingleNotification = async (sub) => {
    if (!sub.invitee_email) { toast({ title: 'No email address', variant: 'destructive' }); return; }
    const outcome = subOutcomes[sub.id];
    const tpl     = resolveTemplate(emailTemplates, outcome === 'Awarded' ? 'tender_sub_awarded' : 'tender_sub_unsuccessful');
    try {
      const { subject, body } = applyTemplate(tpl, {
        tender_number: tender.tender_number || '',
        title:         tender.title || '',
        invitee_name:  sub.invitee_name || '',
        sender_name:   user?.full_name || '',
        company_name:  emailBranding?.company_name || 'ConstructIQ',
      });
      const htmlBody = buildEmailHtml(body, emailBranding);
      await base44.functions.invoke('sendEmail', { to: sub.invitee_email, toName: sub.invitee_name || '', subject, htmlBody });
      await base44.entities.TenderSubmission.update(sub.id, {
        outcome:             outcome || '',
        outcome_notes:       subNotes[sub.id] || '',
        outcome_notified_at: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['tenderSubmissions', tender.id] });
      toast({ title: `Notification sent to ${sub.invitee_name}` });
    } catch (_e) {
      toast({ title: 'Failed to send notification', variant: 'destructive' });
    }
  };

  // Header info: award date, linked project, status
  const headerItems = [
    tender.status && { label: 'Tender Status', value: tender.status },
    tender.award_date && { label: 'Award Date', value: format(new Date(tender.award_date), 'dd MMM yyyy') },
    tender.converted_project_id && { label: 'Linked Project', isLink: true, to: `/projects/${tender.converted_project_id}`, value: 'Open Project →' },
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Header info strip */}
      {headerItems.length > 0 && (
        <div className="flex flex-wrap gap-4 p-3 bg-muted/40 rounded-lg border text-xs">
          {headerItems.map(item => (
            <div key={item.label}>
              <span className="text-muted-foreground font-medium">{item.label}: </span>
              {item.isLink ? (
                <Link to={item.to} className="text-primary hover:underline inline-flex items-center gap-1">
                  <FolderOpen className="w-3 h-3" /> {item.value}
                </Link>
              ) : (
                <span className="font-semibold">{item.value}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Our result */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Our Tender Result</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <button onClick={() => setOurResult('awarded')}
              className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition-all ${ourResult === 'awarded' ? 'border-green-500 bg-green-50 text-green-700' : 'border-border hover:border-border/80'}`}>
              <CheckCircle2 className="w-4 h-4" /> We were awarded this tender
            </button>
            <button onClick={() => setOurResult('unsuccessful')}
              className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition-all ${ourResult === 'unsuccessful' ? 'border-red-500 bg-red-50 text-red-700' : 'border-border hover:border-border/80'}`}>
              <XCircle className="w-4 h-4" /> We were unsuccessful
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
              {ourResult === 'unsuccessful' && submissions.length > 0 && (
                <Button onClick={notifyWeUnsuccessful} disabled={sending} variant="outline" size="sm" className="gap-2">
                  <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Notify subcontractors'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subcontractor results — grouped by trade */}
      {(tender.our_result || ourResult) && submissions.length > 0 && (() => {
        const grouped = submissions.reduce((acc, s) => {
          const trade = s.trade || 'Unspecified';
          if (!acc[trade]) acc[trade] = [];
          acc[trade].push(s);
          return acc;
        }, {});
        return (
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
            <CardContent className="space-y-5">
              {Object.entries(grouped).map(([trade, subs]) => (
                <div key={trade}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{trade}</p>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 border-b text-muted-foreground">
                          <th className="text-left px-3 py-2 font-medium">Business Name</th>
                          <th className="text-left px-3 py-2 font-medium">Contact</th>
                          <th className="text-right px-3 py-2 font-medium">Submitted Price</th>
                          <th className="text-center px-3 py-2 font-medium">Outcome</th>
                          {canManage && <th className="px-3 py-2 font-medium">Notes / Notify</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {subs.map(sub => (
                          <tr key={sub.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2">
                              <p className="font-medium">{sub.business_name || '—'}</p>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {sub.invitee_name || sub.full_name || '—'}
                              {sub.outcome_notified_at && <span className="ml-1 text-green-600">✓</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {sub.lump_sum_price
                                ? `$${Number(sub.lump_sum_price).toLocaleString('en-NZ')}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex justify-center gap-1">
                                <button onClick={() => canManage && setSubOutcomes(r => ({ ...r, [sub.id]: 'Awarded' }))}
                                  className={`px-2 py-1 rounded text-xs font-medium border transition-all ${subOutcomes[sub.id] === 'Awarded' ? 'bg-green-100 text-green-700 border-green-400' : 'border-border hover:bg-muted'} ${!canManage ? 'cursor-default' : ''}`}>
                                  Awarded
                                </button>
                                <button onClick={() => canManage && setSubOutcomes(r => ({ ...r, [sub.id]: 'Unsuccessful' }))}
                                  className={`px-2 py-1 rounded text-xs font-medium border transition-all ${subOutcomes[sub.id] === 'Unsuccessful' ? 'bg-red-100 text-red-700 border-red-400' : 'border-border hover:bg-muted'} ${!canManage ? 'cursor-default' : ''}`}>
                                  Unsuccessful
                                </button>
                              </div>
                            </td>
                            {canManage && (
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <Textarea value={subNotes[sub.id] || ''} onChange={e => setSubNotes(n => ({ ...n, [sub.id]: e.target.value }))}
                                    placeholder="Notes..." className="h-8 text-xs min-h-0 py-1 flex-1" />
                                  <Button variant="outline" size="sm" className="gap-1 h-7 text-xs flex-shrink-0"
                                    onClick={() => sendSingleNotification(sub)}>
                                    <Send className="w-3 h-3" />
                                  </Button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}