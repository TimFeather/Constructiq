import { invokeFunction } from '@/api/supabaseClient';
/**
 * OutcomePanel
 *
 * Two modes:
 *  - ACTIVE: full workflow — assign outcomes, send notifications server-side, convert.
 *  - LOCKED (read-only audit): tender.status === 'Converted' OR converted_project_id exists.
 *
 * All email sending is delegated to the sendOutcomeNotifications backend function.
 * The frontend never sends individual emails.
 */
import React, { useState, useEffect } from 'react';
import { Project, TenderSubmission } from '@/api/entities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Send, CheckCircle2, XCircle, ExternalLink, Bell, BellOff, Lock, RotateCcw, RefreshCw, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { isAdmin } from '@/lib/permissions';

export default function OutcomePanel({ tender, onUpdate, onConvert, canManage }) {
  const { user }    = useAuth();
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const isLocked = tender.status === 'Converted' || tender.status === 'Archived' || !!tender.converted_project_id;

  const [ourResult, setOurResult] = useState(tender.our_result || '');
  const [ourNotes, setOurNotes]   = useState(tender.our_result_notes || '');
  const [sending, setSending]     = useState(false);
  const [savingOur, setSavingOur] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [lastSendResult, setLastSendResult] = useState(null);

  const { data: submissions = [], refetch: refetchSubmissions } = useQuery({
    queryKey: ['tenderSubmissions', tender.id],
    queryFn:  () => TenderSubmission.filter({ tender_id: tender.id }),
    enabled:  !!tender.id,
  });

  const { data: convertedProject } = useQuery({
    queryKey: ['project', tender.converted_project_id],
    queryFn:  () => Project.filter({ id: tender.converted_project_id }).then(r => r[0] ?? null),
    enabled:  !!tender.converted_project_id,
  });

  // Local outcome/notes state — only used in active mode
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

  // Group submissions by trade
  const groupedByTrade = submissions.reduce((acc, s) => {
    const trade = s.trade || 'Unspecified';
    if (!acc[trade]) acc[trade] = [];
    acc[trade].push(s);
    return acc;
  }, {});

  const failedSubmissions = submissions.filter(s => s.outcome_notification_status === 'Failed');
  const hasFailed = failedSubmissions.length > 0;

  // ── Helpers ───────────────────────────────────────────────────────────────

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tenderSubmissions', tender.id] });
    queryClient.invalidateQueries({ queryKey: ['tender', tender.id] });
    queryClient.invalidateQueries({ queryKey: ['tenders'] });
  };

  // ── Save outcomes to DB before sending ───────────────────────────────────

  const persistOutcomes = async () => {
    const updates = submissions
      .filter(s => subOutcomes[s.id])
      .map(s => TenderSubmission.update(s.id, {
        outcome:       subOutcomes[s.id],
        outcome_notes: subNotes[s.id] || '',
      }));
    await Promise.all(updates);
  };

  // ── Backend-driven send ───────────────────────────────────────────────────

  const sendNotifications = async (retryFailedOnly = false) => {
    setSending(true);
    setLastSendResult(null);
    try {
      if (!retryFailedOnly) {
        await persistOutcomes();
      }
      const res = await invokeFunction('sendOutcomeNotifications', {
        tenderId: tender.id,
        retryFailedOnly,
      });
      const data = res?.data;
      setLastSendResult(data);
      invalidateAll();

      if (data?.success) {
        toast({
          title: data.sent > 0
            ? `${data.sent} notification${data.sent !== 1 ? 's' : ''} sent`
            : 'No notifications sent',
          description: data.failed > 0
            ? `${data.failed} failed — use Retry Failed to resend`
            : undefined,
          variant: data.sent === 0 ? 'destructive' : 'default',
        });
      } else {
        toast({ title: 'Send failed', description: data?.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Send failed', description: e?.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const saveOurResult = async () => {
    setSavingOur(true);
    await onUpdate({ our_result: ourResult, our_result_notes: ourNotes });
    invalidateAll();
    setSavingOur(false);
    toast({ title: 'Result saved' });
  };

  const handleReopen = async () => {
    setReopening(true);
    await onUpdate({ status: 'Awarded', converted_project_id: null });
    invalidateAll();
    setReopening(false);
    toast({ title: 'Tender reopened', description: 'Status reset to Awarded. Converted project link cleared.' });
  };

  const notificationStatus = (sub) => {
    const status = sub.outcome_notification_status;
    if (status === 'Sent') return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="inline-flex items-center gap-1 text-green-600 font-medium text-xs">
          <Bell className="w-3 h-3" /> Sent
        </span>
        {sub.outcome_notified_at && (
          <span className="text-muted-foreground text-[10px]">
            {format(new Date(sub.outcome_notified_at), 'dd MMM yyyy HH:mm')}
          </span>
        )}
      </div>
    );
    if (status === 'Failed') return (
      <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium" title={sub.outcome_notification_error || ''}>
        <AlertTriangle className="w-3 h-3" /> Failed
      </span>
    );
    if (status === 'Pending') return (
      <span className="inline-flex items-center gap-1 text-yellow-600 text-xs">
        <RefreshCw className="w-3 h-3" /> Pending
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <BellOff className="w-3 h-3" /> Not Sent
      </span>
    );
  };

  // ── LOCKED MODE ───────────────────────────────────────────────────────────
  if (isLocked) {
    return (
      <div className="space-y-6">
        {/* Lock banner */}
        <div className="flex items-center gap-2 px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
          <Lock className="w-4 h-4 flex-shrink-0" />
          <span>This tender has been converted to a project. The outcome record is now locked and read-only.</span>
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> Outcome notifications completed
          </span>
          {tender.converted_project_id && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
              <ExternalLink className="w-3.5 h-3.5" /> Project created
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
            <Lock className="w-3.5 h-3.5" /> Outcome workflow locked
          </span>
        </div>

        {/* Linked project */}
        {tender.converted_project_id && (
          <Card className="border-green-200 bg-green-50/40">
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Converted to Project</p>
                  <p className="text-sm font-medium text-foreground">{convertedProject?.name || 'Loading...'}</p>
                  {tender.award_date && (
                    <p className="text-xs text-muted-foreground">
                      Project created on {format(new Date(tender.award_date), 'dd MMM yyyy')}
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

        {/* Our Result (read-only) */}
        {tender.our_result && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Our Tender Result</CardTitle></CardHeader>
            <CardContent>
              <div className={`flex items-center gap-2 p-3 rounded-lg border-2 text-sm font-medium ${
                tender.our_result === 'awarded'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-red-400 bg-red-50 text-red-700'
              }`}>
                {tender.our_result === 'awarded'
                  ? <><CheckCircle2 className="w-4 h-4" /> We were awarded this tender</>
                  : <><XCircle className="w-4 h-4" /> We were unsuccessful</>}
              </div>
              {tender.our_result_notes && (
                <p className="mt-2 text-xs text-muted-foreground border rounded p-2 bg-muted/30">{tender.our_result_notes}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Outcome summary table */}
        {submissions.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Outcome Summary</CardTitle></CardHeader>
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
                          <th className="text-right px-3 py-2 font-medium">Price</th>
                          <th className="text-center px-3 py-2 font-medium">Outcome</th>
                          <th className="text-center px-3 py-2 font-medium">Notification</th>
                          <th className="text-center px-3 py-2 font-medium">Project</th>
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
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center">{notificationStatus(sub)}</td>
                            <td className="px-3 py-2 text-center">
                              {sub.outcome === 'Awarded' && tender.converted_project_id ? (
                                <Link to={`/projects/${tender.converted_project_id}`}
                                  className="inline-flex items-center gap-1 text-primary text-xs hover:underline font-medium">
                                  <ExternalLink className="w-3 h-3" /> View
                                </Link>
                              ) : <span className="text-muted-foreground">—</span>}
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

        {/* Admin: Reopen */}
        {isAdmin(user) && (
          <div className="flex justify-end pt-2 border-t">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-destructive">
                  <RotateCcw className="w-3.5 h-3.5" /> Reopen Tender
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reopen this tender?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will reset the tender status to <strong>Awarded</strong> and unlink the converted project reference.
                    The existing project will <strong>not</strong> be deleted. All historical outcome data will be retained.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleReopen}
                    disabled={reopening}
                  >
                    {reopening ? 'Reopening...' : 'Yes, Reopen Tender'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    );
  }

  // ── ACTIVE MODE ───────────────────────────────────────────────────────────
  const hasOutcomeData    = submissions.some(s => s.outcome);
  const hasUnnotified     = submissions.some(s => (s.outcome && !s.outcome_notification_status) || s.outcome_notification_status === 'Failed' || (!s.outcome_notified_at && s.outcome));
  const allAssigned       = submissions.length > 0 && submissions.every(s => subOutcomes[s.id]);

  return (
    <div className="space-y-6">

      {/* Send result banner */}
      {lastSendResult && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
          lastSendResult.failed > 0 ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {lastSendResult.failed > 0 ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          <div>
            <p className="font-medium">
              {lastSendResult.sent} sent, {lastSendResult.failed} failed of {lastSendResult.total} total
            </p>
            {lastSendResult.failed > 0 && (
              <p className="text-xs mt-0.5 opacity-80">Use "Retry Failed" to resend unsuccessful notifications.</p>
            )}
          </div>
        </div>
      )}

      {/* Outcome Summary (if outcomes already set) */}
      {hasOutcomeData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Notification Status</CardTitle>
              <div className="flex gap-2">
                {hasFailed && (
                  <Button onClick={() => sendNotifications(true)} disabled={sending} variant="outline" size="sm" className="gap-2 border-yellow-400 text-yellow-700 hover:bg-yellow-50">
                    <RefreshCw className="w-3.5 h-3.5" /> {sending ? 'Retrying...' : 'Retry Failed'}
                  </Button>
                )}
              </div>
            </div>
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
                        <th className="text-right px-3 py-2 font-medium">Price</th>
                        <th className="text-center px-3 py-2 font-medium">Outcome</th>
                        <th className="text-center px-3 py-2 font-medium">Notification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {subs.map(sub => (
                        <tr key={sub.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">
                            {sub.business_name || sub.invitee_name || '—'}
                          </td>
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
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center">{notificationStatus(sub)}</td>
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign outcomes & send */}
      {canManage && submissions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Assign Outcomes & Notify</CardTitle>
              <Button
                onClick={() => sendNotifications(false)}
                disabled={sending || !allAssigned}
                size="sm"
                className="gap-2"
                title={!allAssigned ? 'Assign an outcome to all submissions first' : ''}
              >
                <Send className="w-4 h-4" />
                {sending ? 'Sending...' : 'Send All Notifications'}
              </Button>
            </div>
            {!allAssigned && (
              <p className="text-xs text-muted-foreground mt-1">Assign Awarded or Unsuccessful to each submission before sending.</p>
            )}
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
                        <th className="px-3 py-2 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {subs.map(sub => (
                        <tr key={sub.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">
                            {sub.business_name || sub.invitee_name || '—'}
                            {sub.outcome_notification_status === 'Sent' && (
                              <span className="ml-2 text-green-600 text-[10px]">✓ Notified</span>
                            )}
                            {sub.outcome_notification_status === 'Failed' && (
                              <span className="ml-2 text-red-500 text-[10px]">✗ Failed</span>
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
                            <Textarea
                              value={subNotes[sub.id] || ''}
                              onChange={e => setSubNotes(n => ({ ...n, [sub.id]: e.target.value }))}
                              placeholder="Notes..."
                              className="h-8 text-xs min-h-0 py-1"
                            />
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