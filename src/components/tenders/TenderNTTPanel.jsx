/**
 * TenderNTTPanel — Notice to Tenderers management tab
 * ADDITIVE: does not modify any existing tender, document, invitation or submission logic.
 */
import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeFunction, uploadFile } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Send, Archive, ChevronDown, ChevronUp, ChevronRight, AlertTriangle, CheckCircle2, Upload, X, Pencil, Paperclip, Download, Trash2, FolderClosed, FolderOpen } from 'lucide-react';
import { buildTree as buildDocTree } from '@/components/tenders/DocTable';
import { format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';

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
  const { toast } = useToast();

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
  const [confirmDelete, setConfirmDelete] = useState(null); // notice object
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
      toast({ variant: 'destructive', title: 'Failed to issue NTT', description: e?.message || 'Unknown error' });
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
      toast({ variant: 'destructive', title: 'Failed to archive', description: e?.message || 'Unknown error' });
    } finally {
      setWorking(false);
      setConfirmArchive(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setWorking(true);
    try {
      await invokeFunction('issueNTT', { action: 'deleteNotice', noticeId: confirmDelete.id });
      queryClient.invalidateQueries({ queryKey: ['tenderNotices', tender.id] });
      toast({ title: `${confirmDelete.notice_number} deleted` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed to delete draft', description: e?.message || 'Unknown error' });
    } finally {
      setWorking(false);
      setConfirmDelete(null);
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
      toast({ variant: 'destructive', title: 'Retry failed', description: e?.message || 'Unknown error' });
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
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2.5 bg-muted/40 border-b text-xs font-medium text-muted-foreground">
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
              {/* Phones: number · status · actions, then title, then type · issued (order-* below md) */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:grid md:grid-cols-12 md:gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                <div className="order-1 md:order-none md:col-span-2">
                  <span className="font-mono text-xs font-semibold text-primary">
                    {notice.notice_number}
                  </span>
                </div>
                <div className="order-4 basis-full md:basis-auto md:order-none md:col-span-4">
                  <button className="text-sm font-medium text-left hover:text-primary transition-colors flex items-center gap-1"
                    onClick={() => setExpandedId(expandedId === notice.id ? null : notice.id)}>
                    {notice.title}
                    {expandedId === notice.id
                      ? <ChevronUp className="w-3 h-3 flex-shrink-0" />
                      : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
                  </button>
                </div>
                <div className="order-5 md:order-none md:col-span-2">
                  <span className="text-xs text-muted-foreground">{notice.notice_type}</span>
                </div>
                <div className="order-2 md:order-none md:col-span-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${STATUS_COLOURS[notice.status] || ''}`}>
                    {notice.status}
                  </span>
                </div>
                <div className="order-6 md:order-none md:col-span-2">
                  <span className="text-xs text-muted-foreground">
                    {notice.issue_date ? format(new Date(notice.issue_date), 'dd MMM yyyy') : '—'}
                  </span>
                </div>
                <div className="order-3 ml-auto md:ml-0 md:order-none md:col-span-1 flex justify-end gap-1">
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
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete draft" onClick={() => setConfirmDelete(notice)}>
                        <Trash2 className="w-3.5 h-3.5" />
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

      {/* Confirm Delete */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.notice_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the draft notice and its attachment list. Nothing has been
              sent to invitees. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={working} className="bg-destructive hover:bg-destructive/90">
              {working ? 'Deleting...' : 'Delete Draft'}
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

// ── Shared create/edit form ───────────────────────────────────────────────────
// Used by both CreateNTTDialog and EditNTTDialog so they can't drift apart again.
// `value.attachments` is the single source of truth for the notice's final attachment
// list — newly uploaded files and ticked existing tender documents both land in it,
// and removing one (X) works the same regardless of where it came from.

function NTTForm({ value, onChange, tender, uploading, setUploading }) {
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);
  const tenderDocs = tender?.documents || [];

  const patch = (p) => onChange({ ...value, ...p });

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadError('');
    try {
      const results = [];
      for (const file of files) {
        // NTT attachments are sent to suppliers and viewed on the public portal —
        // keep them in the public Documents bucket (permanent public URL).
        const { file_url } = await uploadFile(file, 'Documents');
        results.push({ file_url, file_name: file.name });
      }
      patch({ attachments: [...value.attachments, ...results] });
    } catch (e) {
      setUploadError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (fileUrl) =>
    patch({ attachments: value.attachments.filter(a => a.file_url !== fileUrl) });

  const selectedUrls = useMemo(
    () => new Set(value.attachments.map(a => a.file_url)),
    [value.attachments],
  );

  // Adds or removes a batch of tender docs at once: one file, or a whole folder
  // (its subfolders included). Adding skips anything already attached.
  const setTenderDocs = (docs, select) => {
    const urls = new Set(docs.map(d => d.file_url));
    if (!select) {
      patch({ attachments: value.attachments.filter(a => !urls.has(a.file_url)) });
      return;
    }
    const seen = new Set(selectedUrls);
    const added = [];
    for (const d of docs) {
      if (seen.has(d.file_url)) continue;
      seen.add(d.file_url);
      added.push({ file_url: d.file_url, file_name: d.name });
    }
    patch({ attachments: [...value.attachments, ...added] });
  };

  return (
    <>
      <div>
        <Label>Title *</Label>
        <Input value={value.title} onChange={e => patch({ title: e.target.value })}
          placeholder="e.g. Clarification on Structural Drawings" className="mt-1" />
      </div>
      <div>
        <Label>Notice Type *</Label>
        <Select value={value.noticeType} onValueChange={v => patch({ noticeType: v })}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Select type..." /></SelectTrigger>
          <SelectContent>
            {NOTICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Description</Label>
        <Textarea value={value.description}
          onChange={e => patch({ description: e.target.value })}
          rows={5} placeholder="Describe the notice in full..." className="mt-1" />
      </div>

      {value.noticeType === 'Closing Date Extension' && (
        <div>
          <Label>Proposed New Closing Date</Label>
          <Input type="date" value={value.proposedNewCloseDate}
            onChange={e => patch({ proposedNewCloseDate: e.target.value })}
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
        {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
      </div>

      {/* Select from existing tender docs. Sits ABOVE the attachments list so ticking
          a file never pushes the picker down the dialog while you're working in it. */}
      {tenderDocs.length > 0 && (
        <div>
          <Label>Or select from existing tender documents</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Tick a folder to attach everything in it.</p>
          <TenderDocPicker docs={tenderDocs} selectedUrls={selectedUrls} onSetDocs={setTenderDocs} />
        </div>
      )}

      {/* Current attachments — uploaded files + ticked existing tender documents */}
      {value.attachments.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label>Attachments ({value.attachments.length})</Label>
            <button type="button" onClick={() => patch({ attachments: [] })}
              className="text-xs text-muted-foreground hover:text-red-600">
              Remove all
            </button>
          </div>
          <div className="mt-1 space-y-1 max-h-40 overflow-y-auto pr-1">
            {value.attachments.map((f, i) => (
              <div key={f.file_url || i} className="flex items-center justify-between gap-2 text-xs bg-green-50 border border-green-200 rounded px-2 py-1.5">
                <span className="text-green-800 break-all">{f.file_name}</span>
                <button type="button" onClick={() => removeAttachment(f.file_url)}
                  aria-label={`Remove ${f.file_name}`}
                  className="text-green-600 hover:text-red-500 flex-shrink-0">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Tender document picker (folder tree) ──────────────────────────────────────
// Same folders as the tender's Documents tab (folder_path). Each folder has a
// tick box that attaches or removes every file under it, subfolders included.
// Folders start collapsed (unless something inside is already attached) so a
// tender with hundreds of photos stays a short list.

function docsUnder(node) {
  const out = node.files.map(f => f.doc);
  for (const child of node.children.values()) out.push(...docsUnder(child));
  return out;
}

function TenderDocPicker({ docs, selectedUrls, onSetDocs }) {
  const tree = useMemo(() => buildDocTree(docs), [docs]);
  return (
    <div className="mt-1 border rounded-lg max-h-[40vh] overflow-y-auto py-1">
      <PickerFolderContents node={tree} depth={0} selectedUrls={selectedUrls} onSetDocs={onSetDocs} />
    </div>
  );
}

function PickerFolderContents({ node, depth, selectedUrls, onSetDocs }) {
  const childKeys = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
  return (
    <>
      {childKeys.map(key => (
        <PickerFolder key={key} node={node.children.get(key)} depth={depth}
          selectedUrls={selectedUrls} onSetDocs={onSetDocs} />
      ))}
      {node.files.map(({ doc, idx }) => (
        <label key={idx} className="flex items-center gap-2 pr-3 py-1.5 cursor-pointer hover:bg-muted/30"
          style={{ paddingLeft: `${depth * 20 + 12}px` }}>
          <input type="checkbox" checked={selectedUrls.has(doc.file_url)}
            onChange={(e) => onSetDocs([doc], e.target.checked)} className="rounded flex-shrink-0" />
          <span className="text-sm break-all">{doc.name}</span>
        </label>
      ))}
    </>
  );
}

function PickerFolder({ node, depth, selectedUrls, onSetDocs }) {
  const folderDocs = useMemo(() => docsUnder(node), [node]);
  const selectedCount = folderDocs.filter(d => selectedUrls.has(d.file_url)).length;
  const all  = folderDocs.length > 0 && selectedCount === folderDocs.length;
  const some = selectedCount > 0 && !all;
  const [open, setOpen] = useState(selectedCount > 0);

  return (
    <>
      <div className="flex items-center gap-2 pr-3 py-1.5 hover:bg-muted/30"
        style={{ paddingLeft: `${depth * 20 + 12}px` }}>
        <input type="checkbox" checked={all}
          ref={el => { if (el) el.indeterminate = some; }}
          onChange={() => onSetDocs(folderDocs, !all)}
          aria-label={`${all ? 'Remove' : 'Attach'} everything in ${node.name}`}
          className="rounded flex-shrink-0" />
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-sm font-medium">
          {open
            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
          {open
            ? <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
            : <FolderClosed className="w-4 h-4 text-amber-500 flex-shrink-0" />}
          <span className="truncate">{node.name}</span>
          <span className="text-xs font-normal text-muted-foreground flex-shrink-0">
            {selectedCount > 0 ? `${selectedCount} of ${folderDocs.length}` : `(${folderDocs.length})`}
          </span>
        </button>
      </div>
      {open && (
        <PickerFolderContents node={node} depth={depth + 1} selectedUrls={selectedUrls} onSetDocs={onSetDocs} />
      )}
    </>
  );
}

// Sits between the scrolling form and the footer so a save error is always on
// screen. Inside the scroll area it landed under the document list, below the
// fold, and a failed Save looked like the button did nothing.
function DialogErrorBar({ error }) {
  if (!error) return null;
  return (
    <div role="alert" className="mx-6 mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm shrink-0">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
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
    attachments:          (notice.attachments || []).map(a => ({ file_url: a.file_url, file_name: a.file_name })),
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const handleSave = async () => {
    if (!form.title || !form.noticeType) { setError('Title and notice type are required.'); return; }
    setSaving(true); setError('');
    try {
      await invokeFunction('issueNTT', {
        action:      'updateNotice',
        noticeId:    notice.id,
        title:       form.title,
        description: form.description || null,
        noticeType:  form.noticeType,
        proposedNewCloseDate: form.noticeType === 'Closing Date Extension' ? form.proposedNewCloseDate || null : null,
        attachments: form.attachments,
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
      <DialogContent className="w-[95vw] max-w-none sm:max-w-2xl max-h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>Edit Draft — {notice.notice_number}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <NTTForm value={form} onChange={setForm} tender={tender} uploading={uploading} setUploading={setUploading} />
        </div>

        <DialogErrorBar error={error} />

        <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving || uploading}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || uploading || !form.title || !form.noticeType}>
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
    title: '', description: '', noticeType: '', proposedNewCloseDate: '', attachments: [],
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const handleSaveDraft = async () => {
    if (!form.title || !form.noticeType) { setError('Title and notice type are required.'); return; }
    setSaving(true); setError('');
    try {
      await invokeFunction('issueNTT', {
        action:      'createNotice',
        tenderId:    tender.id,
        title:       form.title,
        description: form.description,
        noticeType:  form.noticeType,
        attachments: form.attachments,
        proposedNewCloseDate: form.noticeType === 'Closing Date Extension' ? form.proposedNewCloseDate || null : null,
      });
      onCreated();
    } catch (e) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[95vw] max-w-none sm:max-w-2xl max-h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>Create Notice to Tenderers</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <Label>Notice Number</Label>
            <Input value="Auto-generated" disabled className="bg-muted text-muted-foreground mt-1" />
          </div>
          <NTTForm value={form} onChange={setForm} tender={tender} uploading={uploading} setUploading={setUploading} />
        </div>

        <DialogErrorBar error={error} />

        <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving || uploading}>Cancel</Button>
          <Button onClick={handleSaveDraft} disabled={saving || uploading || !form.title || !form.noticeType}>
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
