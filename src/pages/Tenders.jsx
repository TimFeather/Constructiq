import { invokeFunction, supabase } from '@/api/supabaseClient';
import React, { useState } from 'react';
import { Tender } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { canAccess, canManage as canManagePerm, isAdminOrPricing } from '@/lib/permissions';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { Plus, Search, FileSignature, Calendar, Users, MapPin, DollarSign, Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { useToast } from '@/components/ui/use-toast';
import { format, differenceInDays, isPast, parseISO } from 'date-fns';

const STATUS_STYLES = {
  Draft:        'bg-gray-100 text-gray-700',
  Issued:       'bg-blue-100 text-blue-700',
  Submitted:    'bg-amber-100 text-amber-700',
  Awarded:      'bg-green-100 text-green-700',
  Unsuccessful: 'bg-red-100 text-red-700',
  Archived:     'bg-purple-100 text-purple-700',
  Converted:    'bg-purple-100 text-purple-700',
};

function TenderStatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

function closingDateLabel(tender) {
  if (!tender.closing_date) return null;
  const days = differenceInDays(parseISO(tender.closing_date), new Date());
  if (tender.status === 'Issued' && days >= 0 && days <= 3) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
        <Clock className="w-3 h-3" />
        {days === 0 ? 'Closes today' : `Closes in ${days} day${days !== 1 ? 's' : ''}`}
      </span>
    );
  }
  if (tender.status === 'Issued' && isPast(parseISO(tender.closing_date))) {
    return <span className="text-red-600 font-medium text-xs">Overdue</span>;
  }
  return null;
}

const ACTIVE_STATUSES    = ['Draft', 'Issued', 'Awarded', 'Unsuccessful', 'On Hold', 'Cancelled'];
const SUBMITTED_STATUSES = ['Submitted'];
const ARCHIVED_STATUSES  = ['Archived', 'Converted'];

const STATUS_STYLES_LIST = {
  ...STATUS_STYLES,
  'On Hold':  'bg-orange-100 text-orange-700',
  Cancelled:  'bg-gray-100 text-gray-500',
};

export default function Tenders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [view, setView] = useState('active');   // 'active' | 'submitted' | 'archive'
  const [statusTab, setStatusTab] = useState('All');
  const [deleteId, setDeleteId] = useState(null);
  const queryClient = useQueryClient();
  const canManage = canManagePerm(user, 'tenders');
  const canDelete = isAdminOrPricing(user);

  const { data: tenders = [], isLoading } = useQuery({
    queryKey: ['tenders'],
    queryFn: () => Tender.list('-created_at', 200),
  });

  // Invitee counts per tender (card display)
  const { data: inviteeCounts = {} } = useQuery({
    queryKey: ['tenderInviteeCounts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('tender_invitees')
        .select('tender_id, status');
      const map = {};
      for (const row of (data ?? [])) {
        if (!map[row.tender_id]) map[row.tender_id] = { total: 0, submitted: 0 };
        map[row.tender_id].total++;
        if (['Submitted', 'Awarded', 'Unsuccessful'].includes(row.status)) {
          map[row.tender_id].submitted++;
        }
      }
      return map;
    },
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await invokeFunction('createTender', {});
      if (res.data?.error) throw new Error(res.data.error);
      return res.data.tender;
    },
    onSuccess: (tender) => {
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      navigate(`/tenders/${tender.id}`);
    },
    onError: (err) => {
      toast({
        title: 'Failed to create tender',
        description: err?.message || 'Permission denied. Make sure your account has the admin or pricing role.',
        variant: 'destructive',
        duration: 8000,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (tenderId) => {
      const res = await invokeFunction('deleteTender', { tenderId });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      setDeleteId(null);
      toast({ title: 'Tender deleted' });
    },
    onError: (err) => {
      toast({
        title: 'Failed to delete tender',
        description: err?.message,
        variant: 'destructive',
        duration: 8000,
      });
    },
  });

  if (!canAccess(user, 'tenders')) return <Navigate to="/dashboard" replace />;

  const viewStatuses = view === 'active' ? ACTIVE_STATUSES : view === 'submitted' ? SUBMITTED_STATUSES : ARCHIVED_STATUSES;
  const statusTabs   = ['All', ...viewStatuses];

  const filtered = tenders.filter(t => {
    const inView    = viewStatuses.includes(t.status);
    const matchTab  = statusTab === 'All' ? inView : t.status === statusTab;
    const q = search.toLowerCase();
    const matchSearch = !q || t.title?.toLowerCase().includes(q) || t.tender_number?.toLowerCase().includes(q) || t.client_name?.toLowerCase().includes(q);
    return matchTab && matchSearch;
  });

  return (
    <div>
      <PageHeader
        title="Tenders"
        description="Manage tender invitations and submissions"
        actions={
          canManage && (
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="gap-2">
              <Plus className="w-4 h-4" /> {createMutation.isPending ? 'Creating...' : 'New Tender'}
            </Button>
          )
        }
      />

      {/* Active / Archive toggle */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => { setView('active'); setStatusTab('All'); }}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${view === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
        >
          Active <span className="ml-1.5 opacity-70">{tenders.filter(t => ACTIVE_STATUSES.includes(t.status)).length}</span>
        </button>
        <button
          onClick={() => { setView('submitted'); setStatusTab('All'); }}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${view === 'submitted' ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
        >
          Submitted <span className="ml-1.5 opacity-70">{tenders.filter(t => SUBMITTED_STATUSES.includes(t.status)).length}</span>
        </button>
        <button
          onClick={() => { setView('archive'); setStatusTab('All'); }}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${view === 'archive' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
        >
          Archive <span className="ml-1.5 opacity-70">{tenders.filter(t => ARCHIVED_STATUSES.includes(t.status)).length}</span>
        </button>
      </div>

      {/* Status sub-tabs */}
      <div className="flex gap-1 flex-wrap mb-4">
        {statusTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setStatusTab(tab)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              statusTab === tab
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab}
            {tab !== 'All' && (
              <span className="ml-1.5 opacity-60">{tenders.filter(t => t.status === tab).length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by title, number or client..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 max-w-md"
        />
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-5 space-y-3">
                <div className="h-5 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={statusTab === 'All' ? 'No tenders yet' : `No ${statusTab} tenders`}
          description={statusTab === 'All'
            ? 'Create your first tender to start inviting subcontractors'
            : `No tenders with status "${statusTab}" found`}
          actionLabel={statusTab === 'All' && canManage ? 'New Tender' : undefined}
          onAction={statusTab === 'All' && canManage ? () => createMutation.mutate() : undefined}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(tender => {
            const counts = inviteeCounts[tender.id] || { total: 0, submitted: 0 };
            const isOverdue = tender.status === 'Issued' && tender.closing_date && isPast(parseISO(tender.closing_date));
            const canDeleteThis = canDelete && view === 'archive' && tender.status === 'Archived';
            return (
              <div key={tender.id} className="relative group">
                <Link to={`/tenders/${tender.id}`}>
                  <Card className={`hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 cursor-pointer h-full ${isOverdue ? 'border-l-4 border-l-red-500' : 'hover:border-primary/30'}`}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-xs font-mono font-semibold text-primary">{tender.tender_number}</span>
                        <TenderStatusBadge status={tender.status} />
                      </div>
                      <h3 className="font-semibold text-sm mb-2 line-clamp-2">{tender.title}</h3>
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        {tender.client_name && (
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3 h-3" /> {tender.client_name}
                          </div>
                        )}
                        {tender.location && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3 h-3" /> {tender.location}
                          </div>
                        )}
                        {tender.closing_date && (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3 h-3" />
                            <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                              {format(parseISO(tender.closing_date), 'dd MMM yyyy')}
                            </span>
                            {closingDateLabel(tender)}
                          </div>
                        )}
                        {tender.estimated_value && (
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="w-3 h-3" />
                          {new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(tender.estimated_value))}
                        </div>
                        )}
                        <div className="flex items-center gap-1.5 pt-1">
                          <Users className="w-3 h-3" />
                          {counts.total} invited · {counts.submitted} submitted
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                {canDeleteThis && (
                  <button
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-card border shadow-sm hover:bg-destructive/10"
                    onClick={e => { e.preventDefault(); setDeleteId(tender.id); }}
                    title="Permanently delete tender"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete tender?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>"{tenders.find(t => t.id === deleteId)?.title}"</strong> and all its invitees, invitations, submissions, notices, and documents will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}