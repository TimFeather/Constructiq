import { invokeFunction } from '@/api/supabaseClient';
import React, { useState, useEffect } from 'react';
import { Tender, User, TradeTemplate } from '@/api/entities';
import { useParams, useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { canAccess, canManage as canManagePerm } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Save, X, Trash2, AlertCircle, RefreshCw, FolderOpen, Lock, User as UserIcon, MessageSquare, Pencil } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import TenderDocuments from '@/components/tenders/TenderDocuments';
import InviteeManager from '@/components/tenders/InviteeManager.jsx';
import SubmissionScorer from '@/components/tenders/SubmissionScorer.jsx';
import OutcomePanel from '@/components/tenders/OutcomePanel.jsx';
import ConvertToProjectModal from '@/components/tenders/ConvertToProjectModal';
import TenderHealthPanel from '@/components/tenders/TenderHealthPanel.jsx';
import TenderInvitationStats from '@/components/tenders/TenderInvitationStats';
import TenderActivityFeed from '@/components/tenders/TenderActivityFeed';
import TenderNTTPanel from '@/components/tenders/TenderNTTPanel';

const DEFAULT_TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection'
];

const STATUS_STYLES = {
  Draft:        'bg-gray-100 text-gray-700',
  Issued:       'bg-blue-100 text-blue-700',
  Submitted:    'bg-amber-100 text-amber-700',
  Awarded:      'bg-green-100 text-green-700',
  Unsuccessful: 'bg-red-100 text-red-700',
  Archived:     'bg-purple-100 text-purple-700',
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
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'details';
  const setActiveTab = (tab) => setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('tab', tab); return p; }, { replace: true });
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingTab, setPendingTab] = useState(null);

  const { data: tender, isLoading, refetch } = useQuery({
    queryKey: ['tender', id],
    queryFn: () => Tender.get(id),
    refetchInterval: activeTab === 'submissions' ? 30000 : false,
    refetchIntervalInBackground: false,
  });

  // Phase 4: Sync form whenever tender.id or updated_date changes (not just on first load)
  useEffect(() => {
    if (!tender) return;
    let closing_date = tender.closing_date || '';
    let closing_time = '17:00';
    if (closing_date && closing_date.includes('T')) {
      const parts = closing_date.split('T');
      closing_date = parts[0];
      closing_time = parts[1]?.slice(0, 5) || '17:00';
    }
    // Normalise trade_packages — old data may be [{name, trade}] objects instead of strings
    const trade_packages = (tender.trade_packages || []).map(t =>
      typeof t === 'string' ? t : (t.name || t.trade || String(t))
    );
    setForm({ ...tender, closing_date, closing_time, trade_packages });
    setIsDirty(false);
  }, [tender?.id, tender?.updated_at]);

  // Fetch admin+pricing users for Tender Lead selector
  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => User.list(),
    enabled: !!canManage,
  });
  const eligibleLeads = allUsers.filter(u => u.role === 'admin' || u.role === 'pricing');

  // Dynamic trade list from DB (falls back to defaults if table empty or not found)
  const { data: tradeTemplates = [] } = useQuery({
    queryKey: ['trade_templates'],
    queryFn: () => TradeTemplate.list('sort_order'),
    staleTime: 5 * 60_000,
  });
  const TRADES = tradeTemplates.length > 0 ? tradeTemplates.map(t => t.name) : DEFAULT_TRADES;

  // Questions tab
  const { data: questions = [], refetch: refetchQuestions } = useQuery({
    queryKey: ['tender_rfis', id],
    queryFn: async () => {
      const { supabase } = await import('@/api/supabaseClient');
      const { data: rfis, error } = await supabase
        .from('tender_rfis')
        .select('*')
        .eq('tender_id', id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch responses for each RFI
      const rfiWithResponses = await Promise.all((rfis || []).map(async (rfi) => {
        const { data: responses } = await supabase
          .from('tender_rfi_responses')
          .select('*')
          .eq('rfi_id', rfi.id)
          .order('created_at', { ascending: true });
        return { ...rfi, tender_rfi_responses: responses || [] };
      }));

      return rfiWithResponses || [];
    },
    enabled: activeTab === 'questions',
  });
  const [replyText, setReplyText] = useState({});
  const [submittingReply, setSubmittingReply] = useState(null);
  const [deleteQuestionId, setDeleteQuestionId] = useState(null);
  const [editQuestion, setEditQuestion] = useState(null); // { id, subject, description }
  const [editQuestionSaving, setEditQuestionSaving] = useState(false);

  const handleReply = async (rfiId, inviteeEmail, inviteeName, rfiSubject) => {
    const { supabase } = await import('@/api/supabaseClient');
    const content = replyText[rfiId]?.trim();
    if (!content) return;
    setSubmittingReply(rfiId);
    try {
      await supabase.from('tender_rfi_responses').insert({
        rfi_id: rfiId,
        author_email: user.email,
        author_name: user.full_name || user.email,
        content,
      });
      await supabase.from('tender_rfis').update({ status: 'Answered', updated_at: new Date().toISOString() }).eq('id', rfiId);
      // Send notification email via edge function
      await invokeFunction('tenderPublicApi', {
        action: 'respondQuestion',
        token: '__admin_reply__',
        rfi_id: rfiId,
        content,
        invitee_email: inviteeEmail,
        invitee_name: inviteeName,
        rfi_subject: rfiSubject,
        tender_id: id,
      }).catch(() => { /* non-blocking — email is best-effort */ });
      setReplyText(r => ({ ...r, [rfiId]: '' }));
      refetchQuestions();
      toast({ title: 'Reply sent' });
      logActivity('note_added', `Question answered: "${rfiSubject}" — replied to ${inviteeName || inviteeEmail}`);
    } catch (e) {
      toast({ title: 'Failed to send reply', description: e.message, variant: 'destructive' });
    } finally {
      setSubmittingReply(null);
    }
  };

  const handleDeleteQuestion = async () => {
    if (!deleteQuestionId) return;
    const { supabase } = await import('@/api/supabaseClient');
    try {
      await supabase.from('tender_rfis').delete().eq('id', deleteQuestionId);
      refetchQuestions();
      toast({ title: 'Question deleted' });
    } catch (e) {
      toast({ title: 'Failed to delete', description: e.message, variant: 'destructive' });
    } finally {
      setDeleteQuestionId(null);
    }
  };

  const handleEditQuestion = async () => {
    if (!editQuestion) return;
    setEditQuestionSaving(true);
    const { supabase } = await import('@/api/supabaseClient');
    try {
      await supabase.from('tender_rfis').update({
        subject:     editQuestion.subject,
        description: editQuestion.description,
        edited_at:   new Date().toISOString(),
        edited_by_email: user.email,
      }).eq('id', editQuestion.id);
      refetchQuestions();
      toast({ title: 'Question updated' });
      setEditQuestion(null);
    } catch (e) {
      toast({ title: 'Failed to update', description: e.message, variant: 'destructive' });
    } finally {
      setEditQuestionSaving(false);
    }
  };

  const logActivity = async (eventType, description) => {
    try {
      const { supabase } = await import('@/api/supabaseClient');
      await supabase.from('tender_activity').insert({
        tender_id: id,
        event_type: eventType,
        actor_name: user?.full_name || user?.email || 'Unknown',
        actor_email: user?.email || '',
        description,
        occurred_at: new Date().toISOString(),
      });
    } catch (_) {}
  };

  // Detect unsaved changes
  useEffect(() => {
    if (!tender || !form) return;
    const textFields = ['title', 'description', 'status', 'location', 'issue_date', 'site_visit_date', 'questions_date', 'notes', 'client_name', 'client_email', 'architect_name', 'architect_email', 'project_manager_name', 'project_manager_email', 'tender_lead_user_id'];
    const textChanged = textFields.some(key => String(form[key] ?? '') !== String(tender[key] ?? ''));
    const valueChanged = String(form.estimated_value ?? '') !== String(tender.estimated_value ?? '');
    const tradeChanged = JSON.stringify(form.trade_packages ?? []) !== JSON.stringify(tender.trade_packages ?? []);
    const scoringChanged = JSON.stringify(form.scoring_criteria ?? []) !== JSON.stringify(tender.scoring_criteria ?? []);
    const contactsChanged = JSON.stringify(form.additional_contacts ?? []) !== JSON.stringify(tender.additional_contacts ?? []);
    const closingChanged = (() => {
      const formFull = form.closing_date
        ? `${form.closing_date}T${form.closing_time || '17:00'}:00`
        : '';
      return formFull !== (tender.closing_date || '');
    })();
    setIsDirty(textChanged || valueChanged || tradeChanged || scoringChanged || contactsChanged || closingChanged);
  }, [form, tender]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const updateMutation = useMutation({
    mutationFn: (data) => invokeFunction('updateTender', { tenderId: id, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tender', id] });
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
    },
  });

  // Phase 3: use dedicated deleteTender function
  const deleteMutation = useMutation({
    mutationFn: () => invokeFunction('deleteTender', { tenderId: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      navigate('/tenders');
    },
    onError: (err) => {
      console.error('[deleteTender] failed:', err?.message, err?.response?.data);
      toast({ title: 'Delete failed', description: err?.message || 'Unknown error', variant: 'destructive', duration: 8000 });
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

  // Phase 5: expose full error on save
  const handleSaveDetails = async () => {
    try {
      await handleUpdate({
      title: form.title,
      description: form.description,
      status: form.status,
      location: form.location,
      issue_date: form.issue_date,
      site_visit_date: form.site_visit_date || null,
      questions_date: form.questions_date || null,
      closing_date: buildClosingDatetime(),
      estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
      trade_packages: form.trade_packages || [],
      tender_lead_user_id: form.tender_lead_user_id || null,
      tender_lead_name: form.tender_lead_name || null,
      tender_lead_email: form.tender_lead_email || null,
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
      if (form.status !== tender.status) {
        logActivity('status_changed', `Status changed from ${tender.status} to ${form.status}`);
      } else {
        logActivity('note_added', 'Tender details updated');
      }
    } catch (err) {
      console.error('[handleSaveDetails] failed:', err?.message, err?.response?.data, err?.stack);
      toast({ title: 'Save failed', description: err?.message || 'Unknown error', variant: 'destructive', duration: 8000 });
    }
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

  if (!canAccess(user, 'tenders')) return <Navigate to="/dashboard" replace />;

  const isConverted = tender?.status === 'Converted' || tender?.status === 'Archived' || !!tender?.converted_project_id;
  const effectiveCanManage = canManage && !isConverted;

  if (isLoading || !tender || !form) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Read-only banner for converted tenders */}
      {isConverted && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
          <Lock className="w-4 h-4 flex-shrink-0" />
          This tender has been converted to a project and is now read-only.
        </div>
      )}

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
        {tender.converted_project_id && (
          <Link to={`/projects/${tender.converted_project_id}`} className="ml-2 inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium">
            <FolderOpen className="w-3 h-3" /> View Project →
          </Link>
        )}
        {effectiveCanManage && (
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
        <div className="overflow-x-auto -mx-1 px-1 pb-1"><TabsList className="inline-flex w-max">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="documents">Documents {tender.documents?.length > 0 && <span className="ml-1 text-xs opacity-60">{tender.documents.length}</span>}</TabsTrigger>
          <TabsTrigger value="invitees">Invitees</TabsTrigger>
          <TabsTrigger value="ntts">NTTs</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="outcome">Outcome</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList></div>

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
                    {['Draft', 'Issued', 'Submitted', 'Awarded', 'Unsuccessful', 'Archived', 'On Hold', 'Cancelled'].map(s => (
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
            <div>
              <Label className="text-xs">Site Visit Date</Label>
              <Input type="date" value={form.site_visit_date || ''} onChange={e => setForm(f => ({ ...f, site_visit_date: e.target.value }))} disabled={!canManage} />
            </div>
            <div>
              <Label className="text-xs">Questions Deadline</Label>
              <Input type="date" value={form.questions_date || ''} onChange={e => setForm(f => ({ ...f, questions_date: e.target.value }))} disabled={!canManage} />
            </div>
          </div>

          {/* Tender Ownership */}
          <div className="grid sm:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/20">
            <div className="sm:col-span-2 flex items-center gap-2 mb-1">
              <UserIcon className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Tender Ownership</h3>
            </div>
            {/* Created By — read-only */}
            <div>
              <Label className="text-xs">Created By</Label>
              <Input value={tender.created_by_name || tender.created_by_email || '—'} disabled className="bg-muted text-sm" />
              {tender.created_by_email && tender.created_by_name && (
                <p className="text-xs text-muted-foreground mt-0.5">{tender.created_by_email}</p>
              )}
            </div>
            {/* Tender Lead — editable by canManage */}
            <div>
              <Label className="text-xs">Tender Lead</Label>
              {canManage && eligibleLeads.length > 0 ? (
                <Select
                  value={form.tender_lead_user_id || ''}
                  onValueChange={v => {
                    const lead = eligibleLeads.find(u => u.id === v);
                    setForm(f => ({
                      ...f,
                      tender_lead_user_id: v,
                      tender_lead_name: lead?.full_name || '',
                      tender_lead_email: lead?.email || '',
                    }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select Tender Lead..." /></SelectTrigger>
                  <SelectContent>
                    {eligibleLeads.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={form.tender_lead_name || form.tender_lead_email || '—'} disabled className="bg-muted text-sm" />
              )}
              {form.tender_lead_email && form.tender_lead_name && (
                <p className="text-xs text-muted-foreground mt-0.5">{form.tender_lead_email}</p>
              )}
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
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{label}</p>
                  {canManage && (form[`${prefix}_name`] || form[`${prefix}_email`] || form[`${prefix}_contact`]) && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => setForm(f => ({
                        ...f,
                        [`${prefix}_name`]: '',
                        [`${prefix}_contact`]: '',
                        [`${prefix}_email`]: '',
                      }))}
                    >
                      Clear
                    </button>
                  )}
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

          {effectiveCanManage && (
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
          <TenderDocuments tender={tender} onUpdate={handleUpdate} canManage={effectiveCanManage} />
        </TabsContent>

        {/* Tab 3 — Invitees */}
        <TabsContent value="invitees">
          <div className="space-y-4">
            <TenderInvitationStats tenderId={tender.id} />
            <TenderHealthPanel tender={tender} user={user} />
<InviteeManager tender={tender} onUpdate={handleUpdate} canManage={effectiveCanManage} />
          </div>
        </TabsContent>

        {/* Tab 4 — NTTs */}
        <TabsContent value="ntts">
          <TenderNTTPanel tender={tender} canManage={effectiveCanManage} />
        </TabsContent>

        {/* Tab 5 — Questions */}
        <TabsContent value="questions" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Tender Questions</h3>
            <Button variant="outline" size="sm" onClick={() => refetchQuestions()} className="gap-1.5 text-xs">
              <RefreshCw className="w-3 h-3" /> Refresh
            </Button>
          </div>
          {questions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No questions submitted yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((q) => (
                <div key={q.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{q.subject}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {q.created_by_name || q.created_by_email} · {new Date(q.created_at).toLocaleDateString('en-NZ')}
                        {q.edited_at && <span className="italic ml-1">(edited)</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${q.status === 'Answered' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {q.status}
                      </span>
                      {effectiveCanManage && (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:bg-muted"
                            title="Edit question"
                            onClick={() => setEditQuestion({ id: q.id, subject: q.subject, description: q.description || '' })}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            title="Delete question"
                            onClick={() => setDeleteQuestionId(q.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {q.description && (
                    <p className="text-sm text-muted-foreground bg-muted/30 rounded p-3">{q.description}</p>
                  )}
                  {(q.tender_rfi_responses || []).length > 0 && (
                    <div className="space-y-2 pl-4 border-l-2 border-primary/20">
                      {(q.tender_rfi_responses || []).map((r) => (
                        <div key={r.id} className="bg-blue-50 rounded p-3">
                          <p className="text-xs font-medium text-blue-700">{r.author_name || r.author_email}</p>
                          <p className="text-sm mt-1">{r.content}</p>
                          <p className="text-xs text-muted-foreground mt-1">{new Date(r.created_at).toLocaleDateString('en-NZ')}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {effectiveCanManage && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Type a reply..."
                        value={replyText[q.id] || ''}
                        onChange={e => setReplyText(r => ({ ...r, [q.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleReply(q.id, q.created_by_email, q.created_by_name, q.subject)}
                      />
                      <Button
                        size="sm"
                        disabled={!replyText[q.id]?.trim() || submittingReply === q.id}
                        onClick={() => handleReply(q.id, q.created_by_email, q.created_by_name, q.subject)}
                      >
                        {submittingReply === q.id ? 'Sending...' : 'Reply'}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab 6 — Submissions */}
        <TabsContent value="submissions">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Submissions Received</h3>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
          <SubmissionScorer tender={tender} onUpdate={handleUpdate} canManage={effectiveCanManage} />
        </TabsContent>

        {/* Tab 5 — Outcome */}
        <TabsContent value="outcome">
          <OutcomePanel tender={tender} onUpdate={handleUpdate} onConvert={() => setShowConvert(true)} canManage={effectiveCanManage} />
        </TabsContent>

        {/* Tab 6 — Activity */}
        <TabsContent value="activity">
          <TenderActivityFeed tenderId={tender.id} />
        </TabsContent>
      </Tabs>

      <ConvertToProjectModal tender={tender} open={showConvert} onOpenChange={setShowConvert} />

      {/* Delete question confirm */}
      <AlertDialog open={!!deleteQuestionId} onOpenChange={(o) => !o && setDeleteQuestionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this question?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the question and all its responses. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleDeleteQuestion}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit question dialog */}
      {editQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-semibold">Edit Question</h2>
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium">Subject</Label>
                <Input
                  value={editQuestion.subject}
                  onChange={e => setEditQuestion(q => ({ ...q, subject: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Description</Label>
                <Textarea
                  value={editQuestion.description}
                  onChange={e => setEditQuestion(q => ({ ...q, description: e.target.value }))}
                  rows={4}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditQuestion(null)} disabled={editQuestionSaving}>Cancel</Button>
              <Button onClick={handleEditQuestion} disabled={editQuestionSaving || !editQuestion.subject.trim()}>
                {editQuestionSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}

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