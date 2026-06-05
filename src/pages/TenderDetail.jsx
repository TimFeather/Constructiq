import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { canAccess, canManage as canManagePerm } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Save, X, Trash2, AlertCircle } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import TenderDocuments from '@/components/tenders/TenderDocuments';
import InviteeManager from '@/components/tenders/InviteeManager';
import SubmissionScorer from '@/components/tenders/SubmissionScorer';
import OutcomePanel from '@/components/tenders/OutcomePanel';
import ConvertToProjectModal from '@/components/tenders/ConvertToProjectModal';

const TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection'
];

const STATUS_STYLES = {
  Draft:        'bg-gray-100 text-gray-700',
  Issued:       'bg-blue-100 text-blue-700',
  Closed:       'bg-amber-100 text-amber-700',
  Awarded:      'bg-green-100 text-green-700',
  Unsuccessful: 'bg-red-100 text-red-700',
  Converted:    'bg-purple-100 text-purple-700',
  'On Hold':    'bg-orange-100 text-orange-700',
  Cancelled:    'bg-gray-100 text-gray-500 line-through',
};

function formatCurrency(val) {
  if (!val) return null;
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(val));
}

export default function TenderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = canManagePerm(user, 'tenders');
  const [showConvert, setShowConvert] = useState(false);
  const [customTrade, setCustomTrade] = useState('');
  const [form, setForm] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingTab, setPendingTab] = useState(null);

  const { data: tender, isLoading } = useQuery({
    queryKey: ['tender', id],
    queryFn: async () => {
      const results = await base44.entities.Tender.filter({ id });
      return results[0] || null;
    },
  });

  // Sync form when tender loads
  useEffect(() => {
    if (tender && !form) {
      // Parse closing_date into date + time parts for the editor
      let closing_date = tender.closing_date || '';
      let closing_time = '17:00';
      if (closing_date && closing_date.includes('T')) {
        const parts = closing_date.split('T');
        closing_date = parts[0];
        closing_time = parts[1]?.slice(0, 5) || '17:00';
      }
      setForm({ ...tender, closing_date, closing_time });
    }
  }, [tender]);

  // Detect unsaved changes
  useEffect(() => {
    if (!tender || !form) return;
    const textFields = ['title', 'description', 'status', 'location', 'issue_date', 'closing_date', 'closing_time', 'notes', 'client_name', 'client_email', 'architect_name', 'architect_email', 'project_manager_name', 'project_manager_email'];
    const textChanged = textFields.some(key => String(form[key] ?? '') !== String(tender[key] ?? ''));
    const valueChanged = String(form.estimated_value ?? '') !== String(tender.estimated_value ?? '');
    const tradeChanged = JSON.stringify(form.trade_packages ?? []) !== JSON.stringify(tender.trade_packages ?? []);
    const scoringChanged = JSON.stringify(form.scoring_criteria ?? []) !== JSON.stringify(tender.scoring_criteria ?? []);
    const contactsChanged = JSON.stringify(form.additional_contacts ?? []) !== JSON.stringify(tender.additional_contacts ?? []);
    setIsDirty(textChanged || valueChanged || tradeChanged || scoringChanged || contactsChanged);
  }, [form, tender]);

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.Tender.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tender', id] });
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.Tender.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      navigate('/tenders');
    },
  });

  const handleUpdate = async (data) => {
    await updateMutation.mutateAsync(data);
  };

  // Build closing datetime from date + time
  const buildClosingDatetime = () => {
    if (!form.closing_date) return null;
    const date = form.closing_date;
    const time = form.closing_time || '00:00';
    return `${date}T${time}:00`;
  };

  const handleSaveDetails = async () => {
    await handleUpdate({
      title: form.title,
      description: form.description,
      status: form.status,
      location: form.location,
      issue_date: form.issue_date,
      closing_date: buildClosingDatetime(),
      estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
      trade_packages: form.trade_packages || [],
      client_name: form.client_name,
      client_contact: form.client_contact,
      client_email: form.client_email,
      architect_name: form.architect_name,
      architect_contact: form.architect_contact,
      architect_email: form.architect_email,
      project_manager_name: form.project_manager_name,
      project_manager_contact: form.project_manager_contact,
      project_manager_email: form.project_manager_email,
      additional_contacts: form.additional_contacts || [],
      notes: form.notes,
    });
    setIsDirty(false);
    toast({ title: 'Tender saved' });
  };

  const toggleTrade = (trade) => {
    const current = form.trade_packages || [];
    const updated = current.includes(trade)
      ? current.filter(t => t !== trade)
      : [...current, trade];
    setForm(f => ({ ...f, trade_packages: updated }));
  };

  const addCustomTrade = () => {
    if (!customTrade.trim()) return;
    const current = form.trade_packages || [];
    if (!current.includes(customTrade.trim())) {
      setForm(f => ({ ...f, trade_packages: [...current, customTrade.trim()] }));
    }
    setCustomTrade('');
  };

  if (!canAccess(user, 'tenders')) return <Navigate to="/" replace />;

  if (isLoading || !tender || !form) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/tenders')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Link to="/tenders" className="text-sm text-muted-foreground hover:text-foreground">Tenders</Link>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm font-medium">{tender.tender_number} — {tender.title}</span>
        <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[tender.status] || 'bg-gray-100 text-gray-700'}`}>
          {tender.status}
        </span>
        {tender.estimated_value && (
          <span className="ml-2 text-xs text-muted-foreground font-medium">{formatCurrency(tender.estimated_value)}</span>
        )}
        {canManage && (
          <div className="ml-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Tender?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete <strong>{tender.tender_number} — {tender.title}</strong> and all associated data. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete Tender'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(val) => {
        if (isDirty && activeTab === 'details') {
          setPendingTab(val);
          setShowUnsavedDialog(true);
        } else {
          setActiveTab(val);
        }
      }} className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="documents">Documents {tender.documents?.length > 0 && <span className="ml-1 text-xs opacity-60">{tender.documents.length}</span>}</TabsTrigger>
          <TabsTrigger value="invitees">Invitees {tender.invitees?.length > 0 && <span className="ml-1 text-xs opacity-60">{tender.invitees.length}</span>}</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="outcome">Outcome</TabsTrigger>
        </TabsList>

        {/* Tab 1 — Details */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Tender Number</Label>
              <Input value={form.tender_number || ''} disabled className="bg-muted" />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              {canManage ? (
                <Select value={form.status || 'Draft'} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Draft', 'Issued', 'Closed', 'Awarded', 'Unsuccessful', 'Converted', 'On Hold', 'Cancelled'].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : <Input value={form.status || ''} disabled className="bg-muted" />}
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Title *</Label>
              <Input value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} disabled={!canManage} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} disabled={!canManage} placeholder="Scope of work, overview..." />
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Input value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} disabled={!canManage} placeholder="Project location" />
            </div>
            <div>
              <Label className="text-xs">Estimated Value (NZD)</Label>
              <Input type="number" value={form.estimated_value || ''} onChange={e => setForm(f => ({ ...f, estimated_value: e.target.value }))} disabled={!canManage} placeholder="0.00" />
              {form.estimated_value && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(form.estimated_value))}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Issue Date</Label>
              <Input type="date" value={form.issue_date || ''} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} disabled={!canManage} />
            </div>
            <div>
              <Label className="text-xs">Closing Date</Label>
              <Input type="date" value={form.closing_date || ''} onChange={e => setForm(f => ({ ...f, closing_date: e.target.value }))} disabled={!canManage} />
            </div>
            <div>
              <Label className="text-xs">Closing Time</Label>
              <Input type="time" value={form.closing_time || '17:00'} onChange={e => setForm(f => ({ ...f, closing_time: e.target.value }))} disabled={!canManage} />
            </div>
          </div>

          {/* Trade Packages */}
          <div>
            <Label className="text-xs mb-2 block">Trade Packages</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {TRADES.map(t => {
                const selected = (form.trade_packages || []).includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => canManage && toggleTrade(t)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      selected ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/50'
                    } ${!canManage ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    {t}
                  </button>
                );
              })}
              {(form.trade_packages || []).filter(t => !TRADES.includes(t)).map(t => (
                <span key={t} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground">
                  {t}
                  {canManage && (
                    <button onClick={() => setForm(f => ({ ...f, trade_packages: f.trade_packages.filter(x => x !== t) }))}>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {canManage && (
              <div className="flex gap-2 mt-2">
                <Input
                  value={customTrade}
                  onChange={e => setCustomTrade(e.target.value)}
                  placeholder="Add custom trade..."
                  className="max-w-xs h-8 text-xs"
                  onKeyDown={e => e.key === 'Enter' && addCustomTrade()}
                />
                <Button size="sm" variant="outline" onClick={addCustomTrade} className="h-8 text-xs">Add</Button>
              </div>
            )}
          </div>

          {/* Key Contacts */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Key Contacts</h3>
            {[
              { label: 'Client', prefix: 'client' },
              { label: 'Architect', prefix: 'architect' },
              { label: 'Project Manager', prefix: 'project_manager' },
            ].map(({ label, prefix }) => (
              <div key={prefix} className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 border rounded-lg">
                <div className="flex items-center">
                  <p className="text-sm font-medium">{label}</p>
                </div>
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input value={form[`${prefix}_name`] || ''} onChange={e => setForm(f => ({ ...f, [`${prefix}_name`]: e.target.value }))} disabled={!canManage} placeholder={`${label} name`} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Contact Person</Label>
                  <Input value={form[`${prefix}_contact`] || ''} onChange={e => setForm(f => ({ ...f, [`${prefix}_contact`]: e.target.value }))} disabled={!canManage} placeholder="Contact person" className="h-8 text-sm" />
                </div>
                <div className="sm:col-start-2 sm:col-span-2">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={form[`${prefix}_email`] || ''} onChange={e => setForm(f => ({ ...f, [`${prefix}_email`]: e.target.value }))} disabled={!canManage} placeholder="email@example.com" className="h-8 text-sm" />
                </div>
              </div>
            ))}

            {/* Additional contacts */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">Additional Contacts</p>
                {canManage && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => setForm(f => ({ ...f, additional_contacts: [...(f.additional_contacts || []), { role: '', name: '', email: '', phone: '' }] }))}>
                    <X className="w-3 h-3 rotate-45" /> Add Contact
                  </Button>
                )}
              </div>
              {(form.additional_contacts || []).map((contact, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 p-3 border rounded-lg mb-2">
                  <div>
                    <Label className="text-xs">Role</Label>
                    <Input value={contact.role || ''} onChange={e => {
                      const updated = [...(form.additional_contacts || [])];
                      updated[idx] = { ...updated[idx], role: e.target.value };
                      setForm(f => ({ ...f, additional_contacts: updated }));
                    }} disabled={!canManage} placeholder="e.g. QS" className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input value={contact.name || ''} onChange={e => {
                      const updated = [...(form.additional_contacts || [])];
                      updated[idx] = { ...updated[idx], name: e.target.value };
                      setForm(f => ({ ...f, additional_contacts: updated }));
                    }} disabled={!canManage} placeholder="Full name" className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input type="email" value={contact.email || ''} onChange={e => {
                      const updated = [...(form.additional_contacts || [])];
                      updated[idx] = { ...updated[idx], email: e.target.value };
                      setForm(f => ({ ...f, additional_contacts: updated }));
                    }} disabled={!canManage} placeholder="email@example.com" className="h-8 text-sm" />
                  </div>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label className="text-xs">Phone</Label>
                      <Input value={contact.phone || ''} onChange={e => {
                        const updated = [...(form.additional_contacts || [])];
                        updated[idx] = { ...updated[idx], phone: e.target.value };
                        setForm(f => ({ ...f, additional_contacts: updated }));
                      }} disabled={!canManage} placeholder="Phone" className="h-8 text-sm" />
                    </div>
                    {canManage && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                        onClick={() => setForm(f => ({ ...f, additional_contacts: (f.additional_contacts || []).filter((_, i) => i !== idx) }))}>
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {(!form.additional_contacts?.length) && (
                <p className="text-xs text-muted-foreground">No additional contacts.</p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} disabled={!canManage} />
          </div>

          {canManage && (
            <div className="flex items-center gap-3">
              {isDirty && (
                <span className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Unsaved changes
                </span>
              )}
              <Button onClick={handleSaveDetails} disabled={updateMutation.isPending} className="gap-2">
                <Save className="w-4 h-4" /> {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* Tab 2 — Documents */}
        <TabsContent value="documents">
          <TenderDocuments tender={tender} onUpdate={handleUpdate} canManage={canManage} />
        </TabsContent>

        {/* Tab 3 — Invitees */}
        <TabsContent value="invitees">
          <InviteeManager tender={tender} onUpdate={handleUpdate} canManage={canManage} />
        </TabsContent>

        {/* Tab 4 — Submissions */}
        <TabsContent value="submissions">
          <SubmissionScorer tender={tender} onUpdate={handleUpdate} canManage={canManage} />
        </TabsContent>

        {/* Tab 5 — Outcome */}
        <TabsContent value="outcome">
          <OutcomePanel tender={tender} onUpdate={handleUpdate} onConvert={() => setShowConvert(true)} canManage={canManage} />
        </TabsContent>
      </Tabs>

      <ConvertToProjectModal tender={tender} open={showConvert} onOpenChange={setShowConvert} />

      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes on the Details tab. Leave without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingTab(null)}>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setIsDirty(false);
              setActiveTab(pendingTab);
              setPendingTab(null);
              setShowUnsavedDialog(false);
            }}>
              Leave without saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}