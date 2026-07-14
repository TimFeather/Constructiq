import { invokeFunction } from '@/api/supabaseClient';
import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import SanitizedHtml from '@/components/shared/SanitizedHtml';
import {
  HardHat, Calendar, MapPin, Download, CheckCircle2,
  AlertCircle, Mail, Phone, Building2, FileText, Bell, MessageSquare, X,
  Plus, Loader2, RefreshCw,
} from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';

function fmtDate(val) {
  if (!val) return null;
  try { return format(parseISO(val.split('T')[0]), 'dd MMMM yyyy'); } catch { return val; }
}

function DownloadAllButton({ documents, tenderTitle }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleDownloadAll = async () => {
    if (!documents?.length) return;
    setDownloading(true);
    setProgress(0);
    try {
      const zip = new JSZip();
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const response = await fetch(doc.file_url);
        if (!response.ok) throw new Error(`Failed to fetch ${doc.name}`);
        const blob = await response.blob();
        const ext = doc.file_url.split('?')[0].split('.').pop() || '';
        const fileName = doc.name || `document-${i + 1}`;
        const safeName = fileName.includes('.') ? fileName : `${fileName}.${ext}`;
        zip.file(safeName, blob);
        setProgress(Math.round(((i + 1) / documents.length) * 100));
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName = `${(tenderTitle || 'tender').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-documents.zip`;
      saveAs(zipBlob, zipName);
    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setDownloading(false);
      setProgress(0);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadAll} disabled={downloading}>
      <Download className="w-3.5 h-3.5" />
      {downloading ? `Zipping... ${progress}%` : 'Download All'}
    </Button>
  );
}

export default function TenderSubmit() {
  const { token } = useParams();
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [tender, setTender]             = useState(null);
  const [invitee, setInvitee]           = useState(null);
  const [issuer, setIssuer]             = useState(null);
  const [branding, setBranding]         = useState(null);
  const [submitted, setSubmitted]       = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [submitError, setSubmitError]   = useState('');
  // pricingFiles: [{id, file_name, file_url, status: 'uploading'|'done'|'error', error, file}]
  const [pricingFiles, setPricingFiles] = useState([]);
  const [editingSubmission, setEditingSubmission] = useState(false);
  // priceLines: [{id, description, amount}]
  const [priceLines, setPriceLines] = useState([{ id: 1, description: 'Lump sum price', amount: '' }]);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = (tab) => setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('tab', tab); return p; }, { replace: true });
  const [intentLoading, setIntentLoading] = useState(false);

  // Questions state
  const [questions, setQuestions]       = useState([]);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [showAskModal, setShowAskModal] = useState(false);
  const [askForm, setAskForm]           = useState({ subject: '', description: '' });
  const [askSubmitting, setAskSubmitting] = useState(false);

  const [form, setForm] = useState({
    lump_sum_price: '',
    notes: '',
    uploaded_file_url: '',
    uploaded_file_name: '',
  });

  useEffect(() => {
    if (!token) { setError('Invalid link'); setLoading(false); return; }
    invokeFunction('tenderPublicApi', { action: 'get', token })
      .then(res => {
        setTender(res.data.tender);
        setInvitee(res.data.invitee);
        setIssuer(res.data.issuer || null);
        setBranding(res.data.branding || null);
        if (res.data.invitee?.submission?.submitted_at) {
          setSubmitted(true);
          const s = res.data.invitee.submission;
          setForm({
            lump_sum_price:     s.lump_sum_price   ? String(s.lump_sum_price) : '',
            notes:              s.notes             || '',
            uploaded_file_url:  s.uploaded_file_url  || '',
            uploaded_file_name: s.uploaded_file_name || '',
          });
          // Restore price lines — fall back to single lump sum line
          if (s.price_lines?.length) {
            setPriceLines(s.price_lines.map((l, i) => ({ id: i + 1, description: l.description, amount: String(l.amount) })));
          } else if (s.lump_sum_price) {
            setPriceLines([{ id: 1, description: 'Lump sum price', amount: String(s.lump_sum_price) }]);
          }
          // Restore uploaded files as done entries
          const savedFiles = s.pricing_files?.length
            ? s.pricing_files
            : s.uploaded_file_url ? [{ file_url: s.uploaded_file_url, file_name: s.uploaded_file_name }] : [];
          setPricingFiles(savedFiles.map((f, i) => ({ id: i + 1, file_name: f.file_name, file_url: f.file_url, storage_path: f.storage_path, status: 'done' })));
        }
      })
      .catch(e => setError(e?.response?.data?.error || 'Invalid or expired link'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleUpdateIntent = async (intent) => {
    setIntentLoading(true);
    try {
      await invokeFunction('tenderPublicApi', { action: 'updateIntent', token, intent });
      setInvitee(prev => prev ? { ...prev, status: intent === 'will_not_tender' ? 'Declined' : 'Viewed' } : prev);
    } catch (e) {
      console.error('Failed to update intent:', e.message);
    } finally {
      setIntentLoading(false);
    }
  };

  const loadQuestions = async () => {
    try {
      const res = await invokeFunction('tenderPublicApi', { action: 'listQuestions', token });
      setQuestions(res.data.questions || []);
      setQuestionsLoaded(true);
    } catch (_e) { /* fail silently */ }
  };

  const handleAskQuestion = async () => {
    if (!askForm.subject.trim()) return;
    setAskSubmitting(true);
    try {
      await invokeFunction('tenderPublicApi', {
        action: 'createQuestion', token,
        subject: askForm.subject,
        description: askForm.description,
      });
      setAskForm({ subject: '', description: '' });
      setShowAskModal(false);
      await loadQuestions();
    } catch (e) {
      alert('Failed to submit question: ' + (e?.message || 'Please try again'));
    } finally {
      setAskSubmitting(false);
    }
  };

  const isOverdue = tender?.closing_date &&
    isPast(parseISO(`${tender.closing_date.split('T')[0]}T23:59:59+12:00`));

  const uploadSingleFile = async (fileEntry) => {
    const { id, file } = fileEntry;
    setPricingFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'uploading', error: null } : f));
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await invokeFunction('tenderPublicApi', {
        action: 'upload', token,
        fileName: file.name, fileData: base64, fileType: file.type,
      });
      setPricingFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'done', file_url: res.data.file_url, storage_path: res.data.storage_path } : f));
    } catch (err) {
      setPricingFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', error: err?.message || 'Upload failed' } : f));
    }
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const oversized = files.find(f => f.size > 500 * 1024 * 1024);
    if (oversized) { setSubmitError(`${oversized.name} must be under 500 MB.`); e.target.value = ''; return; }
    const newEntries = files.map((file, i) => ({
      id: Date.now() + i,
      file_name: file.name,
      file_url: '',
      status: 'uploading',
      error: null,
      file,
    }));
    setPricingFiles(prev => [...prev, ...newEntries]);
    e.target.value = '';
    for (const entry of newEntries) {
      await uploadSingleFile(entry);
    }
  };

  const handleSubmit = async () => {
    const validLines = priceLines.filter(l => l.amount && Number(l.amount) > 0);
    const totalPrice = validLines.reduce((sum, l) => sum + Number(l.amount), 0);
    if (!totalPrice) { setSubmitError('Please enter at least one price.'); return; }
    if (pricingFiles.some(f => f.status === 'uploading')) { setSubmitError('Please wait for files to finish uploading.'); return; }
    if (pricingFiles.some(f => f.status === 'error')) { setSubmitError('Some files failed to upload. Retry or remove them before submitting.'); return; }
    setSubmitting(true);
    setSubmitError('');
    const doneFiles = pricingFiles.filter(f => f.status === 'done');
    try {
      await invokeFunction('tenderPublicApi', {
        action: 'submit', token,
        submission: {
          lump_sum_price:     totalPrice,
          price_lines:        validLines.map(l => ({ description: l.description || 'Item', amount: Number(l.amount) })),
          notes:              form.notes,
          pricing_files:      doneFiles.map(f => ({ file_url: f.file_url, file_name: f.file_name, storage_path: f.storage_path })),
          uploaded_file_url:  doneFiles[0]?.file_url  || '',
          uploaded_file_name: doneFiles[0]?.file_name || '',
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

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">
              {error?.toLowerCase().includes('closed')    ? 'Tender Closed'        :
               error?.toLowerCase().includes('passed')    ? 'Closing Date Passed'  :
               error?.toLowerCase().includes('accepting') ? 'Submissions Closed'   :
               error?.toLowerCase().includes('not found') ? 'Invitation Not Found' :
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

  // ── Submitted confirmation ───────────────────────────────────────────────────
  if (submitted && !editingSubmission) {
    // Files the supplier lodged (names only — the files themselves are private).
    const submittedFiles = pricingFiles.filter(f => f.status === 'done');
    return (
      <div className="min-h-screen bg-background">
        <PortalHeader tender={tender} invitee={invitee} isOverdue={isOverdue} branding={branding}
          onSubmitClick={() => { setEditingSubmission(true); setActiveTab('submit'); }} showSubmitBtn={!isOverdue} />
        <div className="max-w-3xl mx-auto px-4 py-12 flex items-center justify-center">
          <div className="text-center space-y-5 max-w-md w-full">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Submission Received</h2>
              {tender?.title && <p className="text-sm font-medium text-foreground">{tender.title}</p>}
            </div>
            <p className="text-sm text-muted-foreground">
              Your pricing was submitted
              {invitee?.submission?.submitted_at
                ? ` on ${format(new Date(invitee.submission.submitted_at), 'dd MMM yyyy h:mm a')}`
                : ''}.
            </p>

            {submittedFiles.length > 0 && (
              <div className="text-left border rounded-lg p-3 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Files lodged</p>
                <ul className="space-y-1">
                  {submittedFiles.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{f.file_name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(issuer?.name || issuer?.email) && (
              <div className="text-left border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1.5">
                  For any further information required, please contact:
                </p>
                {issuer?.name && <p className="text-sm font-medium">{issuer.name}</p>}
                {issuer?.email && (
                  <a href={`mailto:${issuer.email}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <Mail className="w-3.5 h-3.5" /> {issuer.email}
                  </a>
                )}
              </div>
            )}

            {!isOverdue && (
              <div className="pt-1">
                <p className="text-sm text-muted-foreground mb-3">
                  The tender is still open. You can update your submission before the closing date.
                </p>
                <Button variant="outline" onClick={() => { setEditingSubmission(true); setActiveTab('submit'); }}>
                  Update my submission
                </Button>
              </div>
            )}
            {isOverdue && (
              <p className="text-sm text-muted-foreground">
                The tender has closed. No further changes can be made.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const notices = tender?.notices || [];

  // ── Main portal ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <PortalHeader tender={tender} invitee={invitee} isOverdue={isOverdue} branding={branding}
        onSubmitClick={() => setActiveTab('submit')} showSubmitBtn={!isOverdue && !submitted} />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {isOverdue && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            This tender has passed its closing date and is no longer accepting submissions.
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto -mx-1 px-1 pb-1 mb-6">
          <TabsList className="inline-flex w-max">
            <TabsTrigger value="overview">Tender</TabsTrigger>
            <TabsTrigger value="documents">
              Documents {tender?.documents?.length > 0 && `(${tender.documents.length})`}
            </TabsTrigger>
            <TabsTrigger value="correspondence">
              Correspondence {notices.length > 0 && `(${notices.length})`}
            </TabsTrigger>
            <TabsTrigger value="questions" onClick={() => { if (!questionsLoaded) loadQuestions(); }}>
              Questions {questions.length > 0 && `(${questions.length})`}
            </TabsTrigger>
            {!isOverdue && <TabsTrigger value="submit">
              {submitted ? 'Update Submission' : 'Submit'}
            </TabsTrigger>}
          </TabsList>
          </div>

          {/* ── OVERVIEW TAB ── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              {/* Project details */}
              <div className="md:col-span-2 border rounded-lg p-5 bg-card space-y-4">
                <h3 className="font-semibold text-base">Overview</h3>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <InfoField label="Project" value={tender.title} />
                  <InfoField label="Tender Number" value={tender.tender_number} />
                  <InfoField label="Address / Location" value={tender.location} />
                  <InfoField label="Tender due date" value={fmtDate(tender.closing_date)}
                    highlight={isOverdue ? 'red' : null} />
                  {tender.ths_rft_closing_date && (
                    <InfoField label="THS RFT closing date" value={fmtDate(tender.ths_rft_closing_date)} />
                  )}
                  {tender.site_visit_date && (
                    <InfoField label="Site Visit Date" value={fmtDate(tender.site_visit_date)} />
                  )}
                  {tender.questions_date && (
                    <InfoField label="Questions Deadline" value={fmtDate(tender.questions_date)} />
                  )}
                  {tender.trade_packages?.length > 0 && (
                    <InfoField label="Trade Packages" value={tender.trade_packages.join(', ')} />
                  )}
                </div>

                {/* Tendering intent */}
                <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <Bell className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-blue-900">
                      {invitee?.status === 'Declined'
                        ? 'You have indicated you will not tender on this project.'
                        : 'You have been invited to tender on this project.'}
                    </p>
                    {!isOverdue && invitee?.status !== 'Submitted' && (
                      <p className="text-blue-700 mt-0.5">You can change your response at any time before the tender deadline.</p>
                    )}
                  </div>
                  {!isOverdue && invitee?.status !== 'Submitted' && (
                    <div className="flex gap-2 flex-shrink-0">
                      {invitee?.status !== 'Declined' ? (
                        <button
                          onClick={() => handleUpdateIntent('will_not_tender')}
                          disabled={intentLoading}
                          className="text-xs border border-gray-300 bg-white text-gray-700 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                          Will not tender
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUpdateIntent('will_tender')}
                          disabled={intentLoading}
                          className="text-xs border border-blue-300 bg-white text-blue-700 px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50"
                        >
                          Will tender
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Description */}
                {tender.description && (
                  <div>
                    <h4 className="font-medium text-sm mb-2">Project Description</h4>
                    <SanitizedHtml html={tender.description} className="text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Contact info */}
              <div className="border rounded-lg p-5 bg-card space-y-4">
                <h3 className="font-semibold text-base">Contact Information</h3>
                {issuer?.name && (
                  <ContactCard name={issuer.name} email={issuer.email} phone={issuer.phone} label="Issued By" />
                )}
                {(tender.additional_contacts || []).map((contact, i) => (
                  contact.name && (
                    <ContactCard
                      key={i}
                      name={contact.name}
                      email={contact.email}
                      phone={contact.phone}
                      label={contact.role || undefined}
                    />
                  )
                ))}
                <div className="pt-2 border-t text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Your invitation</p>
                  <p>{invitee?.full_name}</p>
                  {invitee?.email && <p className="text-muted-foreground">{invitee.email}</p>}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── DOCUMENTS TAB ── */}
          <TabsContent value="documents">
            {!tender?.documents?.length ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No documents have been uploaded for this tender yet.
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden bg-card">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                  <span className="text-sm font-medium">{tender.documents.length} document{tender.documents.length !== 1 ? 's' : ''}</span>
                  <DownloadAllButton documents={tender.documents} tenderTitle={tender.title} />
                </div>
                <div className="divide-y">
                  {tender.documents.map((doc, i) => (
                    <a key={i} href={doc.file_url} target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                      <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="flex-1 text-sm font-medium">{doc.name}</span>
                      {doc.category && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{doc.category}</span>
                      )}
                      <Download className="w-4 h-4 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── CORRESPONDENCE TAB (NTTs) ── */}
          <TabsContent value="correspondence">
            {notices.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No notices to tenderers have been issued yet.
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground mb-4">
                  Notices to Tenderers (NTTs) are official communications issued during the tender period. Please review all notices before submitting.
                </p>
                {notices.map((notice) => (
                  <div key={notice.id} className="border rounded-lg p-4 bg-card space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-semibold">
                            {notice.notice_number}
                          </span>
                          <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded">
                            {notice.notice_type}
                          </span>
                        </div>
                        <h4 className="font-semibold text-sm mt-1">{notice.title}</h4>
                      </div>
                      {notice.issue_date && (
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {fmtDate(notice.issue_date)}
                        </span>
                      )}
                    </div>
                    {notice.description && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{notice.description}</p>
                    )}
                    {notice.attachments?.length > 0 && (
                      <div className="pt-2 border-t space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Attachments</p>
                        {notice.attachments.map((att) => (
                          <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer"
                             className="flex items-center gap-2 text-xs text-primary hover:underline">
                            <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                            {att.file_name || 'Attachment'}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── QUESTIONS TAB ── */}
          <TabsContent value="questions" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Questions &amp; Answers</h3>
              {!isOverdue && (
                <Button size="sm" onClick={() => setShowAskModal(true)} className="gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Ask a Question
                </Button>
              )}
            </div>
            {questions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No questions yet.{!isOverdue && ' Use the button above to ask one.'}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {questions.map((q) => (
                  <div key={q.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{q.subject}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(q.created_at).toLocaleDateString('en-NZ')}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${q.status === 'Answered' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {q.status}
                      </span>
                    </div>
                    {q.description && (
                      <p className="text-sm text-muted-foreground bg-muted/30 rounded p-3">{q.description}</p>
                    )}
                    {(q.tender_rfi_responses || []).length > 0 && (
                      <div className="space-y-2 pl-4 border-l-2 border-primary/20">
                        {(q.tender_rfi_responses || []).map((r) => (
                          <div key={r.id} className="bg-blue-50 rounded p-3">
                            <p className="text-xs font-medium text-blue-700">{r.author_name || 'Issued By'}</p>
                            <p className="text-sm mt-1">{r.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Ask Question Modal */}
          {showAskModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-background rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Ask a Question</h3>
                  <button onClick={() => setShowAskModal(false)}><X className="w-4 h-4" /></button>
                </div>
                <div>
                  <Label className="text-xs">Subject *</Label>
                  <Input
                    value={askForm.subject}
                    onChange={e => setAskForm(f => ({ ...f, subject: e.target.value }))}
                    placeholder="Brief summary of your question"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Details (optional)</Label>
                  <Textarea
                    value={askForm.description}
                    onChange={e => setAskForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Provide any additional context..."
                    rows={4}
                    className="mt-1"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowAskModal(false)}>Cancel</Button>
                  <Button onClick={handleAskQuestion} disabled={!askForm.subject.trim() || askSubmitting}>
                    {askSubmitting ? 'Submitting...' : 'Submit Question'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── SUBMIT TAB ── */}
          {!isOverdue && (
            <TabsContent value="submit">
              <div className="max-w-xl space-y-5">
                {submitted && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    Your submission was received. You can update it below until the closing date.
                  </div>
                )}

                <div className="border rounded-lg p-5 bg-card space-y-4">
                  <h3 className="font-semibold">Your Submission</h3>
                  {/* ── Pricing ─────────────────────────────────────── */}
                  <div className="space-y-2">
                    <Label>Pricing</Label>
                    <p className="text-xs text-muted-foreground">Enter a lump sum or break your price down by line item. Total is auto-calculated.</p>

                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_140px_28px] gap-2 px-1">
                      <span className="text-xs text-muted-foreground">Description</span>
                      <span className="text-xs text-muted-foreground">Amount (NZD)</span>
                      <span />
                    </div>

                    {/* Lines */}
                    <div className="space-y-2">
                      {priceLines.map((line, idx) => (
                        <div key={line.id} className="grid grid-cols-[1fr_140px_28px] gap-2 items-center">
                          <input
                            className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            value={line.description}
                            placeholder="Description"
                            onChange={e => setPriceLines(prev => prev.map(l => l.id === line.id ? { ...l, description: e.target.value } : l))}
                          />
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <input
                              type="number" min="0" step="0.01"
                              className="h-8 w-full rounded-md border border-input bg-background pl-6 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              value={line.amount}
                              placeholder="0.00"
                              onChange={e => setPriceLines(prev => prev.map(l => l.id === line.id ? { ...l, amount: e.target.value } : l))}
                            />
                          </div>
                          {priceLines.length > 1 ? (
                            <button
                              className="w-7 h-7 flex items-center justify-center rounded-md border border-input hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              onClick={() => setPriceLines(prev => prev.filter(l => l.id !== line.id))}
                              title="Remove line"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : <span />}
                        </div>
                      ))}
                    </div>

                    {/* Add line */}
                    <button
                      className="flex items-center gap-1.5 text-xs text-primary border border-dashed border-primary/40 bg-primary/5 rounded-md px-3 py-1.5 hover:bg-primary/10"
                      onClick={() => setPriceLines(prev => [...prev, { id: Date.now(), description: '', amount: '' }])}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add price line
                    </button>

                    {/* Total */}
                    {priceLines.length > 1 && (
                      <div className="flex justify-between items-center border-t pt-2 mt-1">
                        <span className="text-sm font-medium text-muted-foreground">Total</span>
                        <span className="text-base font-semibold">
                          ${priceLines.reduce((s, l) => s + (Number(l.amount) || 0), 0).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ── Pricing Documents ────────────────────────── */}
                  <div className="space-y-2">
                    <Label>Pricing Documents (optional)</Label>
                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                      <span className="inline-flex items-center gap-1.5 text-xs border border-input rounded-md px-3 py-1.5 hover:bg-muted">
                        <FileText className="w-3.5 h-3.5" /> Choose files
                      </span>
                      <input type="file" accept=".pdf,.xlsx,.xls,.doc,.docx" multiple className="sr-only" onChange={handleFileSelect} />
                    </label>
                    {pricingFiles.length > 0 && (
                      <div className="space-y-1.5">
                        {pricingFiles.map(f => (
                          <div key={f.id} className={`flex items-center gap-2 text-xs rounded-md px-2.5 py-1.5 ${
                            f.status === 'done'     ? 'bg-green-50 text-green-800 border border-green-200' :
                            f.status === 'error'    ? 'bg-red-50 text-red-800 border border-red-200' :
                                                      'bg-muted text-muted-foreground border border-input'
                          }`}>
                            {f.status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
                            {f.status === 'done'      && <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-green-600" />}
                            {f.status === 'error'     && <AlertCircle className="w-3 h-3 flex-shrink-0 text-red-500" />}
                            <span className="flex-1 truncate">{f.file_name}</span>
                            {f.status === 'error' && (
                              <button className="flex items-center gap-0.5 text-red-700 hover:underline" onClick={() => uploadSingleFile(f)}>
                                <RefreshCw className="w-3 h-3" /> Retry
                              </button>
                            )}
                            {f.status !== 'uploading' && (
                              <button onClick={() => setPricingFiles(prev => prev.filter(p => p.id !== f.id))} className="hover:text-destructive ml-1">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>Notes / Qualifications</Label>
                    <Textarea value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      rows={4} placeholder="Any notes, assumptions, exclusions or qualifications..."
                      className="mt-1.5" />
                  </div>

                  {submitError && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" /> {submitError}
                    </div>
                  )}

                  <Button onClick={handleSubmit}
                    disabled={submitting || pricingFiles.some(f => f.status === 'uploading') || !priceLines.some(l => Number(l.amount) > 0)}
                    className="w-full" size="lg">
                    {submitting ? 'Submitting...' : submitted ? 'Update My Submission' : 'Submit My Pricing'}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    By submitting you confirm this is your pricing for {tender.title}
                    {tender.closing_date && `, closing ${fmtDate(tender.closing_date)}`}.
                    {' '}By submitting, you agree to ConstructIQ's{' '}
                    <a href="/terms" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Terms of Use</a>
                    {' '}and{' '}
                    <a href="/privacy" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Privacy Policy</a>.
                  </p>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PortalHeader({ tender, invitee, isOverdue, branding, onSubmitClick, showSubmitBtn }) {
  return (
    <div className="bg-card border-b shadow-sm">
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {branding?.logo_url ? (
              <img src={branding.logo_url} alt={branding.company_name || 'Logo'} className="h-10 w-auto object-contain flex-shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                <HardHat className="w-5 h-5 text-primary-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-bold text-lg leading-tight truncate">{tender?.title}</h1>
              <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground flex-wrap">
                {tender?.tender_number && (
                  <span className="font-mono text-xs">{tender.tender_number}</span>
                )}
                {tender?.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />{tender.location}
                  </span>
                )}
                {tender?.closing_date && (
                  <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                    <Calendar className="w-3 h-3" />
                    {isOverdue
                      ? 'Tender closed'
                      : `Due ${format(parseISO(tender.closing_date.split('T')[0]), 'dd MMM yyyy')}`}
                  </span>
                )}
              </div>
            </div>
          </div>
          {showSubmitBtn && (
            <Button onClick={onSubmitClick} className="flex-shrink-0 bg-orange-500 hover:bg-orange-600 text-white">
              Submit a tender
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoField({ label, value, highlight }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-medium mt-0.5 ${highlight === 'red' ? 'text-red-600' : ''}`}>{value}</p>
    </div>
  );
}

function ContactCard({ name, email, phone, label }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
        <Building2 className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-sm">
        {label && <p className="text-xs text-muted-foreground">{label}</p>}
        <p className="font-medium">{name}</p>
        {email && (
          <a href={`mailto:${email}`} className="flex items-center gap-1 text-primary hover:underline text-xs mt-0.5">
            <Mail className="w-3 h-3" /> {email}
          </a>
        )}
        {phone && (
          <a href={`tel:${phone}`} className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-xs mt-0.5">
            <Phone className="w-3 h-3" /> {phone}
          </a>
        )}
      </div>
    </div>
  );
}
