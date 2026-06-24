import { invokeFunction } from '@/api/supabaseClient';
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, RefreshCw, Trash2, Users, BarChart2 } from 'lucide-react';
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