import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * updateTender
 * - Enforces admin/pricing role
 * - Full stack trace logging at every DB step
 * - Cascading delete: TenderInvitation records → Tender
 * - Payload: { tenderId, data } or { tenderId, data: { _delete: true } }
 */
Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[updateTender] ${msg}`); log.push(msg); };
  const fail = (msg, status = 500) => {
    console.error(`[updateTender] FAIL: ${msg}`);
    return Response.json({ error: msg, trace: log }, { status });
  };

  try {
    trace('START');

    // ── Auth ──────────────────────────────────────────────────────────────
    const base44 = createClientFromRequest(req);
    trace('SDK initialised');

    let user;
    try {
      user = await base44.auth.me();
      trace(`auth.me resolved: email=${user?.email} role=${user?.role}`);
    } catch (authErr) {
      trace(`auth.me threw: ${authErr.message}`);
      return fail(`Authentication error: ${authErr.message}`, 401);
    }

    if (!user) return fail('Unauthorized — no user session', 401);
    if (!['admin', 'pricing'].includes(user.role)) {
      return fail(`Forbidden — role '${user.role}' not permitted`, 403);
    }

    // ── Parse body ────────────────────────────────────────────────────────
    let body;
    try {
      body = await req.json();
      trace(`Body parsed: tenderId=${body?.tenderId} keys=${Object.keys(body?.data || {}).join(',')}`);
    } catch (parseErr) {
      trace(`Body parse threw: ${parseErr.message}`);
      return fail(`Invalid request body: ${parseErr.message}`, 400);
    }

    const { tenderId, data } = body;

    if (!tenderId) return fail('tenderId is required', 400);
    if (!data || typeof data !== 'object') return fail('data is required', 400);

    const { _delete, ...updateData } = data;

    // ── DELETE path — cascading ────────────────────────────────────────────
    if (_delete) {
      trace(`DELETE requested for tender id=${tenderId}`);

      // 1. Delete TenderInvitation records
      trace('Fetching TenderInvitation records...');
      let invitations;
      try {
        invitations = await base44.asServiceRole.entities.TenderInvitation.filter({ tender_id: tenderId });
        trace(`TenderInvitation.filter returned ${invitations.length} record(s)`);
      } catch (invErr) {
        trace(`TenderInvitation.filter threw: ${invErr.message}`);
        return fail(`TenderInvitation fetch failed: ${invErr.message}`);
      }

      for (const inv of invitations) {
        trace(`Deleting TenderInvitation id=${inv.id} email=${inv.invitee_email}`);
        try {
          await base44.asServiceRole.entities.TenderInvitation.delete(inv.id);
          trace(`TenderInvitation id=${inv.id} deleted OK`);
        } catch (invDelErr) {
          trace(`TenderInvitation id=${inv.id} delete threw: ${invDelErr.message}`);
          return fail(`TenderInvitation delete failed id=${inv.id}: ${invDelErr.message}`);
        }
      }

      trace(`All ${invitations.length} TenderInvitation(s) deleted`);

      // 2. Delete the Tender record itself
      trace(`Deleting Tender id=${tenderId}...`);
      try {
        await base44.asServiceRole.entities.Tender.delete(tenderId);
        trace(`Tender id=${tenderId} deleted OK`);
      } catch (tDelErr) {
        trace(`Tender.delete threw: ${tDelErr.message}`);
        return fail(`Tender delete failed: ${tDelErr.message}`);
      }

      trace('DELETE COMPLETE');
      return Response.json({ success: true, deleted: true, trace: log });
    }

    // ── UPDATE path ────────────────────────────────────────────────────────
    trace(`UPDATE tender id=${tenderId} fields=${Object.keys(updateData).join(',')}`);
    let updated;
    try {
      updated = await base44.asServiceRole.entities.Tender.update(tenderId, updateData);
      trace(`Tender.update success id=${tenderId}`);
    } catch (updErr) {
      trace(`Tender.update threw: ${updErr.message}`);
      return fail(`Tender update failed: ${updErr.message}`);
    }

    trace('UPDATE COMPLETE');
    return Response.json({ success: true, tender: updated, trace: log });

  } catch (error) {
    console.error('[updateTender] UNHANDLED:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack, trace: log }, { status: 500 });
  }
});