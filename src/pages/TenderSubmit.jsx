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
  const [editingSubmission, setEditingSubmission] = useState(false);

  const [form, setForm] = useState({
    lump_sum_price: '',
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
        if (res.data.invitee.submission?.submitted_at) {
          setSubmitted(true);
        }
      })
      .catch(e => setError(e?.response?.data?.error || 'Invalid or expired link'))
      .finally(() => setLoading(false));
  }, [token]);

  const isOverdue = tender?.closing_date &&
    isPast(parseISO(`${tender.closing_date.split('T')[0]}T23:59:59+12:00`));

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Convert file to base64 and upload via backend (no auth token needed on public page)
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await base44.functions.invoke('tenderPublicApi', {
        action: 'upload',
        token,
        fileName: file.name,
        fileData: base64,
        fileType: file.type,
      });
      setForm(f => ({ ...f, uploaded_file_url: res.data.file_url, uploaded_file_name: file.name }));
    } catch (err) {
      setSubmitError(`File upload failed: ${err?.message || 'Please try again'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.lump_sum_price) { setSubmitError('Please enter your lump sum price.'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      await base44.functions.invoke('tenderPublicApi', {
        action: 'submit',
        token,
        submission: {
          lump_sum_price:     Number(form.lump_sum_price),
          notes:              form.notes,
          uploaded_file_url:  form.uploaded_file_url,
          uploaded_file_name: form.uploaded_file_name,
        },
      });
      setInvitee(prev => prev ? {
        ...prev,
        submission: { ...(prev.submission || {}), submitted_at: new Date().toISOString() }
      } : prev);
      setSubmitted(true);
      setEditingSubmission(false);
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
            <h2 className="text-lg font-semibold mb-2">
              {error?.toLowerCase().includes('closed')    ? 'Tender Closed'         :
               error?.toLowerCase().includes('passed')    ? 'Closing Date Passed'   :
               error?.toLowerCase().includes('accepting') ? 'Submissions Closed'    :
               error?.toLowerCase().includes('not found') ? 'Invitation Not Found'  :
                                                            'Invalid Link'}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <p className="text-sm text-muted-foreground">
              If you believe this is an error, please contact the person who sent you this invitation and ask them to resend the link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted && !editingSubmission) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold">Submission Received</h2>
            <p className="text-sm text-muted-foreground">
              Your pricing was submitted{invitee?.submission?.submitted_at
                ? ` on ${format(new Date(invitee.submission.submitted_at), 'dd MMM yyyy h:mm a')}`
                : ''}.
            </p>
            {!isOverdue && (
              <div className="pt-2">
                <p className="text-sm text-muted-foreground mb-3">
                  The tender is still open. You can update your submission before the closing date.
                </p>
                <Button variant="outline" onClick={() => setEditingSubmission(true)}>
                  Update my submission
                </Button>
              </div>
            )}
            {isOverdue && (
              <p className="text-sm text-muted-foreground">
                The tender has closed. No further changes can be made.
              </p>
            )}
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