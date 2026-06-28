/**
 * ProjectCIPanel — Contract Instructions tab for a project
 * CI = a communication from the principal authorising variations, scope changes, etc.
 */
import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ContractInstruction } from '@/api/entities';
import { invokeFunction, uploadFile } from '@/api/supabaseClient';
import SecureFileLink from '@/components/shared/SecureFileLink';
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
import { Plus, Send, Archive, ChevronDown, ChevronUp, AlertTriangle, Upload, X } from 'lucide-react';
import { format } from 'date-fns';

const CI_TYPES = [
  'Variation Approval',
  'Scope Change',
  'Direction',
  'Information',
  'Instruction',
];

const STATUS_COLOURS = {
  Draft:    'bg-yellow-100 text-yellow-800 border-yellow-200',
  Issued:   'bg-green-100 text-green-800 border-green-200',
  Archived: 'bg-gray-100 text-gray-600 border-gray-200',
};

async function generateCINumber(projectId) {
  const existing = await ContractInstruction.filter({ project_id: projectId });
  const nums = (existing || [])
    .map(r => parseInt(r.ci_number?.replace('CI-', '') || '0', 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `CI-${String(next).padStart(3, '0')}`;
}

export default function ProjectCIPanel({ project, canManage }) {
  const queryClient = useQueryClient();

  const { data: cis = [], isLoading, isError, error } = useQuery({
    queryKey: ['contractInstructions', project.id],
    queryFn:  () => ContractInstruction.filter({ project_id: project.id }, '-created_at'),
    enabled:  !!project.id,
    retry: 1,
  });

  const [search, setSearch]           = useState('');
  const [showCreate, setShowCreate]   = useState(false);
  const [expandedId, setExpandedId]   = useState(null);
  const [confirmIssue, setConfirmIssue]   = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [working, setWorking]         = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cis.filter(ci =>
      !q ||
      ci.ci_number?.toLowerCase().includes(q) ||
      ci.title?.toLowerCase().includes(q) ||
      ci.instruction_type?.toLowerCase().includes(q) ||
      ci.status?.toLowerCase().includes(q)
    );
  }, [cis, search]);

  const handleIssue = async () => {
    if (!confirmIssue) return;
    setWorking(true);
    try {
      const ci = cis.find(c => c.id === confirmIssue);
      await ContractInstruction.update(confirmIssue, {
        status:     'Issued',
        issue_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Email subcontractors via invitationService
      const subcontractors = (project.team || []).filter(m => m.role === 'Subcontractor' && m.user_email);
      if (subcontractors.length > 0) {
        try {
          await invokeFunction('invitationService', {
            action:    'notifyCI',
            projectId: project.id,
            projectName: project.name,
            ciNumber:  ci?.ci_number || '',
            ciTitle:   ci?.title || '',
            ciType:    ci?.instruction_type || '',
            recipients: subcontractors.map(s => ({ email: s.user_email, name: s.full_name || s.user_email })),
          });
        } catch (_e) { /* non-blocking */ }
      }

      queryClient.invalidateQueries({ queryKey: ['contractInstructions', project.id] });
    } catch (e) {
      alert(`Failed to issue CI: ${e?.message}`);
    } finally {
      setWorking(false);
      setConfirmIssue(null);
    }
  };

  const handleArchive = async () => {
    if (!confirmArchive) return;
    setWorking(true);
    try {
      await ContractInstruction.update(confirmArchive, {
        status: 'Archived', updated_at: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['contractInstructions', project.id] });
    } catch (e) {
      alert(`Failed to archive: ${e?.message}`);
    } finally {
      setWorking(false);
      setConfirmArchive(null);
    }
  };

  if (isLoading) return <div className="py-10 text-center text-muted-foreground text-sm">Loading...</div>;

  if (isError) {
    return (
      <div className="py-10 text-center space-y-2">
        <p className="text-sm font-medium text-destructive">Failed to load Contract Instructions</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">{error?.message || 'Permission denied or table missing'}</p>
        <p className="text-xs text-muted-foreground">Run the SQL migration to create the <code>contract_instructions</code> table and RLS policies.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1">
          <Input placeholder="Search by number, title, type or status..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="max-w-sm h-9 text-sm" />
        </div>
        {canManage && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Create CI
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {cis.length === 0
            ? 'No contract instructions yet. Click "Create CI" to get started.'
            : 'No results match your search.'}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-3 px-4 py-2.5 bg-muted/40 border-b text-xs font-medium text-muted-foreground">
            <div className="col-span-2">Number</div>
            <div className="col-span-4">Title</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Issued</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          {filtered.map(ci => (
            <div key={ci.id} className="border-b last:border-0">
              <div className="grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-muted/20 transition-colors">
                <div className="col-span-2">
                  <span className="font-mono text-xs font-semibold text-primary">{ci.ci_number}</span>
                </div>
                <div className="col-span-4">
                  <button className="text-sm font-medium text-left hover:text-primary flex items-center gap-1"
                    onClick={() => setExpandedId(expandedId === ci.id ? null : ci.id)}>
                    {ci.title}
                    {expandedId === ci.id ? <ChevronUp className="w-3 h-3 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
                  </button>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">{ci.instruction_type}</span>
                </div>
                <div className="col-span-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${STATUS_COLOURS[ci.status] || ''}`}>
                    {ci.status}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">
                    {ci.issue_date ? format(new Date(ci.issue_date), 'dd MMM yyyy') : '—'}
                  </span>
                </div>
                <div className="col-span-1 flex justify-end gap-1">
                  {canManage && ci.status === 'Draft' && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/10"
                      title="Issue CI" onClick={() => setConfirmIssue(ci.id)}>
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {canManage && ci.status === 'Issued' && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:bg-muted"
                      title="Archive" onClick={() => setConfirmArchive(ci.id)}>
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {expandedId === ci.id && (
                <div className="px-4 pb-4 pt-0 bg-muted/10 border-t text-sm space-y-2">
                  {ci.description && (
                    <p className="text-muted-foreground whitespace-pre-wrap">{ci.description}</p>
                  )}
                  {ci.attachments?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Attachments:</p>
                      <div className="space-y-1">
                        {ci.attachments.map((a, i) => (
                          <SecureFileLink key={i} value={a.file_url}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                            📎 {a.file_name || 'Attachment'}
                          </SecureFileLink>
                        ))}
                      </div>
                    </div>
                  )}
                  {ci.issued_by && (
                    <p className="text-xs text-muted-foreground">Issued by: {ci.issued_by}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCIDialog
          project={project}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['contractInstructions', project.id] });
          }}
        />
      )}

      <AlertDialog open={!!confirmIssue} onOpenChange={(o) => !o && setConfirmIssue(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Issue this Contract Instruction?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2">Once issued it cannot be deleted — only archived.</p>
                {(() => {
                  const recipients = (project.team || []).filter(m => m.role === 'Subcontractor' && m.user_email);
                  return recipients.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-foreground mb-1">Will notify {recipients.length} subcontractor{recipients.length !== 1 ? 's' : ''}:</p>
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {recipients.map((r, i) => <li key={i}>• {r.full_name || r.user_email}</li>)}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-600">No subcontractors on the project team will be notified.</p>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleIssue} disabled={working}>
              {working ? 'Issuing...' : 'Issue CI'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmArchive} onOpenChange={(o) => !o && setConfirmArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this CI?</AlertDialogTitle>
            <AlertDialogDescription>Historical records are maintained.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} disabled={working} className="bg-destructive hover:bg-destructive/90">
              {working ? 'Archiving...' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateCIDialog({ project, onClose, onCreated }) {
  const [form, setForm]                   = useState({ title: '', description: '', type: '' });
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploading, setUploading]         = useState(false);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');
  const fileInputRef                      = useRef(null);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true); setError('');
    try {
      const results = [];
      for (const file of files) {
        // CI attachments are private — store in the private project-files bucket.
        const { file_url } = await uploadFile(file, 'project-files');
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

  const handleSave = async () => {
    if (!form.title || !form.type) { setError('Title and type are required.'); return; }
    setSaving(true); setError('');
    try {
      const ciNumber = await generateCINumber(project.id);
      await ContractInstruction.create({
        project_id:       project.id,
        ci_number:        ciNumber,
        title:            form.title,
        description:      form.description,
        instruction_type: form.type,
        status:           'Draft',
        attachments:      uploadedFiles,
        created_at:       new Date().toISOString(),
        updated_at:       new Date().toISOString(),
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Contract Instruction</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>CI Number</Label>
            <Input value="Auto-generated" disabled className="bg-muted text-muted-foreground mt-1" />
          </div>
          <div>
            <Label>Title *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Approved Variation 003" className="mt-1" />
          </div>
          <div>
            <Label>Type *</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select type..." /></SelectTrigger>
              <SelectContent>
                {CI_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={4} placeholder="Full description of the instruction..." className="mt-1" />
          </div>
          <div>
            <Label>Attachments</Label>
            <div className="mt-1 border-2 border-dashed rounded-lg p-3 text-center">
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUpload} />
              <Button type="button" variant="outline" size="sm" className="gap-2"
                onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading...' : 'Choose files'}
              </Button>
            </div>
            {uploadedFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {uploadedFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-green-50 border border-green-200 rounded px-2 py-1">
                    <span className="text-green-800 truncate">{f.file_name}</span>
                    <button onClick={() => setUploadedFiles(prev => prev.filter((_, j) => j !== i))}
                      className="text-green-600 hover:text-red-500 ml-2 flex-shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving || uploading}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || uploading || !form.title || !form.type}>
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
