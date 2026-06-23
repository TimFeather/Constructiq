import React, { useState } from 'react';
import { TenderInvitation } from '@/api/entities';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Bug, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * CRITICAL FIX 10: Admin-only Tender Debug Panel
 * Displays entity state for all invitations linked to this tender.
 * Visible to admin users only.
 */
export default function TenderDebugPanel({ tender }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);

  // Only render for admin
  if (user?.role !== 'admin') return null;

  return (
    <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">Tender Debug Panel</span>
          <span className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-mono">Admin Only</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-amber-600" /> : <ChevronDown className="w-4 h-4 text-amber-600" />}
      </button>

      {expanded && <DebugPanelContent tender={tender} />}
    </div>
  );
}

function DebugPanelContent({ tender }) {
  const { data: invitations = [], isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['debugInvitations', tender.id],
    queryFn: () => TenderInvitation.filter({ tender_id: tender.id }),
    refetchOnWindowFocus: false,
  });

  const invitees = tender.invitees || [];

  // Build a map of token → TenderInvitation record
  const invitationByToken = new Map(invitations.map(inv => [inv.token, inv]));

  // RLS Matrix
  const rlsMatrix = [
    { entity: 'Tender',           admin: '✓✓✓✓', pricing: '✓✓✓–', internal: '✓✓✓–', external: '–RR–', public: '––––' },
    { entity: 'TenderInvitation', admin: '✓✓✓✓', pricing: '✓✓✓–', internal: '––––', external: '––––', public: '––––' },
    { entity: 'TenderContact',    admin: '✓✓✓✓', pricing: '✓✓✓–', internal: '✓✓✓–', external: '––––', public: '––––' },
    { entity: 'Document',         admin: '✓✓✓✓', pricing: '✓✓✓–', internal: '✓✓✓✓', external: '––––', public: '––––' },
    { entity: 'Folder',           admin: '✓✓✓✓', pricing: '––––', internal: '✓✓✓✓', external: '––––', public: '––––' },
  ];

  return (
    <div className="px-4 pb-4 space-y-4 border-t border-amber-200 dark:border-amber-700">

      {/* Tender summary */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono">
        <DebugRow label="Tender ID" value={tender.id} />
        <DebugRow label="Status" value={tender.status} />
        <DebugRow label="Invitees (array)" value={invitees.length} />
        <DebugRow label="TenderInvitation records" value={isLoading ? '…' : invitations.length} />
      </div>

      {/* Per-invitee diagnostic */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Invitation Records</p>
          <Button size="sm" variant="outline" className="h-6 text-xs gap-1 border-amber-300" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
        </div>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : invitees.length === 0 ? (
          <p className="text-xs text-muted-foreground">No invitees on this tender yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {invitees.map(inv => {
              const record = invitationByToken.get(inv.token);
              const hasRecord = !!record;
              const tokenMatch = record?.token === inv.token;
              const tenderMatch = record?.tender_id === tender.id;
              const allGood = hasRecord && tokenMatch && tenderMatch;

              return (
                <div key={inv.id} className={`border rounded p-2 text-xs font-mono space-y-1 ${allGood ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-2">
                    {allGood
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />}
                    <span className="font-semibold">{inv.full_name}</span>
                    <span className="text-muted-foreground">{inv.email}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-5">
                    <DebugRow label="Array token" value={inv.token?.slice(0, 8) + '…'} />
                    <DebugRow label="Invitation ID" value={record?.id?.slice(0, 8) + (record?.id ? '…' : '—')} ok={hasRecord} />
                    <DebugRow label="DB token match" value={tokenMatch ? 'YES' : 'NO'} ok={tokenMatch} />
                    <DebugRow label="tender_id match" value={tenderMatch ? 'YES' : 'NO'} ok={tenderMatch} />
                    <DebugRow label="DB status" value={record?.status || '—'} />
                    <DebugRow label="Array status" value={inv.status || '—'} />
                    <DebugRow label="sent_date" value={record?.sent_date ? new Date(record.sent_date).toLocaleString('en-NZ') : '—'} />
                    <DebugRow label="opened_date" value={record?.opened_date ? new Date(record.opened_date).toLocaleString('en-NZ') : '—'} />
                    {!hasRecord && (
                      <div className="col-span-2 text-red-600 font-semibold">⚠ No TenderInvitation record found for this token</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {dataUpdatedAt > 0 && (
          <p className="text-xs text-muted-foreground mt-1">Last refreshed: {new Date(dataUpdatedAt).toLocaleTimeString('en-NZ')}</p>
        )}
      </div>

      {/* RLS Matrix */}
      <div>
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-2">RLS Policy Matrix (C=Create R=Read U=Update D=Delete)</p>
        <div className="overflow-x-auto">
          <table className="text-xs font-mono w-full border-collapse">
            <thead>
              <tr className="bg-amber-100 dark:bg-amber-900/40">
                <th className="text-left px-2 py-1 border border-amber-200">Entity</th>
                <th className="px-2 py-1 border border-amber-200">Admin</th>
                <th className="px-2 py-1 border border-amber-200">Pricing</th>
                <th className="px-2 py-1 border border-amber-200">Internal</th>
                <th className="px-2 py-1 border border-amber-200">External</th>
                <th className="px-2 py-1 border border-amber-200">Public</th>
              </tr>
            </thead>
            <tbody>
              {rlsMatrix.map(row => (
                <tr key={row.entity} className="border-b border-amber-100">
                  <td className="px-2 py-1 border border-amber-200 font-semibold">{row.entity}</td>
                  <td className="px-2 py-1 border border-amber-200 text-center text-green-700">{row.admin}</td>
                  <td className="px-2 py-1 border border-amber-200 text-center text-blue-700">{row.pricing}</td>
                  <td className="px-2 py-1 border border-amber-200 text-center text-purple-700">{row.internal}</td>
                  <td className="px-2 py-1 border border-amber-200 text-center text-orange-700">{row.external}</td>
                  <td className="px-2 py-1 border border-amber-200 text-center text-gray-500">{row.public}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground mt-1">✓ = allowed, – = denied, R = read own records only</p>
        </div>
      </div>

      {/* Source of truth note */}
      <div className="flex items-start gap-2 bg-white dark:bg-black/20 border border-amber-200 rounded p-2 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Source of Truth: </span>
          <span>TenderInvitation entity (token → tender_id). Portal link validation uses only this entity. Legacy Tender.invitees[] is maintained for scoring UI compatibility only.</span>
        </div>
      </div>
    </div>
  );
}

function DebugRow({ label, value, ok }) {
  const hasOk = ok !== undefined;
  return (
    <div className="flex gap-1">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className={hasOk ? (ok ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold') : ''}>
        {String(value ?? '—')}
      </span>
    </div>
  );
}