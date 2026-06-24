/**
 * TenderNTTPanel — Notice to Tenderers management tab
 * ADDITIVE: does not modify any existing tender, document, invitation or submission logic.
 */
import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TenderNotice, TenderNoticeAttachment, Document as DocEntity } from '@/api/entities';
import { invokeFunction, uploadFile } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Send, Archive, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Upload, X, Pencil, Paperclip, Download } from 'lucide-react';
import { format } from 'date-fns';

const NOTICE_TYPES = [
  'Clarification',
  'Additional Information',
  'Revised Documents',
  'Scope Change',
  'Closing Date Extension',
];

const STATUS_COLOURS = {
  Draft:    'bg-yellow-100 text-yellow-800 border-yellow-200',
  Issued:   'bg-green-100 text-green-800 border-green-200',
  Archived: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function TenderNTTPanel({ tender, canManage }) {
  const queryClient = useQueryClient();

  const { data: notices = [], isLoading, isError, error } = useQuery({
    queryKey: ['tenderNotices', tender.id],
    queryFn: async () => {
      const { supabase } = await import('@/api/supabaseClient');
      const { data, error: qErr } = await supabase
        .from('tender_notices')
        .select('*, tender_notice_attachments(id, file_url, file_name)')
        .eq('tender_id', tender.id)
        .order('created_at', { ascending: false });
      if (qErr) throw qErr;
      return (data || []).map(n => ({ ...n, attachments: n.tender_notice_attachments || [] }));
    },
    enabled:  !!tender.id,
    retry: 1,
  });

  const [search, setSearch]           = useState('');
  const [showCreate, setShowCreate]   = useState(false);
  const [expandedId, setExpandedId]   = useState(null);
  const [editNotice, setEditNotice]     = useState(null);   // notice object to edit
  const [confirmIssue, setConfirmIssue] = useState(null);   // noticeId
  const [confirmArchive, setConfirmArchive] = useState(null); // noticeId
  const [confirmDateUpdate, setConfirmDateUpdate] = useState(null); // { noticeId, tenderId, date }
  const [issueResult, setIssueResult] = useState(null);     // { sent, failed, recipients }
  const [working, setWorking]         = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return notices.filter(n =>
      !q ||
      n.notice_number?.toLowerCase().includes(q) ||
      n.title?.toLowerCase().includes(q) ||
      n.notice_type?.toLowerCase().includes(q) ||
      n.status?.toLowerCase().includes(q)
    );
  }, [notices, search]);

  const handleIssue = async () => {
    if (!confirmIssue) return;
    setWorking(true);
    try {
      const res = await invokeFunction('issueNTT', { action: 'issueNotice', noticeId: confirmIssue });
      queryClient.invalidateQueries({ queryKey: ['tenderNotices', tender.id] });

      const notice = notices.find(n => n.id === confirmIssue);
      // If Closing Date Extension and has a proposed new close date — ask user to confirm date update
      if (notice?.notice_type === 'Closing Date Extension' && notice.proposed_new_close_date) {
        setConfirmDateUpdate({ noticeId: confirmIssue, tenderId: tender.id, date: notice.proposed_new_close_date });
      }

      setIssueResult({
        sent:       res.data.emails_sent || 0,
        failed:     res.data.emails_failed || 0,
        recipients: res.data.failed_recipients || [],
        noticeId:   confirmIssue,
      });
    } catch (e) {
      alert(`Failed to issue NTT: ${e?.message || 'Unknown error'}`);
    } finally {
      setWorking(false);
      setConfirmIssue(null);
    }
  };

  const handleArchive = async () => {
    if (!confirmArchive) return;
    setWorking(true);
    try {
      await invokeFunction('issueNTT', { action: 'archiveNotice', noticeId: confirmArchive });
      queryClient.invalidateQueries({ queryKey: ['tenderNotices', tender.id] });
    } catch (e) {
      alert(`Failed to archive: ${e?.message}`);
    } finally {
      setWorking(false);
      setConfirmArchive(null);
    }
  };

  const handleDateUpdate = async (confirm) => {
    if (confirm && confirmDateUpdate) {
      await invokeFunction('issueNTT', {
        action:      'updateCloseDate',
        tenderId:    confirmDateUpdate.tenderId,
        newCloseDate: confirmDateUpdate.date,
        noticeId:    confirmDateUpdate.noticeId,
      });
      queryClient.invalidateQueries({ queryKey: ['tender', tender.id] });
    }
    setConfirmDateUpdate(null);
  };

  const handleRetry = async (noticeId, recipients) => {
    try {
      const res = await invokeFunction('issueNTT', { action: 'retryEmails', noticeId, recipients });
      setIssueResult(prev => ({
        ...prev,
        sent:   (prev?.sent || 0) + (res.data.emails_sent || 0),
        failed: res.data.emails_failed || 0,
        recipients: [],
      }));
    } catch (e) {
      alert(`Retry failed: ${e?.message}`);
    }
  };

  if (isLoading) {
    return <div className="py-10 text-center text-muted-foreground text-sm">Loading notices...</div>;
  }

  if (isError) {
    return (
      <div className="py-10 text-center space-y-2">
        <p className="text-sm font-medium text-destructive">Failed to load NTTs</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">{error?.message || 'Permission denied or table missing'}</p>
        <p className="text-xs text-muted-foreground">Run the SQL in the schema migration to create the <code>tender_notices</code> table and RLS policies.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1">
          <Input placeholder="Search by number, title, type or status..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="max-w-sm h-9 text-sm" />
        </div>
        {canManage && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Create NTT
          </Button>
        )}
      </div>

      {/* Issue result banner */}
      {issueResult && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border text-sm ${issueResult.failed > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${issueResult.failed > 0 ? 'text-amber-600' : 'text-green-600'}`} />
          <div className="flex-1">
            <p className={`font-medium ${issueResult.failed > 0 ? 'text-amber-800' : 'text-green-800'}`}>
              NTT issued — {issueResult.sent} email{issueResult.sent !== 1 ? 's' : ''} sent
              {issueResult.failed > 0 && `, ${issueResult.failed} failed`}
            </p>
            {issueResult.failed > 0 && issueResult.recipients.length > 0 && (
              <div className="mt-1">
                <p className="text-amber-700 text-xs">Failed: {issueResult.recipients.join(', ')}</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs"
                  onClick={() => handleRetry(issueResult.noticeId, issueResult.recipients)}>
                  Retry Failed Emails
                </Button>
              </div>
            )}
          </div>
          <button className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setIssueResult(null)}>Dismiss</button>
        </div>
      )}

      {/* NTT Register */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {notices.length === 0
            ? 'No notices have been created yet. Click "Create NTT" to get started.'
            : 'No notices match your search.'}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-3 px-4 py-2.5 bg-muted/40 border-b text-xs font-medium text-muted-foreground">
            <div className="col-span-2">Number</div>
            <div className="col-span-4">Title</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Issued</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          {filtered.map((notice) => (
            <div key={notice.id} className="border-b last:border-0">
              {/* Row */}
              <div className="grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-muted/20 transition-colors">
                <div className="col-span-2">
                  <span className="font-mono text-xs font-semibold text-primary">
                    {notice.notice_number}
                  </span>
                </div>
                <div className="col-span-4">
                  <button className="text-sm font-medium text-left hover:text-primary transition-colors flex items-center gap-1"
                    onClick={() => setExpandedId(expandedId === notice.id ? null : notice.id)}>
                    {notice.title}
                    {expandedId === notice.id
                      ? <ChevronUp className="w-3 h-3 flex-shrink-0" />
                      : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
                  </button>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">{notice.notice_type}</span>
                </div>
                <div className="col-span-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${STATUS_COLOURS[notice.status] || ''}`}>
                    {notice.status}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">
                    {notice.issue_date ? format(new Date(notice.issue_date), 'dd MMM yyyy') : '—'}
                  </span>
                </div>
                <div className="col-span-1 flex justify-end gap-1">
                  {canManage && notice.status === 'Draft' && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:bg-muted"
                        title="Edit draft" onClick={() => setEditNotice(notice)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/10"
                        title="Issue NTT" onClick={() => setConfirmIssue(notice.id)}>
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                  {canManage && notice.status === 'Issued' && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:bg-muted"
                      title="Archive" onClick={() => setConfirmArchive(notice.id)}>
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === notice.id && (
                <div className="px-4 pb-4 pt-3 bg-muted/10 border-t text-sm space-y-3">
                  {notice.description && (
                    <p className="text-muted-foreground whitespace-pre-wrap">{notice.description}</p>
                  )}
                  {notice.notice_type === 'Closing Date Extension' && notice.proposed_new_close_date && (
                    <p className="text-xs text-muted-foreground">
                      Proposed new close date: <strong>{notice.proposed_new_close_date}</strong>
                    </p>
                  )}
                  {notice.issued_by && (
                    <p className="text-xs text-muted-foreground">Issued by: {notice.issued_by}</p>
                  )}
                  {notice.attachments?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
                        <Paperclip className="w-3 h-3" /> Attachments ({notice.attachments.length})
                      </p>
                      <div className="space-y-1">
                        {notice.attachments.map(att => (
                          <a
                            key={att.id}
                            href={att.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-primary hover:underline bg-white border rounded px-3 py-2"
                          >
                            <Download className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{att.file_name}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateNTTDialog
          tender={tender}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['tenderNotices', tender.id] });
          }}
        />
      )}

      {editNotice && (
        <EditNTTDialog
          tender={tender}
          notice={editNotice}
          onClose={() => setEditNotice(null)}
          onSaved={() => {
            setEditNotice(null);
            queryClient.invalidateQueries({ queryKey: ['tenderNotices', tender.id] });
          }}
        />
      )}

      {/* Confirm Issue */}
      <AlertDialog open={!!confirmIssue} onOpenChange={(o) => !o && setConfirmIssue(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Issue this NTT?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send the notice to all active invitees. Once issued, it cannot be deleted — only archived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleIssue} disabled={working}>
              {working ? 'Issuing...' : 'Issue NTT'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Archive */}
      <AlertDialog open={!!confirmArchive} onOpenChange={(o) => !o && setConfirmArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this NTT?</AlertDialogTitle>
            <AlertDialogDescription>
              The notice will be archived and hidden from the portal. Historical records are maintained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} disabled={working} className="bg-destructive hover:bg-destructive/90">
              {working ? 'Archiving...' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm close date update */}
      <AlertDialog open={!!confirmDateUpdate} onOpenChange={(o) => !o && handleDateUpdate(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Tender Close Date?</AlertDialogTitle>
            <AlertDialogDescription>
              This NTT proposes a new closing date of <strong>{confirmDateUpdate?.date}</strong>.
              Would you like to update the tender's closing date to match?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleDateUpdate(false)}>No, keep current date</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDateUpdate(true)}>Yes, update close date</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Edit NTT Dialog (Draft only) ──────────────────────────────────────────────

function EditNTTDialog({ tender, notice, onClose, onSaved }) {
  const [form, setForm] = useState({
    title:               notice.title || '',
    description:         notice.description || '',
    noticeType:          notice.notice_type || '',
    proposedNewCloseDate: notice.proposed_new_close_date || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const handleSave = async () => {
    if (!form.title || !form.noticeType) { setError('Title and notice type are required.'); return; }
    setSaving(true); setError('');
    try {
      await TenderNotice.update(notice.id, {
        title:                   form.title,
        description:             form.description || null,
        notice_type:             form.noticeType,
        proposed_new_close_date: form.noticeType === 'Closing Date Extension' ? form.proposedNewCloseDate || null : null,
        updated_at:              new Date().toISOString(),
      });
      onSaved();
    } catch (e) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Draft — {notice.notice_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Title *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Clarification on Structural Drawings" className="mt-1" />
          </div>
          <div>
            <Label>Notice Type *</Label>
            <Select value={form.noticeType} onValueChange={v => setForm(f => ({ ...f, noticeType: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select type..." /></SelectTrigger>
              <SelectContent>
                {NOTICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={5} placeholder="Describe the notice in full..." className="mt-1" />
          </div>
          {form.noticeType === 'Closing Date Extension' && (
            <div>
              <Label>Proposed New Closing Date</Label>
              <Input type="date" value={form.proposedNewCloseDate}
                onChange={e => setForm(f => ({ ...f, proposedNewCloseDate: e.target.value }))}
                className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">
                Current close date: {tender.closing_date?.split('T')[0] || '—'}
              </p>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.title || !form.noticeType}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create NTT Dialog ─────────────────────────────────────────────────────────

function CreateNTTDialog({ tender, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '', noticeType: '', proposedNewCloseDate: '',
  });
  const [attachments, setAttachments]     = useState([]); // existing tender docs selected
  const [uploadedFiles, setUploadedFiles] = useState([]); // newly uploaded files
  const [uploading, setUploading]         = useState(false);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');
  const fileInputRef                      = useRef(null);

  const tenderDocs = tender?.documents || [];

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError('');
    try {
      const results = [];
      for (const file of files) {
        const { file_url } = await uploadFile(file);
        results.push({ file_url, file_name: file.name });
      }
      setUploadedFiles(prev => [...prev, ...results]);
    } catch (e) {
      setError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeUploadedFile = (idx) =>
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx));

  const handleSaveDraft = async () => {
    if (!form.title || !form.noticeType) { setError('Title and notice type are required.'); return; }
    setSaving(true); setError('');
    try {
      const allAttachments = [
        ...attachments,
        ...uploadedFiles,
      ];
      await invokeFunction('issueNTT', {
        action:      'createNotice',
        tenderId:    tender.id,
        title:       form.title,
        description: form.description,
        noticeType:  form.noticeType,
        attachments: allAttachments,
        proposedNewCloseDate: form.noticeType === 'Closing Date Extension' ? form.proposedNewCloseDate || null : null,
      });
      onCreated();
    } catch (e) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleAttachment = (doc) => {
    setAttachments(prev => {
      const exists = prev.find(a => a.file_url === doc.file_url);
      return exists ? prev.filter(a => a.file_url !== doc.file_url) : [...prev, { file_url: doc.file_url, file_name: doc.name }];
    });
  };

  const totalAttachments = attachments.length + uploadedFiles.length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Notice to Tenderers</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Notice Number</Label>
            <Input value="Auto-generated" disabled className="bg-muted text-muted-foreground mt-1" />
          </div>
          <div>
            <Label>Title *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Clarification on Structural Drawings" className="mt-1" />
          </div>
          <div>
            <Label>Notice Type *</Label>
            <Select value={form.noticeType} onValueChange={v => setForm(f => ({ ...f, noticeType: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select type..." /></SelectTrigger>
              <SelectContent>
                {NOTICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={4} placeholder="Describe the notice in full..." className="mt-1" />
          </div>

          {form.noticeType === 'Closing Date Extension' && (
            <div>
              <Label>Proposed New Closing Date</Label>
              <Input type="date" value={form.proposedNewCloseDate}
                onChange={e => setForm(f => ({ ...f, proposedNewCloseDate: e.target.value }))}
                className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">
                Current close date: {tender.closing_date?.split('T')[0] || '—'}
              </p>
            </div>
          )}

          {/* Upload new documents */}
          <div>
            <Label>Upload New Documents</Label>
            <div className="mt-1 border-2 border-dashed rounded-lg p-3 text-center">
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUpload} />
              <Button type="button" variant="outline" size="sm" className="gap-2"
                onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading...' : 'Choose files'}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">Files will be stored under the NTT folder</p>
            </div>
            {uploadedFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {uploadedFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-green-50 border border-green-200 rounded px-2 py-1">
                    <span className="text-green-800 truncate">{f.file_name}</span>
                    <button onClick={() => removeUploadedFile(i)} className="text-green-600 hover:text-red-500 ml-2 flex-shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Select from existing tender docs */}
          {tenderDocs.length > 0 && (
            <div>
              <Label>Or select from existing tender documents</Label>
              <div className="mt-1 border rounded-lg divide-y max-h-36 overflow-y-auto">
                {tenderDocs.map((doc, i) => {
                  const selected = attachments.some(a => a.file_url === doc.file_url);
                  return (
                    <label key={i} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30">
                      <input type="checkbox" checked={selected} onChange={() => toggleAttachment(doc)} className="rounded" />
                      <span className="text-sm truncate">{doc.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {totalAttachments > 0 && (
            <p className="text-xs text-muted-foreground">
              {totalAttachments} attachment{totalAttachments !== 1 ? 's' : ''} total
            </p>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving || uploading}>Cancel</Button>
          <Button onClick={handleSaveDraft} disabled={saving || uploading || !form.title || !form.noticeType}>
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
