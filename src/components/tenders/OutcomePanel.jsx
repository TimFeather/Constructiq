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
import { Send, CheckCircle2, XCircle, FolderOpen, ExternalLink, Bell, BellOff } from 'lucide-react';
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

  // Fetch converted project name if applicable
  const { data: convertedProject } = useQuery({
    queryKey: ['project', tender.converted_project_id],
    queryFn:  () => base44.entities.Project.filter({ id: tender.converted_project_id }).then(r => r[0] ?? null),
    enabled:  !!tender.converted_project_id,
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
    const tplKey = 'tender_outcome_unsuccessful';
    const tpl = resolveTemplate(emailTemplates, tplKey);
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
        console.log(`[OutcomePanel] notifyWeUnsuccessful to=${sub.invitee_email} subject="${subject}" tpl=${tplKey}`);
        const res = await base44.functions.invoke('sendEmail', { to: sub.invitee_email, toName: sub.invitee_name || '', subject, htmlBody, templateKey: tplKey });
        const resData = res?.data;
        console.log(`[OutcomePanel] sendEmail response:`, JSON.stringify(resData));
        if (resData?.success === true && resData?.id) {
          sent++;
        } else {
          failed++;
          console.error(`[OutcomePanel] sendEmail did not confirm delivery for ${sub.invitee_email}:`, JSON.stringify(resData));
        }
      } catch (e) {
        failed++;
        console.error('[OutcomePanel] notifyWeUnsuccessful exception', sub.invitee_email, e);
      }
    }
    toast({
      title: sent > 0 ? `Notified ${sent} subcontractor${sent !== 1 ? 's' : ''}` : 'No emails sent',
      description: failed > 0 ? `${failed} failed — check console for details` : undefined,
      variant: sent === 0 ? 'destructive' : 'default',
    });
    setSending(false);
  };

  const sendAllOutcomeNotifications = async () => {
    setSending(true);
    let sent = 0, failed = 0;

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
        console.log(`[OutcomePanel] sendAll to=${sub.invitee_email} subject="${subject}" tpl=${tplKey}`);
        const res = await base44.functions.invoke('sendEmail', { to: sub.invitee_email, toName: sub.invitee_name || '', subject, htmlBody, templateKey: tplKey });
        const resData = res?.data;
        console.log(`[OutcomePanel] sendEmail response for ${sub.invitee_email}:`, JSON.stringify(resData));
        if (resData?.success === true && resData?.id) {
          // Only write outcome_notified_at when Resend confirmed delivery with a message ID
          await base44.entities.TenderSubmission.update(sub.id, {
            outcome:             outcome || '',
            outcome_notes:       subNotes[sub.id] || '',
            outcome_notified_at: new Date().toISOString(),
          });
          sent++;
        } else {
          failed++;
          console.error(`[OutcomePanel] sendEmail returned no confirmed ID for ${sub.invitee_email}:`, JSON.stringify(resData));
          toast({ title: `Notification failed for ${sub.invitee_name || sub.invitee_email}`, description: resData?.error || 'Resend did not confirm delivery', variant: 'destructive' });
        }
      } catch (e) {
        failed++;
        console.error('[OutcomePanel] sendAll exception', sub.invitee_email, e);
        toast({ title: `Notification failed for ${sub.invitee_name || sub.invitee_email}`, description: e?.message, variant: 'destructive' });
      }
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
    const tplKey  = outcome === 'Awarded' ? 'tender_sub_awarded' : 'tender_sub_unsuccessful';
    const tpl     = resolveTemplate(emailTemplates, tplKey);
    try {
      const { subject, body } = applyTemplate(tpl, {
        tender_number: tender.tender_number || '',
        title:         tender.title || '',
        invitee_name:  sub.invitee_name || '',
        sender_name:   user?.full_name || '',
        company_name:  emailBranding?.company_name || 'ConstructIQ',
      });
      const htmlBody = buildEmailHtml(body, emailBranding);
      console.log(`[OutcomePanel] sendSingle to=${sub.invitee_email} subject="${subject}" tpl=${tplKey}`);
      const res = await base44.functions.invoke('sendEmail', { to: sub.invitee_email, toName: sub.invitee_name || '', subject, htmlBody, templateKey: tplKey });
      const resData = res?.data;
      console.log(`[OutcomePanel] sendEmail response for ${sub.invitee_email}:`, JSON.stringify(resData));
      if (resData?.success === true && resData?.id) {
        // Only write outcome_notified_at when Resend confirmed delivery with a message ID
        await base44.entities.TenderSubmission.update(sub.id, {
          outcome:             outcome || '',
          outcome_notes:       subNotes[sub.id] || '',
          outcome_notified_at: new Date().toISOString(),
        });
        queryClient.invalidateQueries({ queryKey: ['tenderSubmissions', tender.id] });
        toast({ title: `Notification sent to ${sub.invitee_name}` });
      } else {
        console.error(`[OutcomePanel] sendEmail returned no confirmed ID for ${sub.invitee_email}:`, JSON.stringify(resData));
        toast({ title: 'Notification failed', description: resData?.error || 'Resend did not confirm delivery — outcome not marked as notified', variant: 'destructive' });
      }
    } catch (e) {
      console.error('[OutcomePanel] sendSingle exception', sub.invitee_email, e);
      toast({ title: 'Notification failed', description: e?.message, variant: 'destructive' });
    }
  };

  // Group submissions by trade for Award Summary
  const groupedByTrade = submissions.reduce((acc, s) => {
    const trade = s.trade || 'Unspecified';
    if (!acc[trade]) acc[trade] = [];
    acc[trade].push(s);
    return acc;
  }, {});

  const hasOutcomeData = submissions.some(s => s.outcome);

  return (
    <div className="space-y-6">

      {/* ── Award Summary (permanent record, read from TenderSubmission) ── */}
      {hasOutcomeData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Award Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(groupedByTrade).map(([trade, subs]) => (
              <div key={trade}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{trade}</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 border-b text-muted-foreground">
                        <th className="text-left px-3 py-2 font-medium">Business Name</th>
                        <th className="text-left px-3 py-2 font-medium">Contractor</th>
                        <th className="text-right px-3 py-2 font-medium">Submitted Price</th>
                        <th className="text-center px-3 py-2 font-medium">Outcome</th>
                        <th className="text-center px-3 py-2 font-medium">Award Date</th>
                        <th className="text-center px-3 py-2 font-medium">Notification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {subs.map(sub => (
                        <tr key={sub.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">{sub.business_name || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{sub.invitee_name || sub.full_name || '—'}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {sub.lump_sum_price ? `$${Number(sub.lump_sum_price).toLocaleString('en-NZ')}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {sub.outcome === 'Awarded' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                                <CheckCircle2 className="w-3 h-3" /> Awarded
                              </span>
                            ) : sub.outcome === 'Unsuccessful' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                                <XCircle className="w-3 h-3" /> Unsuccessful
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center text-muted-foreground">
                            {tender.award_date ? format(new Date(tender.award_date), 'dd MMM yyyy') : '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {sub.outcome_notified_at ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                                  <Bell className="w-3 h-3" /> Sent
                                </span>
                                <span className="text-muted-foreground text-[10px]">
                                  {format(new Date(sub.outcome_notified_at), 'dd MMM yyyy HH:mm')}
                                </span>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <BellOff className="w-3 h-3" /> Not Sent
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Project Conversion History ── */}
      {tender.converted_project_id && (
        <Card className="border-green-200 bg-green-50/40">
          <CardContent className="pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Converted to Project</p>
                <p className="text-sm font-medium text-foreground">
                  {convertedProject?.name || 'Project'}
                </p>
                {tender.award_date && (
                  <p className="text-xs text-muted-foreground">
                    Converted on {format(new Date(tender.award_date), 'dd MMM yyyy')}
                  </p>
                )}
              </div>
              <Link to={`/projects/${tender.converted_project_id}`}>
                <Button variant="outline" size="sm" className="gap-2 border-green-500 text-green-700 hover:bg-green-100">
                  <ExternalLink className="w-3 h-3" /> Open Project
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
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

      {/* Subcontractor outcome assignment — only shown when managing and outcomes not yet finalised */}
      {canManage && submissions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Assign & Notify Subcontractors</CardTitle>
              <Button onClick={sendAllOutcomeNotifications} disabled={sending} size="sm" className="gap-2">
                <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send All Notifications'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {Object.entries(groupedByTrade).map(([trade, subs]) => (
              <div key={trade}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{trade}</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 border-b text-muted-foreground">
                        <th className="text-left px-3 py-2 font-medium">Business Name</th>
                        <th className="text-right px-3 py-2 font-medium">Price</th>
                        <th className="text-center px-3 py-2 font-medium">Outcome</th>
                        <th className="px-3 py-2 font-medium">Notes / Notify</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {subs.map(sub => (
                        <tr key={sub.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">
                            {sub.business_name || sub.invitee_name || '—'}
                            {sub.outcome_notified_at && (
                              <span className="ml-2 text-green-600 text-[10px]">✓ Notified</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {sub.lump_sum_price ? `$${Number(sub.lump_sum_price).toLocaleString('en-NZ')}` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-center gap-1">
                              <button onClick={() => setSubOutcomes(r => ({ ...r, [sub.id]: 'Awarded' }))}
                                className={`px-2 py-1 rounded text-xs font-medium border transition-all ${subOutcomes[sub.id] === 'Awarded' ? 'bg-green-100 text-green-700 border-green-400' : 'border-border hover:bg-muted'}`}>
                                Awarded
                              </button>
                              <button onClick={() => setSubOutcomes(r => ({ ...r, [sub.id]: 'Unsuccessful' }))}
                                className={`px-2 py-1 rounded text-xs font-medium border transition-all ${subOutcomes[sub.id] === 'Unsuccessful' ? 'bg-red-100 text-red-700 border-red-400' : 'border-border hover:bg-muted'}`}>
                                Unsuccessful
                              </button>
                            </div>
                          </td>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}