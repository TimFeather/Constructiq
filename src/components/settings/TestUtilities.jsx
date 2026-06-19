import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function TestUtilities() {
  const { toast } = useToast();
  const [running, setRunning] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const run = async (action, label) => {
    setRunning(action);
    setLastResult(null);
    try {
      const res = await base44.functions.invoke('testReset', { action });
      const data = res.data;
      if (data?.disabled) {
        setLastResult({ ok: false, message: data.message });
      } else {
        setLastResult({ ok: true, message: data?.message || 'Done', detail: data });
        toast({ title: `${label} complete`, description: data?.message });
      }
    } catch (e) {
      setLastResult({ ok: false, message: e.message });
      toast({ title: `${label} failed`, description: e.message, variant: 'destructive' });
    } finally {
      setRunning(null);
    }
  };

  const ACTIONS = [
    {
      action: 'purge_test_users',
      label: 'Purge Test Users',
      description: 'Remove all non-admin InvitedUser, PendingProjectAssignment records and deactivate registered test accounts.',
      danger: true,
    },
    {
      action: 'reset_invitations',
      label: 'Reset Invitations',
      description: 'Delete all InvitedUser records and reset PendingProjectAssignment statuses to Pending.',
      danger: true,
    },
    {
      action: 'clear_audit_logs',
      label: 'Clear Audit Logs',
      description: 'Delete all AuditLog records. Use before a clean test run.',
      danger: false,
    },
  ];

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <CardTitle className="text-base text-amber-800">TEST RESET MODE ONLY</CardTitle>
          <Badge variant="outline" className="text-xs text-amber-700 border-amber-400 bg-amber-100">Dev / QA</Badge>
        </div>
        <CardDescription className="text-amber-700 text-xs">
          These utilities reset system state for repeatable onboarding and lifecycle testing.
          Disable before going to production via the toggle in this section.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ACTIONS.map(({ action, label, description, danger }) => (
          <div key={action} className="flex items-start justify-between gap-4 p-3 rounded-lg bg-white border border-amber-200">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            <Button
              size="sm"
              variant={danger ? 'destructive' : 'outline'}
              className="flex-shrink-0 h-8 gap-1.5 text-xs"
              disabled={!!running}
              onClick={() => run(action, label)}
            >
              {running === action ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              {running === action ? 'Running...' : 'Run'}
            </Button>
          </div>
        ))}

        {lastResult && (
          <div className={`rounded-lg p-3 text-xs font-mono border ${lastResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {lastResult.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}