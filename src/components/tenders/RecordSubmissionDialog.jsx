/**
 * RecordSubmissionDialog — lets an admin/pricing user record pricing that a
 * subcontractor sent outside the portal (email, phone, in person). Works after
 * a tender has closed — that's the entire point (see recordSubmission edge
 * function). Create mode picks an invitee (or adds one inline); edit mode
 * updates an already-recorded submission.
 */
import React, { useState } from 'react';
import { invokeFunction } from '@/api/supabaseClient';
import { buildSubmissionPayload, validateManualSubmission, isAfterClose } from '@/lib/manualSubmission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, X, FileText, Loader2, CheckCircle2, AlertCircle, RefreshCw, AlertTriangle } from 'lucide-react';

const NEW_INVITEE = '__new__';

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export default function RecordSubmissionDialog({ tender, invitees, submissions = [], submission = null, onClose, onSaved }) {
  const isEdit = !!submission;

  const alreadySubmittedIds = new Set(submissions.filter(s => s.id !== submission?.id).map(s => s.invitee_id));
  const availableInvitees = (invitees || []).filter(inv => !alreadySubmittedIds.has(inv.id));

  const [inviteeId, setInviteeId] = useState(submission?.invitee_id || '');
  const [newInvitee, setNewInvitee] = useState({ fullName: '', businessName: '', email: '', trade: '' });
  const [receivedAt, setReceivedAt] = useState(
    submission?.submitted_at ? submission.submitted_at.split('T')[0] : todayISO()
  );
  const [priceLines, setPriceLines] = useState(
    submission?.price_lines?.length
      ? submission.price_lines.map((l, i) => ({ id: i, description: l.description || '', amount: l.amount ?? '' }))
      : [{ id: 0, description: '', amount: '' }]
  );
  const [notes, setNotes] = useState(submission?.notes || '');
  const [files, setFiles] = useState(
    (submission?.pricing_files || []).map((f, i) => ({
      id: `existing-${i}`, file_name: f.file_name, storage_path: f.storage_path, status: 'done', existing: true,
    }))
  );
  const [notify, setNotify] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedInvitee = availableInvitees.find(i => i.id === inviteeId)
    || (isEdit ? { id: submission.invitee_id, email: submission.invitee_email, full_name: submission.full_name } : null);
  const canNotify = !!selectedInvitee?.email;

  const uploadSingleFile = async (fileEntry) => {
    const { id, file } = fileEntry;
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'uploading', error: null } : f));
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await invokeFunction('recordSubmission', {
        action: 'upload', tenderId: tender.id,
        fileName: file.name, fileData: base64, fileType: file.type,
      });
      setFiles(prev => prev.map(f => f.id === id
        ? { ...f, status: 'done', storage_path: res.data.storage_path, file_name: res.data.file_name }
        : f));
    } catch (err) {
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', error: err?.message || 'Upload failed' } : f));
    }
  };

  const handleFileSelect = async (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    const oversized = picked.find(f => f.size > 500 * 1024 * 1024);
    if (oversized) { setError(`${oversized.name} must be under 500 MB.`); e.target.value = ''; return; }
    const entries = picked.map((file, i) => ({
      id: `new-${Date.now()}-${i}`, file_name: file.name, status: 'uploading', error: null, file,
    }));
    setFiles(prev => [...prev, ...entries]);
    e.target.value = '';
    for (const entry of entries) await uploadSingleFile(entry);
  };

  const removeFile = async (fileEntry) => {
    if (fileEntry.existing && isEdit) {
      try {
        await invokeFunction('recordSubmission', { action: 'removeFile', submissionId: submission.id, storage_path: fileEntry.storage_path });
      } catch (err) {
        setError(err?.message || 'Failed to remove file');
        return;
      }
    }
    setFiles(prev => prev.filter(f => f.id !== fileEntry.id));
  };

  const receivedAtISO = receivedAt ? new Date(`${receivedAt}T12:00:00`).toISOString() : null;
  const afterClose = isAfterClose(tender, receivedAtISO);

  const handleSave = async () => {
    setError('');
    if (!inviteeId) { setError('Please select a subcontractor.'); return; }
    if (inviteeId === NEW_INVITEE && !newInvitee.fullName.trim()) {
      setError('Please enter the subcontractor’s name.'); return;
    }
    // inviteeId is always non-empty here (either a real id or NEW_INVITEE), so this
    // only checks price/file readiness — validateManualSubmission's own invitee check
    // is redundant but harmless.
    const validationErr = validateManualSubmission({ inviteeId, priceLines, files });
    if (validationErr) { setError(validationErr); return; }

    setSaving(true);
    try {
      let targetInviteeId = inviteeId;
      if (inviteeId === NEW_INVITEE) {
        const created = await invokeFunction('manageTenderInvitee', {
          action: 'create', tenderId: tender.id,
          fullName: newInvitee.fullName.trim(),
          businessName: newInvitee.businessName.trim(),
          email: newInvitee.email.trim(),
          phone: '',
          trade: newInvitee.trade.trim(),
        });
        targetInviteeId = created.data.invitee.id;
      }

      const payload = buildSubmissionPayload({ priceLines, notes, files, receivedAt: receivedAtISO, notifySubcontractor: notify });
      const doneFiles = payload.files.filter(f => f.status !== 'uploading' && f.status !== 'error').map(f => ({ storage_path: f.storage_path, file_name: f.file_name }));

      const res = await invokeFunction('recordSubmission', {
        action: 'save',
        tenderId: tender.id,
        inviteeId: targetInviteeId,
        submissionId: submission?.id,
        priceLines: payload.priceLines,
        notes: payload.notes,
        files: doneFiles,
        receivedAt: payload.receivedAt,
        notifySubcontractor: payload.notifySubcontractor,
      });

      onSaved?.(res.data.submission);
    } catch (err) {
      setError(err?.message || 'Failed to save submission');
    } finally {
      setSaving(false);
    }
  };

  const anyUploading = files.some(f => f.status === 'uploading');
  const anyErrored = files.some(f => f.status === 'error');
  const total = priceLines.filter(l => l.amount && Number(l.amount) > 0).reduce((s, l) => s + Number(l.amount), 0);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent className="w-[95vw] max-w-none sm:max-w-2xl max-h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>{isEdit ? 'Edit Submission' : 'Record Submission'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {/* Subcontractor */}
          <div className="space-y-1.5">
            <Label>Subcontractor</Label>
            {isEdit ? (
              <p className="text-sm font-medium">{submission.business_name || submission.invitee_name}</p>
            ) : (
              <Select value={inviteeId} onValueChange={setInviteeId}>
                <SelectTrigger><SelectValue placeholder="Select subcontractor" /></SelectTrigger>
                <SelectContent>
                  {availableInvitees.map(inv => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.business_name || inv.full_name}{inv.trade ? ` — ${inv.trade}` : ''}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_INVITEE}>+ Someone not on the invitee list</SelectItem>
                </SelectContent>
              </Select>
            )}
            {inviteeId === NEW_INVITEE && !isEdit && (
              <div className="grid sm:grid-cols-2 gap-2 pt-2">
                <Input placeholder="Full name" value={newInvitee.fullName}
                  onChange={e => setNewInvitee(n => ({ ...n, fullName: e.target.value }))} />
                <Input placeholder="Business name" value={newInvitee.businessName}
                  onChange={e => setNewInvitee(n => ({ ...n, businessName: e.target.value }))} />
                <Input placeholder="Email" type="email" value={newInvitee.email}
                  onChange={e => setNewInvitee(n => ({ ...n, email: e.target.value }))} />
                <Input placeholder="Trade" value={newInvitee.trade}
                  onChange={e => setNewInvitee(n => ({ ...n, trade: e.target.value }))} />
              </div>
            )}
          </div>

          {/* Date received */}
          <div className="space-y-1.5">
            <Label>Date received</Label>
            <Input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} className="w-48" />
          </div>

          {afterClose && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                This tender closed{tender.closing_date ? ` on ${tender.closing_date.split('T')[0]}` : ''}. The submission
                will still be recorded and will be flagged as received after close.
              </span>
            </div>
          )}

          {/* Pricing */}
          <div className="space-y-2">
            <Label>Pricing</Label>
            <div className="grid grid-cols-[1fr_140px_28px] gap-2 px-1">
              <span className="text-xs text-muted-foreground">Description</span>
              <span className="text-xs text-muted-foreground">Amount (NZD)</span>
              <span />
            </div>
            <div className="space-y-2">
              {priceLines.map(line => (
                <div key={line.id} className="grid grid-cols-[1fr_140px_28px] gap-2 items-center">
                  <input
                    className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={line.description} placeholder="Description"
                    onChange={e => setPriceLines(prev => prev.map(l => l.id === line.id ? { ...l, description: e.target.value } : l))}
                  />
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <input
                      type="number" min="0" step="0.01"
                      className="h-8 w-full rounded-md border border-input bg-background pl-6 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={line.amount} placeholder="0.00"
                      onChange={e => setPriceLines(prev => prev.map(l => l.id === line.id ? { ...l, amount: e.target.value } : l))}
                    />
                  </div>
                  {priceLines.length > 1 ? (
                    <button className="w-7 h-7 flex items-center justify-center rounded-md border border-input hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      onClick={() => setPriceLines(prev => prev.filter(l => l.id !== line.id))} title="Remove line">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : <span />}
                </div>
              ))}
            </div>
            <button className="flex items-center gap-1.5 text-xs text-primary border border-dashed border-primary/40 bg-primary/5 rounded-md px-3 py-1.5 hover:bg-primary/10"
              onClick={() => setPriceLines(prev => [...prev, { id: Date.now(), description: '', amount: '' }])}>
              <Plus className="w-3.5 h-3.5" /> Add price line
            </button>
            {priceLines.length > 1 && (
              <div className="flex justify-between items-center border-t pt-2 mt-1">
                <span className="text-sm font-medium text-muted-foreground">Total</span>
                <span className="text-base font-semibold">${total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
          </div>

          {/* Pricing documents */}
          <div className="space-y-2">
            <Label>Pricing Documents</Label>
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <span className="inline-flex items-center gap-1.5 text-xs border border-input rounded-md px-3 py-1.5 hover:bg-muted">
                <FileText className="w-3.5 h-3.5" /> Choose files
              </span>
              <input type="file" accept=".pdf,.xlsx,.xls,.doc,.docx" multiple className="sr-only" onChange={handleFileSelect} />
            </label>
            {files.length > 0 && (
              <div className="space-y-1.5">
                {files.map(f => (
                  <div key={f.id} className={`flex items-center gap-2 text-xs rounded-md px-2.5 py-1.5 ${
                    f.status === 'done'     ? 'bg-green-50 text-green-800 border border-green-200' :
                    f.status === 'error'    ? 'bg-red-50 text-red-800 border border-red-200' :
                                               'bg-muted text-muted-foreground border border-input'
                  }`}>
                    {f.status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
                    {f.status === 'done'      && <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-green-600" />}
                    {f.status === 'error'     && <AlertCircle className="w-3 h-3 flex-shrink-0 text-red-500" />}
                    <span className="flex-1 min-w-0 break-all">{f.file_name}</span>
                    {f.status === 'error' && (
                      <button className="flex items-center gap-0.5 text-red-700 hover:underline" onClick={() => uploadSingleFile(f)}>
                        <RefreshCw className="w-3 h-3" /> Retry
                      </button>
                    )}
                    {f.status !== 'uploading' && (
                      <button onClick={() => removeFile(f)} className="hover:text-destructive ml-1">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes / Qualifications</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Any notes, assumptions, exclusions or qualifications..." />
          </div>

          {/* Notify checkbox */}
          <div className="flex items-start gap-2">
            <Checkbox id="notify-sub" checked={notify} disabled={!canNotify}
              onCheckedChange={(v) => setNotify(!!v)} className="mt-0.5" />
            <div>
              <Label htmlFor="notify-sub" className="font-normal cursor-pointer">
                Email a confirmation to the subcontractor
              </Label>
              <p className="text-xs text-muted-foreground">
                {canNotify
                  ? 'Off by default — they already know they sent you their price.'
                  : 'Unavailable — this subcontractor has no email/invitation on file.'}
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || anyUploading || anyErrored || !total}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Record Submission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
