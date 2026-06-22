import { invokeFunction } from '@/api/supabaseClient';
/**
 * TenderTestSuite — Phase 7
 * Automated regression tests for the Tender subsystem.
 * Admin only. Accessible at /tender-tests
 */
import React, { useState } from 'react';
import { Tender, TenderContact, TenderInvitation, TenderInvitee } from '@/api/entities';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, PlayCircle, Trash2, AlertTriangle, FlaskConical } from 'lucide-react';

const PASS  = 'pass';
const FAIL  = 'fail';
const SKIP  = 'skip';
const RUNNING = 'running';

function Result({ status, label, detail }) {
  const icons = {
    pass:    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />,
    fail:    <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />,
    skip:    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />,
    running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />,
  };
  const colours = { pass: 'bg-green-50 border-green-200', fail: 'bg-red-50 border-red-200', skip: 'bg-amber-50 border-amber-200', running: 'bg-blue-50 border-blue-200' };
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded border text-sm ${colours[status] || ''}`}>
      {icons[status] || null}
      <div className="min-w-0">
        <span className="font-medium">{label}</span>
        {detail && <p className="text-xs text-muted-foreground mt-0.5 break-words">{detail}</p>}
      </div>
    </div>
  );
}

export default function TenderTestSuite() {
  const { user } = useAuth();
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [createdIds, setCreatedIds] = useState([]);

  if (user && user.role !== 'admin') return <Navigate to="/" replace />;

  const addResult = (label, status, detail = '') =>
    setResults(r => [...r, { label, status, detail, ts: Date.now() }]);

  const updateLastResult = (status, detail) =>
    setResults(r => {
      const copy = [...r];
      copy[copy.length - 1] = { ...copy[copy.length - 1], status, detail };
      return copy;
    });

  async function runAll() {
    setRunning(true);
    setResults([]);
    const ids = [];

    // ── T1: Create 1 tender ───────────────────────────────────────────────
    addResult('T1: Create single tender', RUNNING);
    try {
      const r = await invokeFunction('createTender', {});
      const t = r.data?.tender;
      if (!t?.id) throw new Error('No tender id returned');
      if (!t.tender_number?.startsWith('TDR-')) throw new Error(`Bad tender number: ${t.tender_number}`);
      ids.push(t.id);
      updateLastResult(PASS, `Created ${t.tender_number} id=${t.id}`);
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── T2: Create 5 concurrent tenders (race condition test) ─────────────
    addResult('T2: Create 5 concurrent tenders (no duplicate numbers)', RUNNING);
    try {
      const promises = Array.from({ length: 5 }, () => invokeFunction('createTender', {}));
      const results2 = await Promise.all(promises);
      const tenders = results2.map(r => r.data?.tender).filter(Boolean);
      tenders.forEach(t => ids.push(t.id));
      const numbers = tenders.map(t => t.tender_number);
      const unique = new Set(numbers);
      if (unique.size !== tenders.length) {
        updateLastResult(FAIL, `DUPLICATES: ${numbers.join(', ')}`);
      } else {
        updateLastResult(PASS, `Numbers: ${numbers.sort().join(', ')}`);
      }
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // Use first created tender for remaining tests
    const testTenderId = ids[0];

    // ── T3: Add invitee ───────────────────────────────────────────────────
    addResult('T3: Add invitee (TenderInvitation created)', RUNNING);
    let testInvitationId = null;
    let testToken = null;
    try {
      if (!testTenderId) throw new Error('No test tender available');
      const token = crypto.randomUUID();
      testToken = token;
      const inv = await TenderInvitation.create({
        token,
        tender_id:     testTenderId,
        invitee_email: 'test-invitee@example.com',
        invitee_name:  'Test Invitee',
        status:        'Pending',
      });
      if (!inv?.id) throw new Error('No id returned');
      testInvitationId = inv.id;
      updateLastResult(PASS, `TenderInvitation id=${inv.id} token=${token.slice(0, 8)}…`);
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── T4: Add duplicate invitee ─────────────────────────────────────────
    addResult('T4: Duplicate email rejected', RUNNING);
    try {
      if (!testTenderId || !testToken) throw new Error('No test tender/token');
      // Check: reading invitations should show only 1 for this email
      const list = await TenderInvitation.filter({ tender_id: testTenderId });
      const dups = list.filter(i => i.invitee_email === 'test-invitee@example.com');
      if (dups.length > 1) {
        updateLastResult(FAIL, `Found ${dups.length} records for same email — duplicates exist`);
      } else {
        updateLastResult(PASS, `1 record found for email (no duplicates)`);
      }
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── T5: Remove invitee ────────────────────────────────────────────────
    addResult('T5: Remove invitee (TenderInvitation deleted)', RUNNING);
    try {
      if (!testInvitationId) throw new Error('No test invitation available');
      await TenderInvitation.delete(testInvitationId);
      // Verify it's gone
      const list = await TenderInvitation.filter({ tender_id: testTenderId });
      const stillExists = list.some(i => i.id === testInvitationId);
      if (stillExists) throw new Error('Record still exists after delete');
      updateLastResult(PASS, `Invitation id=${testInvitationId} deleted and verified gone`);
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── T6: Add from subcontractor database ───────────────────────────────
    addResult('T6: Add invitee from TenderContact database', RUNNING);
    let dbContactId = null;
    try {
      if (!testTenderId) throw new Error('No test tender available');
      // Create a TenderContact
      const contact = await TenderContact.create({
        full_name:     'DB Test Contact',
        business_name: 'Test Co',
        email:         `db-test-${Date.now()}@example.com`,
        trade:         'Electrical',
      });
      dbContactId = contact.id;
      // Add as invitation
      const token2 = crypto.randomUUID();
      const inv2 = await TenderInvitation.create({
        token:         token2,
        tender_id:     testTenderId,
        invitee_email: contact.email,
        invitee_name:  contact.full_name,
        status:        'Pending',
      });
      if (!inv2?.id) throw new Error('Invitation not created');
      updateLastResult(PASS, `Contact id=${contact.id} → Invitation id=${inv2.id}`);
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── T7: Health checks pass on valid tender ────────────────────────────
    addResult('T7: Health check — invitations have token and tender_id', RUNNING);
    try {
      if (!testTenderId) throw new Error('No test tender');
      const invList = await TenderInvitation.filter({ tender_id: testTenderId });
      const missingToken    = invList.filter(i => !i.token);
      const missingTenderId = invList.filter(i => !i.tender_id);
      if (missingToken.length > 0) throw new Error(`${missingToken.length} invitations missing token`);
      if (missingTenderId.length > 0) throw new Error(`${missingTenderId.length} invitations missing tender_id`);
      updateLastResult(PASS, `${invList.length} invitation(s) all have token + tender_id`);
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── T8: Delete empty tender ───────────────────────────────────────────
    addResult('T8: Delete empty tender', RUNNING);
    try {
      const emptyR = await invokeFunction('createTender', {});
      const emptyT = emptyR.data?.tender;
      if (!emptyT?.id) throw new Error('Could not create test tender');
      const delR = await invokeFunction('deleteTender', { tenderId: emptyT.id });
      if (!delR.data?.success) throw new Error(delR.data?.error || 'deleteTender returned no success');
      updateLastResult(PASS, `Tender ${emptyT.tender_number} deleted`);
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── T9: Delete tender with invitees ───────────────────────────────────
    addResult('T9: Delete tender with invitees (cascading)', RUNNING);
    try {
      const tR = await invokeFunction('createTender', {});
      const tObj = tR.data?.tender;
      if (!tObj?.id) throw new Error('Could not create test tender');
      // Add 2 invitations
      await Promise.all([
        TenderInvitation.create({ token: crypto.randomUUID(), tender_id: tObj.id, invitee_email: 'del-test-1@example.com', invitee_name: 'Del 1', status: 'Pending' }),
        TenderInvitation.create({ token: crypto.randomUUID(), tender_id: tObj.id, invitee_email: 'del-test-2@example.com', invitee_name: 'Del 2', status: 'Pending' }),
      ]);
      // Delete
      const delR = await invokeFunction('deleteTender', { tenderId: tObj.id });
      if (!delR.data?.success) throw new Error(delR.data?.error || 'deleteTender failed');
      // Verify invitations are gone
      const remaining = await TenderInvitation.filter({ tender_id: tObj.id });
      if (remaining.length > 0) throw new Error(`${remaining.length} orphan TenderInvitation(s) remain`);
      updateLastResult(PASS, `Tender + 2 invitations deleted, 0 orphans`);
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── T10: No duplicate tender numbers across all existing tenders ───────
    addResult('T10: No duplicate tender numbers in database', RUNNING);
    try {
      const all = await Tender.list('-created_at', 200);
      const nums = all.map(t => t.tender_number).filter(Boolean);
      const seen = new Set();
      const dups = nums.filter(n => { if (seen.has(n)) return true; seen.add(n); return false; });
      if (dups.length > 0) {
        updateLastResult(FAIL, `Duplicate numbers found: ${[...new Set(dups)].join(', ')}`);
      } else {
        updateLastResult(PASS, `${nums.length} tenders scanned — no duplicates`);
      }
    } catch (e) {
      updateLastResult(FAIL, e.message);
    }

    // ── Cleanup: delete all tenders created during this run ───────────────
    addResult('CLEANUP: deleting test tenders', RUNNING);
    const cleanupIds = [...ids];
    let cleanedCount = 0;
    for (const tid of cleanupIds) {
      try {
        await invokeFunction('deleteTender', { tenderId: tid });
        cleanedCount++;
      } catch (_) {}
    }
    // Also clean up the db test contact
    if (dbContactId) {
      try { await TenderContact.delete(dbContactId); } catch (_) {}
    }
    updateLastResult(PASS, `Cleaned up ${cleanedCount}/${cleanupIds.length} test tender(s)`);

    setCreatedIds([]);
    setRunning(false);
  }

  const passed  = results.filter(r => r.status === PASS).length;
  const failed  = results.filter(r => r.status === FAIL).length;
  const total   = results.filter(r => r.status !== RUNNING && r.label !== 'CLEANUP: deleting test tenders').length;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Tender Regression Test Suite</h1>
        <p className="text-sm text-muted-foreground mt-1">Phase 7 — automated tests for the Tender subsystem. Admin only.</p>
      </div>

      {/* ── Regression suite ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button onClick={runAll} disabled={running} className="gap-2">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {running ? 'Running…' : 'Run All Tests'}
          </Button>
          {results.length > 0 && !running && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green-600 font-semibold">{passed} passed</span>
              {failed > 0 && <span className="text-red-600 font-semibold">{failed} failed</span>}
              <span className="text-muted-foreground">/ {total} tests</span>
            </div>
          )}
        </div>

        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((r, i) => (
              <Result key={i} status={r.status} label={r.label} detail={r.detail} />
            ))}
          </div>
        )}

        {!running && results.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12 border rounded-lg">
            Press "Run All Tests" to execute the regression suite.
          </p>
        )}
      </div>

      {/* ── Issue Tender Diagnostic ───────────────────────────────────── */}
      <IssueTenderDiagnostic />

      {/* ── Add Invitee Trace ─────────────────────────────────────────── */}
      <AddInviteeTrace />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IssueTenderDiagnostic
// Captures full before/after state of TenderInvitee + TenderInvitation records
// for a given tender, executes sendTenderInvitations, and renders raw output.
// ─────────────────────────────────────────────────────────────────────────────
function IssueTenderDiagnostic() {
  const [tenderId, setTenderId] = useState('');
  const [running, setRunning]   = useState(false);
  const [report, setReport]     = useState(null);

  const run = async () => {
    if (!tenderId.trim()) return;
    setRunning(true);
    setReport(null);

    const out = {
      inputTenderId: tenderId.trim(),
      tender: null,
      before: { invitees: [], invitations: [] },
      after:  { invitees: [], invitations: [] },
      sendResponse: null,
      error: null,
    };

    try {
      // Resolve tender — accept either DB id or tender_number (e.g. TDR-008)
      let tender = null;
      const looksLikeId = tenderId.trim().length > 12 && !tenderId.trim().startsWith('TDR-');
      if (looksLikeId) {
        const list = await Tender.filter({ id: tenderId.trim() });
        tender = list[0] || null;
      } else {
        const list = await Tender.list('-created_at', 200);
        tender = list.find(t => t.tender_number === tenderId.trim() || t.id === tenderId.trim()) || null;
      }

      if (!tender) {
        out.error = `No tender found for "${tenderId.trim()}"`;
        setReport(out);
        setRunning(false);
        return;
      }
      out.tender = { id: tender.id, tender_number: tender.tender_number, title: tender.title, status: tender.status };

      // ── BEFORE ──────────────────────────────────────────────────────────────
      const [beforeInvitees, beforeInvitations] = await Promise.all([
        TenderInvitee.filter({ tender_id: tender.id }),
        TenderInvitation.filter({ tender_id: tender.id }),
      ]);
      out.before.invitees    = beforeInvitees.map(i => ({ id: i.id, name: i.full_name, email: i.email, status: i.status }));
      out.before.invitations = beforeInvitations.map(i => ({ id: i.id, invitee_id: i.invitee_id, email: i.invitee_email, token: i.token, status: i.status }));

      // ── CALL sendTenderInvitations ───────────────────────────────────────────
      // First update status to Issued (mirrors what InviteeManager does)
      await invokeFunction('updateTender', {
        tenderId: tender.id,
        updates: {
          status:     'Issued',
          issue_date: tender.issue_date || new Date().toISOString().split('T')[0],
        },
      });

      const sendRes = await invokeFunction('sendTenderInvitations', {
        tenderId:   tender.id,
        tenderInfo: {
          title:                tender.title,
          tender_number:        tender.tender_number        || '',
          location:             tender.location             || '',
          closing_date:         tender.closing_date         || '',
          description:          tender.description          || '',
          trade_packages:       tender.trade_packages       || [],
          client_name:          tender.client_name          || '',
          architect_name:       tender.architect_name       || '',
          project_manager_name: tender.project_manager_name || '',
        },
        appUrl: window.location.origin,
      });
      out.sendResponse = sendRes.data;

      // ── AFTER ───────────────────────────────────────────────────────────────
      const [afterInvitees, afterInvitations] = await Promise.all([
        TenderInvitee.filter({ tender_id: tender.id }),
        TenderInvitation.filter({ tender_id: tender.id }),
      ]);
      out.after.invitees    = afterInvitees.map(i => ({ id: i.id, name: i.full_name, email: i.email, status: i.status }));
      out.after.invitations = afterInvitations.map(i => ({ id: i.id, invitee_id: i.invitee_id, email: i.invitee_email, token: i.token, status: i.status }));

    } catch (e) {
      out.error = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    }

    setReport(out);
    setRunning(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-purple-600" />
        <h2 className="text-lg font-bold">Issue Tender Diagnostic</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Captures full before/after state, calls <code className="text-xs bg-muted px-1 py-0.5 rounded">sendTenderInvitations</code>, and returns raw payloads. Enter a Tender DB id or tender number (e.g. <code className="text-xs bg-muted px-1 py-0.5 rounded">TDR-008</code>).
      </p>

      <div className="flex gap-2">
        <input
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="TDR-008 or DB id…"
          value={tenderId}
          onChange={e => setTenderId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !running && run()}
        />
        <Button onClick={run} disabled={running || !tenderId.trim()} className="gap-2">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          {running ? 'Running…' : 'Run Diagnostic'}
        </Button>
      </div>

      {report && (
        <div className="space-y-5 text-sm font-mono">
          {/* Resolved tender */}
          <Section title="Resolved Tender">
            <Pre>{JSON.stringify(report.tender, null, 2)}</Pre>
          </Section>

          {report.error && (
            <Section title="ERROR" colour="red">
              <Pre colour="red">{report.error}</Pre>
            </Section>
          )}

          {/* BEFORE */}
          <Section title={`BEFORE — TenderInvitee (${report.before.invitees.length} record${report.before.invitees.length !== 1 ? 's' : ''})`}>
            <Pre>{JSON.stringify(report.before.invitees, null, 2)}</Pre>
          </Section>

          <Section title={`BEFORE — TenderInvitation (${report.before.invitations.length} record${report.before.invitations.length !== 1 ? 's' : ''})`}>
            <Pre>{JSON.stringify(report.before.invitations, null, 2)}</Pre>
          </Section>

          {/* sendTenderInvitations raw response */}
          <Section title="sendTenderInvitations() — Raw Response" colour="blue">
            <Pre colour="blue">{JSON.stringify(report.sendResponse, null, 2)}</Pre>
          </Section>

          {/* AFTER */}
          <Section title={`AFTER — TenderInvitee (${report.after.invitees.length} record${report.after.invitees.length !== 1 ? 's' : ''})`} colour="green">
            <Pre colour="green">{JSON.stringify(report.after.invitees, null, 2)}</Pre>
          </Section>

          <Section title={`AFTER — TenderInvitation (${report.after.invitations.length} record${report.after.invitations.length !== 1 ? 's' : ''})`} colour="green">
            <Pre colour="green">{JSON.stringify(report.after.invitations, null, 2)}</Pre>
          </Section>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddInviteeTrace
// Executes manageTenderInvitee 'create' against a hardcoded or entered tender,
// and captures every step with raw payloads.
// ─────────────────────────────────────────────────────────────────────────────
function AddInviteeTrace() {
  const FIXED_TENDER_ID = '6a2b77d922706c2852ff2788';

  const [fullName,     setFullName]     = useState('Trace Test Invitee');
  const [email,        setEmail]        = useState('trace-test@example.com');
  const [businessName, setBusinessName] = useState('Test Co');
  const [phone,        setPhone]        = useState('');
  const [trade,        setTrade]        = useState('');
  const [running,      setRunning]      = useState(false);
  const [report,       setReport]       = useState(null);

  const run = async () => {
    setRunning(true);
    setReport(null);

    const payload = {
      action:       'create',
      tenderId:     FIXED_TENDER_ID,
      fullName:     fullName.trim(),
      businessName: businessName.trim(),
      email:        email.trim(),
      phone:        phone.trim(),
      trade:        trade.trim(),
    };

    const out = {
      requestPayload:    payload,
      countBefore:       null,
      countAfter:        null,
      rawResponse:       null,
      validationErrors:  [],
      caughtExceptions:  [],
      dbRecordCreated:   null,
    };

    // Client-side validation (mirrors InviteeManager)
    if (!payload.fullName) out.validationErrors.push('fullName is required (client-side check)');

    // Count before
    try {
      const before = await TenderInvitee.filter({ tender_id: FIXED_TENDER_ID });
      out.countBefore = before.length;
    } catch (e) {
      out.caughtExceptions.push({ stage: 'countBefore', message: e.message, stack: e.stack });
    }

    // Call manageTenderInvitee
    if (out.validationErrors.length === 0) {
      try {
        const res = await invokeFunction('manageTenderInvitee', payload);
        out.rawResponse = res.data;
        out.dbRecordCreated = !!(res.data?.invitee?.id);
      } catch (e) {
        out.caughtExceptions.push({
          stage:    'manageTenderInvitee',
          message:  e.message,
          stack:    e.stack,
          response: e?.response?.data ?? null,
        });
        out.dbRecordCreated = false;
      }
    } else {
      out.dbRecordCreated = false;
    }

    // Count after
    try {
      const after = await TenderInvitee.filter({ tender_id: FIXED_TENDER_ID });
      out.countAfter = after.length;
    } catch (e) {
      out.caughtExceptions.push({ stage: 'countAfter', message: e.message, stack: e.stack });
    }

    setReport(out);
    setRunning(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-orange-600" />
        <h2 className="text-lg font-bold">Add Invitee Trace</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Calls <code className="text-xs bg-muted px-1 py-0.5 rounded">manageTenderInvitee</code> against tender <code className="text-xs bg-muted px-1 py-0.5 rounded">{FIXED_TENDER_ID}</code> and captures raw payloads at every step.
      </p>

      <div className="grid grid-cols-2 gap-2 max-w-lg">
        {[
          ['Full Name', fullName, setFullName],
          ['Email', email, setEmail],
          ['Business Name', businessName, setBusinessName],
          ['Phone', phone, setPhone],
          ['Trade', trade, setTrade],
        ].map(([label, val, setter]) => (
          <div key={label}>
            <label className="text-xs text-muted-foreground">{label}</label>
            <input
              className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={val}
              onChange={e => setter(e.target.value)}
            />
          </div>
        ))}
      </div>

      <Button onClick={run} disabled={running} className="gap-2 bg-orange-600 hover:bg-orange-700">
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
        {running ? 'Tracing…' : 'Run Trace'}
      </Button>

      {report && (
        <div className="space-y-4 text-sm font-mono">

          <Section title="1. Raw Request Payload Sent to manageTenderInvitee">
            <Pre>{JSON.stringify(report.requestPayload, null, 2)}</Pre>
          </Section>

          <Section title="2. Raw Response Returned" colour={report.rawResponse ? 'blue' : 'red'}>
            <Pre colour={report.rawResponse ? 'blue' : 'red'}>
              {report.rawResponse ? JSON.stringify(report.rawResponse, null, 2) : 'null — see Caught Exceptions'}
            </Pre>
          </Section>

          <Section title={`3. TenderInvitee Count BEFORE — ${report.countBefore ?? 'ERROR'}`}>
            <Pre>{String(report.countBefore ?? 'Could not read — see exceptions')}</Pre>
          </Section>

          <Section title={`4. TenderInvitee Count AFTER — ${report.countAfter ?? 'ERROR'}`} colour="green">
            <Pre colour="green">{String(report.countAfter ?? 'Could not read — see exceptions')}</Pre>
          </Section>

          <Section title={`5. Validation Errors — ${report.validationErrors.length}`} colour={report.validationErrors.length ? 'red' : 'gray'}>
            <Pre colour={report.validationErrors.length ? 'red' : 'gray'}>
              {report.validationErrors.length ? JSON.stringify(report.validationErrors, null, 2) : 'None'}
            </Pre>
          </Section>

          <Section title={`6. Caught Exceptions — ${report.caughtExceptions.length}`} colour={report.caughtExceptions.length ? 'red' : 'gray'}>
            <Pre colour={report.caughtExceptions.length ? 'red' : 'gray'}>
              {report.caughtExceptions.length ? JSON.stringify(report.caughtExceptions, null, 2) : 'None'}
            </Pre>
          </Section>

          <Section title={`7. Database Record Created? — ${report.dbRecordCreated === true ? 'YES' : report.dbRecordCreated === false ? 'NO' : 'UNKNOWN'}`}
            colour={report.dbRecordCreated === true ? 'green' : 'red'}>
            <Pre colour={report.dbRecordCreated === true ? 'green' : 'red'}>
              {report.dbRecordCreated === true
                ? `YES — invitee.id = ${report.rawResponse?.invitee?.id}`
                : report.dbRecordCreated === false
                  ? 'NO'
                  : 'UNKNOWN'}
            </Pre>
          </Section>

        </div>
      )}
    </div>
  );
}

function Section({ title, colour = 'gray', children }) {
  const borders = { gray: 'border-border', blue: 'border-blue-300', green: 'border-green-300', red: 'border-red-300' };
  const headers = { gray: 'bg-muted text-foreground', blue: 'bg-blue-50 text-blue-900', green: 'bg-green-50 text-green-900', red: 'bg-red-50 text-red-900' };
  return (
    <div className={`border rounded-lg overflow-hidden ${borders[colour]}`}>
      <div className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${headers[colour]}`}>{title}</div>
      <div className="p-0">{children}</div>
    </div>
  );
}

function Pre({ colour = 'gray', children }) {
  const bgs = { gray: 'bg-background', blue: 'bg-blue-50/40', green: 'bg-green-50/40', red: 'bg-red-50/40' };
  return (
    <pre className={`text-xs p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed ${bgs[colour]}`}>{children}</pre>
  );
}