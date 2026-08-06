import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { invokeFunction } from '@/api/supabaseClient';
import { format, parseISO, isPast } from 'date-fns';
import { ListChecks, MapPin, CalendarClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';

const nzCurrency = (value) =>
  new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(value));

// "Submitted" comes from submitted_at, never invitation_status — resendInvitation
// resets status back to 'Sent' without deleting the submission row.
function getDisplayStatus(t) {
  if (t.submitted_at) return 'Submitted';
  if (t.invitation_status === 'Viewed') return 'Viewed';
  return 'Not opened';
}

const STATUS_STYLES = {
  'Submitted':  'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Viewed':     'bg-blue-100 text-blue-700 border-blue-200',
  'Not opened': 'bg-slate-100 text-slate-600 border-slate-200',
};

const OUTCOME_STYLES = {
  Awarded:      'bg-green-100 text-green-700 border-green-200',
  Unsuccessful: 'bg-red-100 text-red-700 border-red-200',
};

const TenderRow = ({ t }) => {
  const displayStatus = getDisplayStatus(t);
  // Duplicated verbatim from TenderSubmit.jsx — same +12:00 NZ end-of-day
  // convention. Do not refactor into a shared helper in v1 (see plan).
  const isOverdue = t.closing_date &&
    isPast(parseISO(`${t.closing_date.split('T')[0]}T23:59:59+12:00`));

  return (
    <Link to={`/tender-submit/${t.token}`}>
      <Card className="hover:shadow-md transition-all duration-200 cursor-pointer hover:border-primary/30">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-semibold text-primary">{t.tender_number}</span>
                <Badge variant="outline" className={`font-medium text-xs border ${STATUS_STYLES[displayStatus]}`}>
                  {displayStatus}
                </Badge>
                {t.is_cancelled && (
                  <Badge variant="outline" className="font-medium text-xs border bg-slate-100 text-slate-600 border-slate-200">
                    Cancelled
                  </Badge>
                )}
                {isOverdue && displayStatus !== 'Submitted' && !t.is_cancelled && (
                  <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Overdue</span>
                )}
                {t.outcome && (
                  <Badge variant="outline" className={`font-medium text-xs border ${OUTCOME_STYLES[t.outcome] || ''}`}>
                    {t.outcome}
                  </Badge>
                )}
              </div>
              <h3 className="font-semibold text-sm mt-1.5">{t.title}</h3>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                {t.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {t.location}
                  </span>
                )}
                {t.closing_date && (
                  <span className="flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" /> Closes {format(parseISO(t.closing_date.split('T')[0]), 'MMM d, yyyy')}
                  </span>
                )}
                {t.submitted_at && Number.isFinite(Number(t.lump_sum_price)) && t.lump_sum_price !== null && (
                  <span>Your price: {nzCurrency(t.lump_sum_price)}</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

export default function MyTenders() {
  const { data: tenders = [], isLoading, isError } = useQuery({
    queryKey: ['my-tenders'],
    queryFn: async () => {
      const res = await invokeFunction('subcontractorPortal', { action: 'listMine' });
      return res?.data?.tenders ?? [];
    },
  });

  const sorted = [...tenders].sort((a, b) => new Date(b.sent_date || 0) - new Date(a.sent_date || 0));

  return (
    <div>
      <PageHeader title="My Tenders" description="Every tender you've been invited to" />

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : isError ? (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">Could not load your tenders. Please try again shortly.</CardContent></Card>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No tenders yet"
          description="Tenders you're invited to price will show up here."
        />
      ) : (
        <div className="space-y-3">
          {sorted.map(t => <TenderRow key={t.token} t={t} />)}
        </div>
      )}
    </div>
  );
}
