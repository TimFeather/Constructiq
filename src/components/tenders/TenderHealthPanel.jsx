/**
 * TenderHealthPanel
 * Health checks use TenderInvitee as source of truth.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, FileText, FolderOpen, Users, Send, ShieldCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function computeHealth(tender, invitees) {
  const docs   = tender.documents || [];
  const issues = [];

  // Document checks
  const docsWithoutUrl = docs.filter(d => !d.file_url);
  const docKeyCounts = new Map();
  for (const d of docs) {
    const k = `${d.folder_path || ''}|${d.name}`;
    docKeyCounts.set(k, (docKeyCounts.get(k) || 0) + 1);
  }
  const dupDocCount   = [...docKeyCounts.values()].filter(c => c > 1).length;
  const uniqueFolders = new Set(docs.map(d => d.folder_path || '').filter(Boolean));

  if (docs.length === 0)
    issues.push({ severity: 'error', msg: 'No documents uploaded' });
  if (docsWithoutUrl.length > 0)
    issues.push({ severity: 'error', msg: `${docsWithoutUrl.length} document${docsWithoutUrl.length !== 1 ? 's' : ''} missing file URL` });
  if (dupDocCount > 0)
    issues.push({ severity: 'warning', msg: `${dupDocCount} duplicate document name${dupDocCount !== 1 ? 's' : ''} detected` });

  // Invitee checks (from TenderInvitee)
  const invalidEmails = invitees.filter(i => i.email && !EMAIL_RE.test(i.email));
  const missingEmails = invitees.filter(i => !i.email);
  const seenEmails = new Set();
  const dupEmails = invitees.filter(i => {
    if (!i.email) return false;
    const k = i.email.toLowerCase();
    if (seenEmails.has(k)) return true;
    seenEmails.add(k);
    return false;
  });

  if (invalidEmails.length > 0)
    issues.push({ severity: 'error', msg: `${invalidEmails.length} invalid email address${invalidEmails.length !== 1 ? 'es' : ''}` });
  if (dupEmails.length > 0)
    issues.push({ severity: 'error', msg: `${dupEmails.length} duplicate email${dupEmails.length !== 1 ? 's' : ''} in invitee list` });
  if (invitees.length === 0)
    issues.push({ severity: 'warning', msg: 'No invitees added yet' });
  if (missingEmails.length > 0)
    issues.push({ severity: 'warning', msg: `${missingEmails.length} invitee${missingEmails.length !== 1 ? 's' : ''} without email — will not receive invitation` });
  if (tender.status === 'Issued' && invitees.length === 0)
    issues.push({ severity: 'warning', msg: 'Tender is Issued but has 0 invitees' });
  if (tender.status === 'Closed' && invitees.filter(i => i.status === 'Submitted').length === 0)
    issues.push({ severity: 'warning', msg: 'Tender is Closed but no submissions received' });

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const isReady    = errorCount === 0 && docs.length > 0 && invitees.length > 0;

  return {
    docs:     docs.length,
    folders:  uniqueFolders.size,
    invitees: invitees.length,
    issues,
    isReady,
    errorCount,
  };
}

export default function TenderHealthPanel({ tender, user }) {
  const { toast }         = useToast();
  const [testSending, setTestSending] = useState(false);
  const [lastValidated, setLastValidated] = useState(null);

  const { data: invitees = [] } = useQuery({
    queryKey: ['tenderInvitees', tender.id],
    queryFn:  () => base44.entities.TenderInvitee.filter({ tender_id: tender.id }),
    enabled:  !!tender.id,
  });

  const health = computeHealth(tender, invitees);

  const handleValidate = () => {
    setLastValidated(new Date());
    if (health.isReady) {
      toast({ title: '✓ Package validated — ready to issue', duration: 4000 });
    } else {
      toast({
        title: 'Validation issues found',
        description: `${health.errorCount} error${health.errorCount !== 1 ? 's' : ''} must be resolved before issuing`,
        variant: 'destructive',
        duration: 6000,
      });
    }
  };

  const handleTestEmail = async () => {
    if (!user?.email) return;
    setTestSending(true);
    try {
      // Create a temporary test invitee so sendTenderInvitations can find it
      const testToken = crypto.randomUUID();
      let testInviteeId = null;
      try {
        const testInvitee = await base44.entities.TenderInvitee.create({
          tender_id:  tender.id,
          full_name:  user.full_name || user.email,
          email:      user.email,
          status:     'Draft',
        });
        testInviteeId = testInvitee.id;
      } catch (_e) { /* non-fatal */ }

      const result = await base44.functions.invoke('sendTenderInvitations', {
        tenderId: tender.id,
        tenderInfo: {
          title:                tender.title,
          tender_number:        tender.tender_number,
          location:             tender.location             || '',
          closing_date:         tender.closing_date         || '',
          description:          tender.description          || '',
          trade_packages:       tender.trade_packages       || [],
        },
        appUrl: window.location.origin,
      });

      // Clean up test invitee + invitation
      if (testInviteeId) {
        await base44.entities.TenderInvitee.delete(testInviteeId).catch(() => {});
      }

      if (result.data?.sent > 0) {
        toast({ title: `Test email sent to ${user.email}`, duration: 5000 });
      } else {
        toast({
          title: 'Test email failed',
          description: result.data?.errors?.[0] || result.data?.message || 'Check RESEND_API_KEY and email branding',
          variant: 'destructive',
          duration: 6000,
        });
      }
    } catch (err) {
      toast({ title: 'Test email failed', description: err.message, variant: 'destructive', duration: 6000 });
    } finally {
      setTestSending(false);
    }
  };

  const statusColour = health.isReady
    ? 'text-green-700 bg-green-50 border-green-200'
    : health.errorCount > 0
      ? 'text-red-700 bg-red-50 border-red-200'
      : 'text-amber-700 bg-amber-50 border-amber-200';

  const StatusIcon = health.isReady ? CheckCircle2 : health.errorCount > 0 ? XCircle : AlertTriangle;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b">
        <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusColour}`}>
          <StatusIcon className="w-3.5 h-3.5" />
          {health.isReady
            ? 'Package Ready to Issue'
            : health.errorCount > 0
              ? `${health.errorCount} Error${health.errorCount !== 1 ? 's' : ''} — Cannot Issue`
              : 'Warnings — Review Before Issuing'}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleValidate}>
            <ShieldCheck className="w-3 h-3" /> Validate
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
            onClick={handleTestEmail} disabled={testSending || !user?.email}>
            {testSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {testSending ? 'Sending…' : 'Send Test Email'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x border-b bg-card">
        {[
          { icon: FileText,   label: 'Documents', value: health.docs },
          { icon: FolderOpen, label: 'Folders',   value: health.folders },
          { icon: Users,      label: 'Invitees',  value: health.invitees },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2.5 px-4 py-3">
            <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
              <p className="text-xl font-bold leading-none tabular-nums">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {health.issues.length > 0 ? (
        <div className="divide-y">
          {health.issues.map((issue, i) => (
            <div key={i} className={`flex items-center gap-2 px-4 py-2 text-xs ${
              issue.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
            }`}>
              {issue.severity === 'error'
                ? <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
              {issue.msg}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-green-700 bg-green-50">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
          All checks passed — package is ready to issue
          {lastValidated && (
            <span className="ml-auto text-green-600 opacity-70">
              Validated {lastValidated.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}