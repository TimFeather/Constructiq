import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * deleteTender
 *
 * Cascading delete:
 *   TenderSubmission → TenderInvitation → TenderInvitee → Folder → Tender
 */
Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[deleteTender] ${msg}`); log.push(msg); };
  const fail  = (msg, status = 500) => {
    console.error(`[deleteTender] FAIL: ${msg}`);
    return Response.json({ error: msg, trace: log }, { status });
  };

  try {
    trace('START');
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    let user;
    try {
      user = await base44.auth.me();
      trace(`auth: email=${user?.email} role=${user?.role}`);
    } catch (e) { return fail(`Auth error: ${e.message}`, 401); }

    if (!user) return fail('Unauthorized', 401);
    if (!['admin', 'pricing'].includes(user.role)) {
      return fail(`Forbidden — role '${user.role}'`, 403);
    }

    let body;
    try { body = await req.json(); }
    catch (e) { return fail(`Invalid body: ${e.message}`, 400); }

    const { tenderId } = body;
    if (!tenderId) return fail('tenderId is required', 400);
    trace(`DELETE tender=${tenderId}`);

    const deleteAll = async (entityName, records) => {
      for (const r of records) {
        try {
          await sr.entities[entityName].delete(r.id);
        } catch (e) {
          trace(`${entityName} delete failed id=${r.id} (non-fatal): ${e.message}`);
        }
      }
      trace(`${records.length} ${entityName}(s) deleted`);
    };

    // Step 1 — TenderSubmission
    const submissions = await sr.entities.TenderSubmission.filter({ tender_id: tenderId }).catch(() => []);
    trace(`TenderSubmission count: ${submissions.length}`);
    await deleteAll('TenderSubmission', submissions);

    // Step 2 — TenderInvitation
    const invitations = await sr.entities.TenderInvitation.filter({ tender_id: tenderId }).catch(() => []);
    trace(`TenderInvitation count: ${invitations.length}`);
    await deleteAll('TenderInvitation', invitations);

    // Step 3 — TenderInvitee
    const invitees = await sr.entities.TenderInvitee.filter({ tender_id: tenderId }).catch(() => []);
    trace(`TenderInvitee count: ${invitees.length}`);
    await deleteAll('TenderInvitee', invitees);

    // Step 4 — Folder
    const folders = await sr.entities.Folder.filter({ tender_id: tenderId }).catch(() => []);
    trace(`Folder count: ${folders.length}`);
    await deleteAll('Folder', folders);

    // Step 5 — Tender
    trace(`Deleting Tender id=${tenderId}...`);
    await base44.entities.Tender.delete(tenderId);
    trace('Tender deleted');

    trace('DELETE COMPLETE');
    return Response.json({ success: true, trace: log });

  } catch (error) {
    console.error('[deleteTender] UNHANDLED:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack, trace: log }, { status: 500 });
  }
});