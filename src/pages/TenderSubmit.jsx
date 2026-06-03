import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HardHat, Calendar, MapPin, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';

export default function TenderSubmit() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tender, setTender] = useState(null);
  const [invitee, setInvitee] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    lump_sum_price: '',
    price_breakdown: [],
    notes: '',
    uploaded_file_url: '',
    uploaded_file_name: '',
  });

  useEffect(() => {
    if (!token) { setError('Invalid link'); setLoading(false); return; }
    base44.functions.invoke('tenderPublicApi', { action: 'get', token })
      .then(res => {
        setTender(res.data.tender);
        setInvitee(res.data.invitee);
        // Pre-fill price breakdown
        if (res.data.tender.trade_packages?.length > 1) {
          setForm(f => ({
            ...f,
            price_breakdown: res.data.tender.trade_packages.map(tp => ({ trade_package: tp, amount: '', notes: '' })),
          }));
        }
        if (res.data.invitee.submission?.submitted_at) {
          setSubmitted(true);
        }
      })
      .catch(e => setError(e?.response?.data?.error || 'Invalid or expired link'))
      .finally(() => setLoading(false));
  }, [token]);

  const isOverdue = tender?.closing_date && isPast(parseISO(tender.closing_date));

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setForm(f => ({ ...f, uploaded_file_url: file_url, uploaded_file_name: file.name }));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.lump_sum_price) { setSubmitError('Please enter your lump sum price.'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      const breakdownFinal = form.price_breakdown
        .filter(b => b.amount)
        .map(b => ({ ...b, amount: Number(b.amount) }));

      await base44.functions.invoke('tenderPublicApi', {
        action: 'submit',
        token,
        submission: {
          lump_sum_price: Number(form.lump_sum_price),
          price_breakdown: breakdownFinal,
          notes: form.notes,
          uploaded_file_url: form.uploaded_file_url,
          uploaded_file_name: form.uploaded_file_name,
        },
      });
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e?.response?.data?.error || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Invalid Link</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Submission Received</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Your submission has been received. We will be in touch following the closing date
              {tender?.closing_date ? ` of ${format(parseISO(tender.closing_date), 'dd MMMM yyyy')}` : ''}.
            </p>
            <p className="text-sm font-medium">{tender?.title}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <HardHat className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-foreground">Tender Submission</h1>
              <p className="text-sm text-muted-foreground">ConstructIQ</p>
            </div>
          </div>
          <h2 className="text-xl font-bold">{tender.title}</h2>
          {tender.tender_number && <p className="text-sm text-muted-foreground font-mono">{tender.tender_number}</p>}
          <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
            {tender.location && (
              <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{tender.location}</span>
            )}
            {tender.closing_date && (
              <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                <Calendar className="w-3.5 h-3.5" />
                {isOverdue ? 'Closed' : `Closes ${format(parseISO(tender.closing_date), 'dd MMMM yyyy')}`}
              </span>
            )}
          </div>
          <p className="text-sm font-medium mt-2">For: {invitee.full_name}{invitee.business_name ? ` — ${invitee.business_name}` : ''}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {isOverdue && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            This tender has passed its closing date and is no longer accepting submissions.
          </div>
        )}

        {/* Description */}
        {tender.description && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Scope of Work</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{tender.description}</p></CardContent>
          </Card>
        )}

        {/* Trade packages */}
        {tender.trade_packages?.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Trade Packages Being Priced</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {tender.trade_packages.map(t => (
                  <span key={t} className="px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">{t}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Documents */}
        {tender.documents?.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Tender Documents</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {tender.documents.map((doc, i) => (
                <a
                  key={i}
                  href={doc.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2.5 border rounded-lg hover:bg-muted/50 transition-colors text-sm"
                >
                  <Download className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="flex-1 font-medium">{doc.name}</span>
                  {doc.category && <span className="text-xs text-muted-foreground">{doc.category}</span>}
                </a>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Submission form */}
        {!isOverdue && (
          <Card>
            <CardHeader><CardTitle>Your Submission</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Lump Sum Price (NZD) *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.lump_sum_price}
                    onChange={e => setForm(f => ({ ...f, lump_sum_price: e.target.value }))}
                    className="pl-7"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Price breakdown — only if multiple trade packages */}
              {form.price_breakdown.length > 0 && (
                <div>
                  <Label>Price Breakdown by Trade Package (optional)</Label>
                  <div className="space-y-2 mt-2">
                    {form.price_breakdown.map((b, idx) => (
                      <div key={idx} className="grid grid-cols-5 gap-2 items-center">
                        <div className="col-span-2 text-sm font-medium">{b.trade_package}</div>
                        <div className="col-span-2">
                          <Input
                            type="number" min="0" placeholder="Amount"
                            value={b.amount}
                            onChange={e => setForm(f => ({
                              ...f,
                              price_breakdown: f.price_breakdown.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x)
                            }))}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Input
                            placeholder="Notes"
                            value={b.notes}
                            onChange={e => setForm(f => ({
                              ...f,
                              price_breakdown: f.price_breakdown.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x)
                            }))}
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Label>Attach Pricing Document (optional)</Label>
                <Input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.doc,.docx"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                {uploading && <p className="text-xs text-muted-foreground mt-1">Uploading...</p>}
                {form.uploaded_file_name && (
                  <p className="text-xs text-green-600 mt-1">✓ {form.uploaded_file_name}</p>
                )}
              </div>

              <div>
                <Label>Notes / Qualifications</Label>
                <Textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={4}
                  placeholder="Any notes, assumptions, exclusions or qualifications..."
                />
              </div>

              {submitError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {submitError}
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={submitting || uploading || !form.lump_sum_price}
                className="w-full"
                size="lg"
              >
                {submitting ? 'Submitting...' : 'Submit My Pricing'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                By submitting you confirm this is your pricing for {tender.title}
                {tender.closing_date && `, closing ${format(parseISO(tender.closing_date), 'dd MMMM yyyy')}`}.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}