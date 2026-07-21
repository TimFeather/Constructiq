/**
 * EmailDeliveryLog
 *
 * Every email the system has sent through Resend, with its live delivery
 * status from the resendWebhook edge function. Defaults to showing problems
 * first, since a bounced tender invitation is otherwise indistinguishable
 * from a delivered one.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Search, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  DELIVERY_STATUS_STYLES, DELIVERY_STATUS_LABELS, PROBLEM_STATUSES,
  isDeliveryProblem, explainDeliveryFailure, formatDeliveryTime,
} from '@/lib/emailDelivery';

const KIND_LABELS = {
  tender_invitation:           'Tender invitation',
  tender_invitation_resend:    'Invitation resend',
  reminder_tender_external:    'Reminder — invitee',
  reminder_tender_internal:    'Reminder — internal',
  reminder_questions_deadline: 'Reminder — questions close',
  tender_outcome:              'Tender outcome',
};

const PAGE_SIZE = 100;

export default function EmailDeliveryLog() {
  const [search, setSearch]         = useState('');
  const [statusFilter, setFilter]   = useState('problems');
  const [expandedId, setExpandedId] = useState(null);

  const { data: messages = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['emailMessages', statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('email_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (statusFilter === 'problems')      query = query.in('status', PROBLEM_STATUSES);
      else if (statusFilter !== 'all')      query = query.eq('status', statusFilter);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['emailEvents', expandedId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_events')
        .select('*')
        .eq('message_id', expandedId)
        .order('occurred_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!expandedId,
  });

  const term = search.trim().toLowerCase();
  const visible = term
    ? messages.filter(m =>
        m.recipient?.toLowerCase().includes(term) ||
        m.subject?.toLowerCase().includes(term))
    : messages;

  const problemCount = messages.filter(m => isDeliveryProblem(m.status)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Email Delivery Log</CardTitle>
            <CardDescription className="text-xs">
              Live delivery status from Resend. Updates as recipients receive, open, or bounce mail.
            </CardDescription>
          </div>
          <Button
            variant="outline" size="sm" className="h-8 text-xs flex-shrink-0"
            onClick={() => refetch()} disabled={isFetching}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recipient or subject…"
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 text-sm w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="problems">Problems only</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="bounced">Bounced</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="complained">Spam reports</SelectItem>
              <SelectItem value="delayed">Delayed</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="opened">Opened</SelectItem>
              <SelectItem value="sent">Sent (no result yet)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {statusFilter === 'problems' && problemCount > 0 && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900">
              {problemCount} email{problemCount !== 1 ? 's' : ''} did not reach the recipient.
              Fix the address on the contact record, then resend — retrying the same address will bounce again.
            </p>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {statusFilter === 'problems'
              ? 'No delivery problems. Every email sent has been accepted by the recipient\'s server.'
              : 'No emails logged yet.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {visible.map(msg => {
              const expanded = expandedId === msg.id;
              const problem  = isDeliveryProblem(msg.status);
              return (
                <div key={msg.id} className="border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : msg.id)}
                    className="w-full flex items-start gap-2 p-2.5 text-left hover:bg-muted/40 transition-colors"
                  >
                    {expanded
                      ? <ChevronDown className="w-3.5 h-3.5 mt-1 flex-shrink-0 text-muted-foreground" />
                      : <ChevronRight className="w-3.5 h-3.5 mt-1 flex-shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium break-all">{msg.recipient}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${DELIVERY_STATUS_STYLES[msg.status] || 'bg-gray-100 text-gray-700'}`}>
                          {DELIVERY_STATUS_LABELS[msg.status] || msg.status}
                        </span>
                        {msg.kind && (
                          <span className="text-xs bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                            {KIND_LABELS[msg.kind] || msg.kind}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 break-words">{msg.subject || '(no subject)'}</p>
                      {problem && (
                        <p className="text-xs text-red-600 mt-1">{explainDeliveryFailure(msg)}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0 hidden sm:block">
                      {formatDeliveryTime(msg.last_event_at || msg.created_at)}
                    </span>
                  </button>

                  {expanded && (
                    <div className="border-t bg-muted/20 p-3 space-y-2">
                      {msg.error_message && (
                        <div>
                          <p className="text-xs font-medium mb-0.5">Server response</p>
                          <code className="block text-xs bg-background border rounded p-2 break-all">
                            {msg.error_message}
                          </code>
                          {(msg.error_type || msg.error_subtype) && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {[msg.error_type, msg.error_subtype].filter(Boolean).join(' / ')}
                            </p>
                          )}
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-medium mb-1">Timeline</p>
                        {events.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No webhook events recorded — the send was logged locally only.
                          </p>
                        ) : (
                          <ul className="space-y-0.5">
                            {events.map(ev => (
                              <li key={ev.id} className="text-xs text-muted-foreground flex gap-2">
                                <span className="font-mono">{formatDeliveryTime(ev.occurred_at)}</span>
                                <span>{ev.event_type.replace(/^email\./, '')}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {msg.resend_id && (
                        <p className="text-xs text-muted-foreground font-mono break-all">
                          Resend id: {msg.resend_id}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {messages.length >= PAGE_SIZE && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                Showing the {PAGE_SIZE} most recent. Narrow with search or a status filter.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
