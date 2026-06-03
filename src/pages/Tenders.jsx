import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileSignature, Calendar, Users, MapPin, DollarSign, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { format, differenceInDays, isPast, parseISO } from 'date-fns';

const STATUS_STYLES = {
  Draft:        'bg-gray-100 text-gray-700',
  Issued:       'bg-blue-100 text-blue-700',
  Closed:       'bg-amber-100 text-amber-700',
  Awarded:      'bg-green-100 text-green-700',
  Unsuccessful: 'bg-red-100 text-red-700',
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
  if (tender.status === 'Issued' && days >= 0 && days <= 7) {
    return <span className="text-amber-600 font-medium text-xs">Closes in {days} day{days !== 1 ? 's' : ''}</span>;
  }
  if (tender.status === 'Issued' && isPast(parseISO(tender.closing_date))) {
    return <span className="text-red-600 font-medium text-xs">Overdue</span>;
  }
  return null;
}

const STATUS_TABS = ['All', 'Draft', 'Issued', 'Closed', 'Awarded', 'Unsuccessful', 'Converted'];

export default function Tenders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManage = ['admin', 'internal', 'pricing'].includes(user?.role);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState('All');
  const queryClient = useQueryClient();

  const { data: tenders = [], isLoading } = useQuery({
    queryKey: ['tenders'],
    queryFn: () => base44.entities.Tender.list('-created_date', 200),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const existing = await base44.entities.Tender.list('-created_date', 500);
      const nextNum = (existing.length > 0 ? Math.max(...existing.map(t => {
        const n = parseInt((t.tender_number || '').replace('TDR-', ''));
        return isNaN(n) ? 0 : n;
      })) : 0) + 1;
      return base44.entities.Tender.create({
        title: 'New Tender',
        status: 'Draft',
        tender_number: `TDR-${String(nextNum).padStart(3, '0')}`,
        created_by_email: user?.email,
        scoring_criteria: [
          { criterion: 'Price', weight_percent: 40 },
          { criterion: 'Experience', weight_percent: 20 },
          { criterion: 'Programme', weight_percent: 15 },
          { criterion: 'Methodology', weight_percent: 15 },
          { criterion: 'Compliance', weight_percent: 10 },
        ],
      });
    },
    onSuccess: (tender) => {
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      navigate(`/tenders/${tender.id}`);
    },
  });

  const filtered = tenders.filter(t => {
    const matchTab = statusTab === 'All' || t.status === statusTab;
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

      {/* Status tabs */}
      <div className="flex gap-1 flex-wrap mb-4">
        {STATUS_TABS.map(tab => (
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
          title="No tenders found"
          description={tenders.length === 0 ? 'Create your first tender to get started' : 'Try adjusting your filters'}
          actionLabel={tenders.length === 0 && canManage ? 'New Tender' : undefined}
          onAction={tenders.length === 0 && canManage ? () => createMutation.mutate() : undefined}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(tender => {
            const submittedCount = (tender.invitees || []).filter(i => i.status === 'Submitted' || i.status === 'Awarded' || i.status === 'Unsuccessful').length;
            const isOverdue = tender.status === 'Issued' && tender.closing_date && isPast(parseISO(tender.closing_date));
            return (
              <Link key={tender.id} to={`/tenders/${tender.id}`}>
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
                          NZD {Number(tender.estimated_value).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 pt-1">
                        <Users className="w-3 h-3" />
                        {(tender.invitees || []).length} invited · {submittedCount} submitted
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}