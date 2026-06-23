/**
 * SubmissionScorer
 *
 * Reads from TenderSubmission entity — single source of truth for all submissions.
 * Scores are saved back to TenderSubmission records.
 * Scoring criteria are still stored on the Tender record.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { TenderSubmission } from '@/api/entities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronUp, Download, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

function calcWeightedScore(submission, criteria) {
  if (!submission?.scores?.length) return null;
  let total = 0;
  for (const crit of criteria) {
    const scoreEntry = submission.scores.find(s => s.criterion === crit.criterion);
    if (scoreEntry?.score != null) {
      total += (scoreEntry.score / 10) * crit.weight_percent;
    }
  }
  return Math.round(total * 10) / 10;
}

function ScoringPanel({ submission, criteria, onSaveScores, saving }) {
  const [scores, setScores] = useState(() => {
    const map = {};
    (submission.scores || []).forEach(s => { map[s.criterion] = { score: s.score || 0, comment: s.comment || '' }; });
    return map;
  });

  const totalWeighted = criteria.reduce((sum, crit) => {
    const s = scores[crit.criterion]?.score;
    return s != null ? sum + (s / 10) * crit.weight_percent : sum;
  }, 0);

  const handleSave = () => {
    const scoresArr = criteria.map(crit => ({
      criterion: crit.criterion,
      score:     scores[crit.criterion]?.score   || 0,
      comment:   scores[crit.criterion]?.comment || '',
    }));
    onSaveScores(submission.id, scoresArr);
  };

  return (
    <div className="mt-3 p-4 bg-muted/30 rounded-lg border space-y-4">
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Lump Sum Price</p>
          <p className="font-semibold text-lg">
            {submission.lump_sum_price
              ? `NZD ${Number(submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Submitted</p>
          <p className="font-medium">
            {submission.submitted_at ? format(new Date(submission.submitted_at), 'dd MMM yyyy HH:mm') : '—'}
          </p>
        </div>
        {submission.uploaded_file_url && (
          <div>
            <p className="text-xs text-muted-foreground">Submission File</p>
            <a href={submission.uploaded_file_url} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1 text-primary text-sm hover:underline">
              <Download className="w-3 h-3" /> {submission.uploaded_file_name || 'Download'}
            </a>
          </div>
        )}
      </div>
      {submission.notes && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Notes / Qualifications</p>
          <p className="text-sm bg-card p-3 rounded border">{submission.notes}</p>
        </div>
      )}
      {submission.price_breakdown?.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-2">Price Breakdown</p>
          <div className="space-y-1">
            {submission.price_breakdown.map((b, i) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b last:border-0">
                <span>{b.trade_package}</span>
                <span className="font-mono">{b.amount ? `NZD ${Number(b.amount).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}` : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="text-xs font-medium mb-2">Scoring</p>
        <div className="space-y-2">
          {criteria.map(crit => {
            const s = scores[crit.criterion] || { score: 0, comment: '' };
            const weighted = ((s.score || 0) / 10) * crit.weight_percent;
            return (
              <div key={crit.criterion} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4 text-xs">
                  <p className="font-medium">{crit.criterion}</p>
                  <p className="text-muted-foreground">{crit.weight_percent}% weight</p>
                </div>
                <div className="col-span-2">
                  <Input type="number" min="0" max="10" value={s.score}
                    onChange={e => setScores(prev => ({ ...prev, [crit.criterion]: { ...prev[crit.criterion], score: Math.min(10, Math.max(0, Number(e.target.value))) } }))}
                    className="h-8 text-xs text-center" placeholder="0-10" />
                </div>
                <div className="col-span-4">
                  <Input value={s.comment}
                    onChange={e => setScores(prev => ({ ...prev, [crit.criterion]: { ...prev[crit.criterion], comment: e.target.value } }))}
                    className="h-8 text-xs" placeholder="Comment" />
                </div>
                <div className="col-span-2 text-xs text-right font-mono text-muted-foreground">
                  {weighted.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between items-center mt-3 pt-2 border-t">
          <span className="text-sm font-semibold">Total Weighted Score</span>
          <span className="text-lg font-bold text-primary">{totalWeighted.toFixed(1)}/100</span>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="mt-3 gap-2">
          {saving ? 'Saving...' : 'Save Scores'}
        </Button>
      </div>
    </div>
  );
}

function fmt(val) {
  if (!val) return '—';
  return `NZD ${Number(val).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`;
}

function TradeSummary({ submissions }) {
  const prices = submissions.map(s => s.lump_sum_price).filter(Boolean);
  if (prices.length === 0) return null;
  const lowest  = Math.min(...prices);
  const highest = Math.max(...prices);
  const avg     = prices.reduce((a, b) => a + b, 0) / prices.length;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-muted/30 rounded-lg border mb-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground">Submissions</p>
        <p className="font-semibold">{submissions.length}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Lowest</p>
        <p className="font-semibold text-green-700">{fmt(lowest)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Average</p>
        <p className="font-semibold">{fmt(avg)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Highest</p>
        <p className="font-semibold text-red-600">{fmt(highest)}</p>
      </div>
    </div>
  );
}

export default function SubmissionScorer({ tender, onUpdate, canManage }) {
  const queryClient = useQueryClient();
  const [openPanel, setOpenPanel]       = useState(null);
  const [savingScores, setSavingScores] = useState(null);
  const [showCriteria, setShowCriteria] = useState(false);
  const [tradeFilter, setTradeFilter]   = useState('ALL');
  // Sync criteria from tender prop (source of truth is Tender.scoring_criteria)
  const [criteria, setCriteria] = useState(
    tender.scoring_criteria?.length
      ? tender.scoring_criteria
      : [
          { criterion: 'Price',       weight_percent: 40 },
          { criterion: 'Experience',  weight_percent: 20 },
          { criterion: 'Programme',   weight_percent: 15 },
          { criterion: 'Methodology', weight_percent: 15 },
          { criterion: 'Compliance',  weight_percent: 10 },
        ]
  );

  // Re-sync criteria whenever the saved tender record changes
  React.useEffect(() => {
    if (tender.scoring_criteria?.length) {
      setCriteria(tender.scoring_criteria);
    }
  }, [JSON.stringify(tender.scoring_criteria)]);
  const [savingCriteria, setSavingCriteria] = useState(false);

  const { data: submissions = [] } = useQuery({
    queryKey: ['tenderSubmissions', tender.id],
    queryFn:  () => TenderSubmission.filter({ tender_id: tender.id }),
    enabled:  !!tender.id,
    // Poll every 30s while tender is Issued so incoming submissions appear without manual refresh
    refetchInterval: tender.status === 'Issued' ? 30000 : false,
    refetchIntervalInBackground: false,
  });

  const totalWeight = criteria.reduce((s, c) => s + (c.weight_percent || 0), 0);

  const saveCriteria = async () => {
    setSavingCriteria(true);
    await onUpdate({ scoring_criteria: criteria });
    setSavingCriteria(false);
    setShowCriteria(false);
  };

  const saveScores = async (submissionId, scoresArr) => {
    setSavingScores(submissionId);
    await TenderSubmission.update(submissionId, { scores: scoresArr });
    queryClient.invalidateQueries({ queryKey: ['tenderSubmissions', tender.id] });
    setSavingScores(null);
  };

  // Unique trade values from snapshot fields
  const uniqueTrades = useMemo(() => {
    const set = new Set(submissions.map(s => s.trade).filter(Boolean));
    return Array.from(set).sort();
  }, [submissions]);

  // Filtered + grouped submissions
  const filteredSubmissions = useMemo(() => {
    return tradeFilter === 'ALL' ? submissions : submissions.filter(s => s.trade === tradeFilter);
  }, [submissions, tradeFilter]);

  const tradeGroups = useMemo(() => {
    const groups = {};
    for (const sub of filteredSubmissions) {
      const key = sub.trade || '(No Trade)';
      if (!groups[key]) groups[key] = [];
      groups[key].push(sub);
    }
    // Sort each group by lump_sum_price ascending
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (a.lump_sum_price || 0) - (b.lump_sum_price || 0));
    }
    return groups;
  }, [filteredSubmissions]);

  return (
    <div className="space-y-6">
      {/* Configure Scoring */}
      <Card>
        <CardHeader className="pb-2">
          <button className="flex items-center justify-between w-full" onClick={() => setShowCriteria(v => !v)}>
            <CardTitle className="text-sm">Configure Scoring Criteria</CardTitle>
            {showCriteria ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </CardHeader>
        {showCriteria && (
          <CardContent className="space-y-2">
            {criteria.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input value={c.criterion}
                  onChange={e => setCriteria(prev => prev.map((x, i) => i === idx ? { ...x, criterion: e.target.value } : x))}
                  className="h-8 text-xs flex-1" placeholder="Criterion" />
                <div className="flex items-center gap-1 w-24">
                  <Input type="number" min="0" max="100" value={c.weight_percent}
                    onChange={e => setCriteria(prev => prev.map((x, i) => i === idx ? { ...x, weight_percent: Number(e.target.value) } : x))}
                    className="h-8 text-xs text-center" />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                  onClick={() => setCriteria(prev => prev.filter((_, i) => i !== idx))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            <div className={`text-xs font-medium ${totalWeight !== 100 ? 'text-red-600' : 'text-green-600'}`}>
              {totalWeight !== 100 && <AlertTriangle className="w-3 h-3 inline mr-1" />}
              Total: {totalWeight}% {totalWeight !== 100 ? '(must equal 100%)' : '✓'}
            </div>
            <Button variant="outline" size="sm" className="gap-1"
              onClick={() => setCriteria(prev => [...prev, { criterion: '', weight_percent: 0 }])}>
              <Plus className="w-3 h-3" /> Add Criterion
            </Button>
            <Button size="sm" onClick={saveCriteria} disabled={savingCriteria || totalWeight !== 100} className="ml-2">
              {savingCriteria ? 'Saving...' : 'Save Criteria'}
            </Button>
          </CardContent>
        )}
      </Card>

      {totalWeight !== 100 && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            Scoring weights total <strong>{totalWeight}%</strong> — must equal 100%.{' '}
            <button className="underline font-medium" onClick={() => setShowCriteria(true)}>Fix ↓</button>
          </span>
        </div>
      )}

      {/* Trade filter */}
      {submissions.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground flex-shrink-0">Filter by trade:</span>
          <Select value={tradeFilter} onValueChange={setTradeFilter}>
            <SelectTrigger className="w-48 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Trades</SelectItem>
              {uniqueTrades.map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tradeFilter !== 'ALL' && (
            <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setTradeFilter('ALL')}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Submissions list — grouped by trade */}
      {submissions.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">No submissions received yet</div>
      ) : filteredSubmissions.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">No submissions for this trade</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(tradeGroups).map(([trade, tradeSubs]) => (
            <div key={trade}>
              {/* Trade group header */}
              <div className="flex items-center gap-2 mb-3">
                <h4 className="font-semibold text-sm">{trade}</h4>
                <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{tradeSubs.length}</span>
              </div>

              {/* Trade summary */}
              <TradeSummary submissions={tradeSubs} />

              {/* Submission cards */}
              <div className="space-y-2">
                {tradeSubs.map(sub => {
                  const ws = calcWeightedScore(sub, criteria);
                  return (
                    <div key={sub.id} className="border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between p-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{sub.business_name || sub.invitee_name || '—'}</span>
                            {sub.full_name && sub.full_name !== sub.business_name && (
                              <span className="text-xs text-muted-foreground">{sub.full_name}</span>
                            )}
                            {sub.trade && (
                              <span className="text-xs bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">{sub.trade}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                            {sub.lump_sum_price && (
                              <span className="font-semibold text-foreground">
                                NZD {Number(sub.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
                              </span>
                            )}
                            {ws != null && <span className="text-primary font-medium">Score: {ws}/100</span>}
                            {sub.submitted_at && <span>{format(new Date(sub.submitted_at), 'dd MMM yyyy')}</span>}
                          </div>
                        </div>
                        {canManage && (
                          <Button variant="outline" size="sm"
                            onClick={() => setOpenPanel(openPanel === sub.id ? null : sub.id)}>
                            {openPanel === sub.id ? 'Close' : 'View / Score'}
                          </Button>
                        )}
                      </div>
                      {openPanel === sub.id && (
                        <div className="px-4 pb-4">
                          <ScoringPanel submission={sub} criteria={criteria}
                            onSaveScores={saveScores} saving={savingScores === sub.id} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}