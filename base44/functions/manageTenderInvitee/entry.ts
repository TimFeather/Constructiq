import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * manageTenderInvitee
 *
 * Manages TenderInvitee records (the per-tender invitee list).
 * Also upserts TenderContact (master directory) on create.
 *
 * Actions:
 *   create  – add invitee to tender + upsert TenderContact
 *   delete  – remove invitee from tender
 */
Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[manageTenderInvitee] ${msg}`); log.push(msg); };
  const fail  = (msg, status = 500) => {
    console.error(`[manageTenderInvitee] FAIL: ${msg}`);
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
    if (!['admin', 'pricing', 'internal'].includes(user.role)) {
      return fail(`Forbidden — role '${user.role}'`, 403);
    }

    let body;
    try { body = await req.json(); }
    catch (e) { return fail(`Invalid body: ${e.message}`, 400); }

    const { action } = body;
    if (!action) return fail('action is required', 400);

    // ── CREATE ────────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { tenderId, fullName, businessName, email, phone, trade } = body;
      if (!tenderId) return fail('tenderId is required', 400);
      if (!fullName)  return fail('fullName is required', 400);

      trace(`CREATE invitee tender=${tenderId} email=${email}`);

      // Duplicate email check
      if (email) {
        const existing = await sr.entities.TenderInvitee.filter({ tender_id: tenderId });
        const dup = existing.find(i => i.email?.toLowerCase() === email.toLowerCase());
        if (dup) {
          trace(`Duplicate email ${email} — returning existing id=${dup.id}`);
          return Response.json({ success: true, invitee: dup, trace: log });
        }
      }

      // Upsert TenderContact
      let contactId = null;
      try {
        const contacts = await sr.entities.TenderContact.list('-created_date', 1000);
        const emailLower = email?.toLowerCase();
        let contact = emailLower
          ? contacts.find(c => c.email?.toLowerCase() === emailLower)
          : contacts.find(c =>
              c.full_name?.toLowerCase() === fullName.toLowerCase() &&
              c.business_name?.toLowerCase() === (businessName || '').toLowerCase()
            );

        if (contact) {
          await sr.entities.TenderContact.update(contact.id, {
            full_name:     fullName,
            business_name: businessName || contact.business_name || '',
            phone:         phone        || contact.phone         || '',
            trade:         trade        || contact.trade         || '',
          });
          contactId = contact.id;
          trace(`TenderContact UPDATED id=${contact.id}`);
        } else {
          const created = await sr.entities.TenderContact.create({
            full_name: fullName, business_name: businessName || '',
            email: email || '', phone: phone || '', trade: trade || '',
          });
          contactId = created.id;
          trace(`TenderContact CREATED id=${created.id}`);
        }
      } catch (e) {
        trace(`TenderContact upsert failed (non-fatal): ${e.message}`);
      }

      // Create TenderInvitee
      const invitee = await sr.entities.TenderInvitee.create({
        tender_id:     tenderId,
        contact_id:    contactId,
        full_name:     fullName,
        business_name: businessName || '',
        email:         email        || '',
        phone:         phone        || '',
        trade:         trade        || '',
        status:        'Draft',
      });
      trace(`TenderInvitee CREATED id=${invitee.id}`);

      return Response.json({ success: true, invitee, trace: log });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { inviteeId } = body;
      if (!inviteeId) return fail('inviteeId is required', 400);
      trace(`DELETE TenderInvitee id=${inviteeId}`);
      await sr.entities.TenderInvitee.delete(inviteeId);
      trace(`Deleted id=${inviteeId}`);
      return Response.json({ success: true, trace: log });
    }

    return fail(`Unknown action: ${action}`, 400);

  } catch (error) {
    console.error('[manageTenderInvitee] UNHANDLED:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack, trace: log }, { status: 500 });
  }
});