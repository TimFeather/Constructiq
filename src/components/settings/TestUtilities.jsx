import { invokeFunction } from '@/api/supabaseClient';
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, RefreshCw, Trash2, Users, BarChart2, ShieldCheck, Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const ACTIONS = [
  {
    action: 'reset_invitation_state',
    label: 'Reset Invitation State',
    description: 'Deletes InvitedUser and PendingProjectAssignment records only. Does NOT touch registered users, auth identities, or project memberships.',
    danger: true,
  },
  {
    action: 'purge_test_users',
    label: 'Purge Test Users',
    description: 'Removes all non-admin registered users, their project team references, and related invitation records. Emails become free to re-register.',
    danger: true,
  },
  {
    action: 'clear_deactivated_users',
    label: 'Clear Deactivated Users',
    description: 'Permanently removes all users flagged as disabled (data.disabled = true), including their project memberships and invitation records.',
    danger: true,
  },
  {
    action: 'delete_archived_tenders',
    label: 'Delete Archived Tenders',
    description: 'Permanently deletes all tenders with status=Archived and all related records (invitations, submissions, notices).',
    danger: true,
  },
  {
    action: 'delete_archived_projects',
    label: 'Delete Archived Projects',
    description: 'Permanently deletes all projects with status=Archived and all related records (documents, RFIs, tasks, contract instructions).',
    danger: true,
  },
  {
    action: 'delete_archived_documents',
    label: 'Delete Archived Documents',
    description: 'Permanently deletes all documents marked as archived.',
    danger: true,
  },
  {
    action: 'delete_archived_rfis',
    label: 'Delete Archived RFIs',
    description: 'Permanently deletes all RFIs marked as archived.',
    danger: true,
  },
];

function SummaryPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await invokeFunction('testReset', { action: 'environment_summary' });
      if (res.data?.disabled) {
        toast({ title: 'Utilities disabled', description: res.data.message });
      } else {
        setSummary(res.data?.summary || null);
      }
    } catch (e) {
      toast({ title: 'Failed to load summary', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const STAT_ROWS = summary ? [
    { label: 'Total Users', value: summary.users_total },
    { label: 'Admins', value: summary.admins },
    { label: 'Internal', value: summary.internal },
    { label: 'External', value: summary.external },
    { label: 'Pricing', value: summary.pricing },
    { label: 'Active', value: summary.active },
    { label: 'Deactivated', value: summary.deactivated, warn: summary.deactivated > 0 },
    { label: 'Pending Invitations', value: summary.pending_invitations },
    { label: 'Pending Assignments', value: summary.pending_assignments },
  ] : [];

  return (
    <div className="p-3 rounded-lg bg-white border border-amber-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Environment Summary</p>
          <p className="text-xs text-muted-foreground mt-0.5">Snapshot of users, roles, and pending state.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="flex-shrink-0 h-8 gap-1.5 text-xs"
          disabled={loading}
          onClick={load}
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BarChart2 className="w-3 h-3" />}
          {loading ? 'Loading...' : 'Load'}
        </Button>
      </div>
      {summary && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {STAT_ROWS.map(({ label, value, warn }) => (
            <div key={label} className={`rounded-md px-3 py-2 border text-xs flex flex-col gap-0.5 ${warn ? 'bg-red-50 border-red-200' : 'bg-muted/40 border-border'}`}>
              <span className="text-muted-foreground">{label}</span>
              <span className={`text-base font-semibold tabular-nums leading-tight ${warn ? 'text-red-600' : 'text-foreground'}`}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Phase 6 storage migration trigger (temporary — remove after Phase 7) ──────
// Drives the migrateStorageToPrivate edge function: a Dry Run that only counts,
// and an Execute that copies private files Documents -> project-files and rewrites
// their stored paths. Execute is non-destructive (originals are kept) and idempotent.
function StorageMigrationPanel() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(null); // 'dry-run' | 'execute' | null
  const [report, setReport] = useState(null);
  const [progress, setProgress] = useState('');

  const dryRun = async () => {
    setBusy('dry-run');
    setReport(null);
    setProgress('');
    try {
      const res = await invokeFunction('migrateStorageToPrivate', { mode: 'dry-run' });
      setReport(res.data);
    } catch (e) {
      toast({ title: 'Dry run failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const execute = async () => {
    if (!window.confirm(
      'Copy all private files from the public Documents bucket into project-files and rewrite their stored paths?\n\n' +
      'This is non-destructive (originals are kept) and safe to re-run. Make sure you have your CSV backups first.'
    )) return;

    setBusy('execute');
    setReport(null);
    setProgress('Starting…');
    try {
      let last = null;
      // The function processes up to `limit` files per call; loop until nothing
      // is left or a call makes no progress (prevents an infinite loop on errors).
      for (let i = 0; i < 50; i++) {
        const res = await invokeFunction('migrateStorageToPrivate', { mode: 'execute', limit: 500 });
        last = res.data;
        const s = last?.summary || {};
        setProgress(`Pass ${i + 1}: migrated ${s.total_migrated ?? 0}, remaining ${s.remaining ?? '?'}, errors ${s.total_errors ?? 0}`);
        if (!s.remaining || s.remaining <= 0) break;
        if (!s.total_migrated || s.total_migrated <= 0) break; // no progress — stop
      }
      setReport(last);
      const s = last?.summary || {};
      toast({
        title: 'Migration complete',
        description: `Migrated ${s.total_migrated ?? 0} file(s), ${s.remaining ?? 0} remaining, ${s.total_errors ?? 0} error(s).`,
      });
    } catch (e) {
      toast({ title: 'Migration failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const s = report?.summary;
  const t = report?.tables;

  return (
    <div className="p-3 rounded-lg bg-white border border-indigo-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-indigo-600" /> Storage Security Migration (Phase 6)
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Copies private files (documents, RFIs, contract instructions) from the public Documents bucket
            into the private project-files bucket and rewrites their paths. Non-destructive &amp; idempotent.
            Run Dry Run first.
          </p>
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!!busy} onClick={dryRun}>
            {busy === 'dry-run' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            {busy === 'dry-run' ? 'Scanning…' : 'Dry Run'}
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700" disabled={!!busy} onClick={execute}>
            {busy === 'execute' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
            {busy === 'execute' ? 'Migrating…' : 'Execute'}
          </Button>
        </div>
      </div>

      {progress && <p className="mt-2 text-xs font-mono text-indigo-700">{progress}</p>}

      {s && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: report.mode === 'execute' ? 'Migrated' : 'To migrate', value: report.mode === 'execute' ? s.total_migrated : s.total_to_migrate },
              { label: 'Remaining', value: s.remaining, warn: s.remaining > 0 },
              { label: 'Errors', value: s.total_errors, warn: s.total_errors > 0 },
              { label: 'Mode', value: report.mode },
            ].map(({ label, value, warn }) => (
              <div key={label} className={`rounded-md px-3 py-2 border text-xs flex flex-col gap-0.5 ${warn ? 'bg-red-50 border-red-200' : 'bg-muted/40 border-border'}`}>
                <span className="text-muted-foreground">{label}</span>
                <span className={`text-base font-semibold tabular-nums leading-tight ${warn ? 'text-red-600' : 'text-foreground'}`}>{value}</span>
              </div>
            ))}
          </div>
          {t && (
            <div className="text-[11px] font-mono text-muted-foreground space-y-1">
              {['documents', 'rfis', 'contract_instructions'].map(name => {
                const x = t[name];
                if (!x) return null;
                return (
                  <div key={name}>
                    <span className="text-foreground font-medium">{name}</span>: rows {x.rows_scanned}, to_migrate {x.to_migrate}, already_path {x.already_path}, external {x.external}, migrated {x.migrated}, errors {x.errors?.length || 0}
                  </div>
                );
              })}
            </div>
          )}
          {(() => {
            const allErrors = t ? [...(t.documents?.errors || []), ...(t.rfis?.errors || []), ...(t.contract_instructions?.errors || [])] : [];
            if (allErrors.length === 0) return null;
            return (
              <div className="rounded-md p-2 bg-red-50 border border-red-200 text-[11px] font-mono text-red-700 max-h-40 overflow-auto">
                {allErrors.slice(0, 20).map((e, i) => (
                  <div key={i}>{e.id} — {e.path}: {e.error}</div>
                ))}
                {allErrors.length > 20 && <div>…and {allErrors.length - 20} more</div>}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default function TestUtilities() {
  const { toast } = useToast();
  const [running, setRunning] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const run = async (action, label) => {
    setRunning(action);
    setLastResult(null);
    try {
      const res = await invokeFunction('testReset', { action });
      const data = res.data;
      if (data?.disabled) {
        setLastResult({ ok: false, message: data.message });
      } else {
        setLastResult({ ok: true, message: data?.message || 'Done' });
        toast({ title: `${label} complete`, description: data?.message });
      }
    } catch (e) {
      setLastResult({ ok: false, message: e.message });
      toast({ title: `${label} failed`, description: e.message, variant: 'destructive' });
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <CardTitle className="text-base text-amber-800">Test Utilities</CardTitle>
          <Badge variant="outline" className="text-xs text-amber-700 border-amber-400 bg-amber-100">Dev / QA</Badge>
        </div>
        <CardDescription className="text-amber-700 text-xs">
          Admin-only reset tools for repeatable onboarding and lifecycle testing.
          Set <code className="bg-amber-100 px-1 rounded">TEST_UTILITIES_DISABLED=true</code> to disable in production.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ACTIONS.map(({ action, label, description }) => (
          <div key={action} className="flex items-start justify-between gap-4 p-3 rounded-lg bg-white border border-amber-200">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="flex-shrink-0 h-8 gap-1.5 text-xs"
              disabled={!!running}
              onClick={() => run(action, label)}
            >
              {running === action ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              {running === action ? 'Running...' : 'Run'}
            </Button>
          </div>
        ))}

        <StorageMigrationPanel />

        <SummaryPanel />

        {lastResult && (
          <div className={`rounded-lg p-3 text-xs font-mono border ${lastResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {lastResult.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}