import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronUp, Download, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const STATUS_STYLES = {
  Invited:      'bg-blue-100 text-blue-700',
  Viewed:       'bg-cyan-100 text-cyan-700',
  Submitted:    'bg-green-100 text-green-700',
  Awarded:      'bg-emerald-100 text-emerald-700',
  Unsuccessful: 'bg-red-100 text-red-700',
  Withdrawn:    'bg-gray-100 text-gray-600',
};

function calcWeightedScore(invitee, criteria) {
  if (!invitee.submission?.scores?.length) return null;
  let total = 0;
  for (const crit of criteria) {
    const scoreEntry = invitee.submission.scores.find(s => s.criterion === crit.criterion);
    if (scoreEntry?.score != null) {
      total += (scoreEntry.score / 10) * crit.weight_percent;
    }
  }
  return Math.round(total * 10) / 10;
}

function ScoringPanel({ invitee, criteria, onSaveScores, saving }) {
  const [scores, setScores] = useState(() => {
    const map = {};
    (invitee.submission?.scores || []).forEach(s => { map[s.criterion] = { score: s.score || 0, comment: s.comment || '' }; });
    return map;
  });

  const totalWeighted = criteria.reduce((sum, crit) => {
    const s = scores[crit.criterion]?.score;
    return s != null ? sum + (s / 10) * crit.weight_percent : sum;
  }, 0);

  const handleSave = () => {
    const scoresArr = criteria.map(crit => ({
      criterion: crit.criterion,
      score: scores[crit.criterion]?.score || 0,
      comment: scores[crit.criterion]?.comment || '',
    }));
    onSaveScores(invitee.id, scoresArr);
  };

  return (
    <div className="mt-3 p-4 bg-muted/30 rounded-lg border space-y-4">
      {/* Submission details */}
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Lump Sum Price</p>
          <p className="font-semibold text-lg">
            {invitee.submission?.lump_sum_price
              ? `NZD ${Number(invitee.submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Submitted</p>
          <p className="font-medium">
            {invitee.submission?.submitted_at ? format(new Date(invitee.submission.submitted_at), 'dd MMM yyyy HH:mm') : '—'}
          </p>
        </div>
        {invitee.submission?.uploaded_file_url && (
          <div>
            <p className="text-xs text-muted-foreground">Submission File</p>
            <a href={invitee.submission.uploaded_file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary text-sm hover:underline">
              <Download className="w-3 h-3" /> {invitee.submission.uploaded_file_name || 'Download'}
            </a>
          </div>
        )}
      </div>
      {invitee.submission?.notes && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Notes / Qualifications</p>
          <p className="text-sm bg-card p-3 rounded border">{invitee.submission.notes}</p>
        </div>
      )}
      {/* Price breakdown */}
      {invitee.submission?.price_breakdown?.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-2">Price Breakdown</p>
          <div className="space-y-1">
            {invitee.submission.price_breakdown.map((b, i) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b last:border-0">
                <span>{b.trade_package}</span>
                <span className="font-mono">{b.amount ? `NZD ${Number(b.amount).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}` : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scoring criteria */}
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
                  <Input
                    type="number" min="0" max="10"
                    value={s.score}
                    onChange={e => setScores(prev => ({ ...prev, [crit.criterion]: { ...prev[crit.criterion], score: Math.min(10, Math.max(0, Number(e.target.value))) } }))}
                    className="h-8 text-xs text-center"
                    placeholder="0-10"
                  />
                </div>
                <div className="col-span-4">
                  <Input
                    value={s.comment}
                    onChange={e => setScores(prev => ({ ...prev, [crit.criterion]: { ...prev[crit.criterion], comment: e.target.value } }))}
                    className="h-8 text-xs"
                    placeholder="Comment"
                  />
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

export default function SubmissionScorer({ tender, onUpdate, canManage }) {
  const [openPanel, setOpenPanel] = useState(null);
  const [savingScores, setSavingScores] = useState(null);
  const [showCriteria, setShowCriteria] = useState(false);
  const [criteria, setCriteria] = useState(() => tender.scoring_criteria || [
    { criterion: 'Price', weight_percent: 40 },
    { criterion: 'Experience', weight_percent: 20 },
    { criterion: 'Programme', weight_percent: 15 },
    { criterion: 'Methodology', weight_percent: 15 },
    { criterion: 'Compliance', weight_percent: 10 },
  ]);
  const [savingCriteria, setSavingCriteria] = useState(false);

  const invitees = tender.invitees || [];
  const submitted = invitees.filter(i => i.submission?.submitted_at);

  const totalWeight = criteria.reduce((s, c) => s + (c.weight_percent || 0), 0);

  const saveCriteria = async () => {
    setSavingCriteria(true);
    await onUpdate({ scoring_criteria: criteria });
    setSavingCriteria(false);
    setShowCriteria(false);
  };

  const saveScores = async (inviteeId, scoresArr) => {
    setSavingScores(inviteeId);
    const updatedInvitees = invitees.map(inv =>
      inv.id === inviteeId
        ? { ...inv, submission: { ...inv.submission, scores: scoresArr } }
        : inv
    );
    await onUpdate({ invitees: updatedInvitees });
    setSavingScores(null);
  };

  // Comparison data
  const chartData = submitted
    .filter(i => i.submission?.lump_sum_price)
    .sort((a, b) => a.submission.lump_sum_price - b.submission.lump_sum_price)
    .map((i, idx) => ({
      name: i.full_name || 'Unknown',
      price: i.submission.lump_sum_price,
      score: calcWeightedScore(i, criteria) || 0,
    }));

  return (
    <div className="space-y-6">
      {/* Configure Scoring */}
      <Card>
        <CardHeader className="pb-2">
          <button
            className="flex items-center justify-between w-full"
            onClick={() => setShowCriteria(v => !v)}
          >
            <CardTitle className="text-sm">Configure Scoring Criteria</CardTitle>
            {showCriteria ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </CardHeader>
        {showCriteria && (
          <CardContent className="space-y-2">
            {criteria.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={c.criterion}
                  onChange={e => setCriteria(prev => prev.map((x, i) => i === idx ? { ...x, criterion: e.target.value } : x))}
                  className="h-8 text-xs flex-1"
                  placeholder="Criterion"
                />
                <div className="flex items-center gap-1 w-24">
                  <Input
                    type="number" min="0" max="100"
                    value={c.weight_percent}
                    onChange={e => setCriteria(prev => prev.map((x, i) => i === idx ? { ...x, weight_percent: Number(e.target.value) } : x))}
                    className="h-8 text-xs text-center"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setCriteria(prev => prev.filter((_, i) => i !== idx))}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            <div className={`text-xs font-medium ${totalWeight !== 100 ? 'text-red-600' : 'text-green-600'}`}>
              {totalWeight !== 100 && <AlertTriangle className="w-3 h-3 inline mr-1" />}
              Total: {totalWeight}% {totalWeight !== 100 ? '(must equal 100%)' : '✓'}
            </div>
            <Button
              variant="outline" size="sm" className="gap-1"
              onClick={() => setCriteria(prev => [...prev, { criterion: '', weight_percent: 0 }])}
            >
              <Plus className="w-3 h-3" /> Add Criterion
            </Button>
            <Button size="sm" onClick={saveCriteria} disabled={savingCriteria || totalWeight !== 100} className="ml-2">
              {savingCriteria ? 'Saving...' : 'Save Criteria'}
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Submissions table */}
      {submitted.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">No submissions received yet</div>
      ) : (
        <div className="space-y-3">
          {submitted.map(inv => {
            const ws = calcWeightedScore(inv, criteria);
            return (
              <div key={inv.id} className="border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{inv.full_name}</span>
                      {inv.business_name && <span className="text-xs text-muted-foreground">{inv.business_name}</span>}
                      {inv.trade && <span className="text-xs bg-muted px-1.5 rounded">{inv.trade}</span>}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || 'bg-gray-100'}`}>{inv.status}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      {inv.submission?.lump_sum_price && (
                        <span className="font-semibold text-foreground">
                          NZD {Number(inv.submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                      {ws != null && <span className="text-primary font-medium">Score: {ws}/100</span>}
                      {inv.submission?.submitted_at && (
                        <span>{format(new Date(inv.submission.submitted_at), 'dd MMM yyyy')}</span>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setOpenPanel(openPanel === inv.id ? null : inv.id)}
                    >
                      {openPanel === inv.id ? 'Close' : 'View / Score'}
                    </Button>
                  )}
                </div>
                {openPanel === inv.id && (
                  <div className="px-4 pb-4">
                    <ScoringPanel
                      invitee={inv}
                      criteria={criteria}
                      onSaveScores={saveScores}
                      saving={savingScores === inv.id}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Comparison chart */}
      {chartData.length >= 2 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Price Comparison</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => `NZD ${Number(v).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`} />
                <Bar dataKey="price" name="Price" radius={[3, 3, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={i === 0 ? '#10b981' : '#3b82f6'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2 text-center">Lowest to highest — green = lowest price</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}