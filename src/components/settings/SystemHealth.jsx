import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { canAccess, canEdit, canManage, getRole } from '@/lib/permissions';
import { clearClientAuthState } from '@/lib/clientAuth';
import { RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

const MODULES = ['dashboard', 'projects', 'programme', 'rfis', 'documents', 'tenders', 'subcontractors', 'settings', 'users'];

function HealthRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between py-1.5 border-b border-border/50 last:border-0 gap-4">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-xs font-medium text-right break-all ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

function Allow({ ok }) {
  return ok
    ? <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium"><CheckCircle className="w-3 h-3" /> allowed</span>
    : <span className="inline-flex items-center gap-1 text-red-500 text-xs font-medium"><XCircle className="w-3 h-3" /> blocked</span>;
}

export default function SystemHealth() {
  const { user, isSettingUpWorkspace, checkUserAuth } = useAuth();
  const [lastRefresh, setLastRefresh] = useState(new Date().toISOString());
  const [runningAction, setRunningAction] = useState(null);
  const [actionLog, setActionLog] = useState([]);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-health'],
    queryFn: () => base44.entities.Project.list(),
  });

  function addLog(msg) {
    setActionLog(prev => [`${new Date().toLocaleTimeString('en-NZ')}: ${msg}`, ...prev].slice(0, 10));
  }

  // Session storage stats
  const [storageStats, setStorageStats] = useState({ ls: 0, ss: 0 });
  useEffect(() => {
    setStorageStats({ ls: Object.keys(localStorage).length, ss: Object.keys(sessionStorage).length });
  }, [lastRefresh]);

  // Project membership for current user
  const userEmail = user?.email?.toLowerCase().trim();
  const memberProjects = projects.map(p => {
    const team = p.team || [];
    const entry = team.find(m => m.user_email?.toLowerCase().trim() === userEmail);
    return { name: p.name, found: !!entry, role: entry?.role || null };
  });

  async function handleRefreshAuth() {
    setRunningAction('refreshAuth');
    await checkUserAuth();
    setLastRefresh(new Date().toISOString());
    addLog('Auth context refreshed');
    setRunningAction(null);
  }

  async function handleRefreshSession() {
    setRunningAction('refreshSession');
    try {
      await base44.auth.me();
      setLastRefresh(new Date().toISOString());
      addLog('User session refreshed');
    } catch (e) {
      addLog(`Session refresh failed: ${e.message}`);
    }
    setRunningAction(null);
  }

  function handleClearCache() {
    clearClientAuthState();
    setLastRefresh(new Date().toISOString());
    setStorageStats({ ls: Object.keys(localStorage).length, ss: Object.keys(sessionStorage).length });
    addLog('Client auth cache cleared');
  }

  async function handleRunSync() {
    setRunningAction('sync');
    try {
      const result = await base44.functions.invoke('processPendingAssignments', {});
      const { activated, skipped } = result?.data || {};
      addLog(`processPendingAssignments: activated=${activated}, skipped=${skipped}`);
      setLastRefresh(new Date().toISOString());
    } catch (e) {
      addLog(`Sync failed: ${e.message}`);
    }
    setRunningAction(null);
  }

  const role = getRole(user);

  return (
    <div className="space-y-4">

      {/* 1. Current User State */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 text-primary" /> Current User State</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthRow label="user.id" value={user?.id} mono />
          <HealthRow label="user.email" value={user?.email} mono />
          <HealthRow label="user.role" value={user?.role} />
          <HealthRow label="project role (construction_role)" value={user?.construction_role || user?.data?.construction_role} />
          <HealthRow label="resolved permission role" value={role} />
          <HealthRow label="isSettingUpWorkspace" value={String(isSettingUpWorkspace)} />
          <HealthRow label="auth status" value={user ? 'authenticated' : 'unauthenticated'} />
          <HealthRow label="assigned projects (team match)" value={memberProjects.filter(p => p.found).map(p => p.name).join(', ') || 'none'} />
        </CardContent>
      </Card>

      {/* 2. Permission Matrix */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4 text-primary" /> Permission Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[1fr_auto_auto_auto] text-xs gap-x-4 gap-y-1 items-center">
            <span className="font-semibold text-muted-foreground">Module</span>
            <span className="font-semibold text-muted-foreground text-center">Access</span>
            <span className="font-semibold text-muted-foreground text-center">Edit</span>
            <span className="font-semibold text-muted-foreground text-center">Manage</span>
            {MODULES.map(mod => (
              <React.Fragment key={mod}>
                <span className="capitalize py-1 border-t border-border/40">{mod}</span>
                <span className="border-t border-border/40 flex justify-center"><Allow ok={canAccess(user, mod)} /></span>
                <span className="border-t border-border/40 flex justify-center"><Allow ok={canEdit(user, mod)} /></span>
                <span className="border-t border-border/40 flex justify-center"><Allow ok={canManage(user, mod)} /></span>
              </React.Fragment>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 3. Project Membership Audit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4 text-primary" /> Project Membership Audit</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-xs text-muted-foreground">No projects found.</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_auto_1fr] text-xs font-semibold text-muted-foreground pb-1 border-b border-border gap-4">
                <span>Project</span>
                <span>Team Match</span>
                <span>Role</span>
              </div>
              {memberProjects.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_1fr] text-xs py-1 border-b border-border/40 last:border-0 gap-4 items-center">
                  <span className="font-medium truncate">{p.name}</span>
                  <Allow ok={p.found} />
                  <span className="text-muted-foreground">{p.role || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Session Health */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 text-primary" /> Session Health</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthRow label="localStorage keys" value={storageStats.ls} />
          <HealthRow label="sessionStorage keys" value={storageStats.ss} />
          <HealthRow label="auth loaded" value={user ? 'yes' : 'no'} />
          <HealthRow label="workspace setup complete" value={isSettingUpWorkspace ? 'in progress...' : 'yes'} />
          <HealthRow label="last refresh" value={new Date(lastRefresh).toLocaleString('en-NZ')} mono />
        </CardContent>
      </Card>

      {/* 5. Admin Actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4 text-primary" /> Admin Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!runningAction} onClick={handleRefreshAuth}>
              {runningAction === 'refreshAuth' ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Refresh Auth Context
            </Button>
            <Button size="sm" variant="outline" disabled={!!runningAction} onClick={handleRefreshSession}>
              {runningAction === 'refreshSession' ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Refresh User Session
            </Button>
            <Button size="sm" variant="outline" disabled={!!runningAction} onClick={handleClearCache}>
              Clear Client Auth Cache
            </Button>
            <Button size="sm" variant="outline" disabled={!!runningAction} onClick={handleRunSync}>
              {runningAction === 'sync' ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Run processPendingAssignments
            </Button>
          </div>
          {actionLog.length > 0 && (
            <div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-0.5">
              {actionLog.map((line, i) => <div key={i} className="text-muted-foreground">{line}</div>)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}