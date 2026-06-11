import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * manageTenderInvitation
 *
 * All TenderInvitation create/delete operations executed via service role
 * to bypass entity RLS. Auth check still validates user identity and role.
 *
 * Payload:
 *   action: 'create' | 'delete'
 *
 *   For 'create':
 *     tenderId     - string
 *     token        - string (UUID)
 *     inviteeName  - string
 *     inviteeEmail - string
 *
 *   For 'delete':
 *     invitationId - string
 */
Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[manageTenderInvitation] ${msg}`); log.push(msg); };
  const fail = (msg, status = 500) => {
    console.error(`[manageTenderInvitation] FAIL: ${msg}`);
    return Response.json({ error: msg, trace: log }, { status });
  };

  try {
    trace('START');

    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    trace('SDK initialised');

    // ── Auth ─────────────────────────────────────────────────────────────────
    let user;
    try {
      user = await base44.auth.me();
      trace(`auth.me: email=${user?.email} role=${user?.role}`);
    } catch (e) {
      return fail(`Auth error: ${e.message}`, 401);
    }

    if (!user) return fail('Unauthorized', 401);
    if (!['admin', 'pricing', 'internal'].includes(user.role)) {
      return fail(`Forbidden — role '${user.role}' not permitted`, 403);
    }

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return fail(`Invalid body: ${e.message}`, 400);
    }

    const { action } = body;
    if (!action) return fail('action is required', 400);

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { tenderId, token, inviteeName, inviteeEmail, businessName, phone, trade } = body;

      if (!tenderId) return fail('tenderId is required', 400);
      if (!token)    return fail('token is required', 400);

      trace(`CREATE TenderInvitation tender=${tenderId} email=${inviteeEmail}`);

      // Check for duplicate token (service role)
      let existing;
      try {
        const found = await sr.entities.TenderInvitation.filter({ token });
        existing = found[0] || null;
        trace(`Duplicate token check: found=${!!existing}`);
      } catch (e) {
        trace(`Duplicate token check failed (continuing): ${e.message}`);
        existing = null;
      }

      if (existing) {
        trace(`Token already exists — returning existing id=${existing.id}`);
        return Response.json({ success: true, invitation: existing, trace: log });
      }

      // Check for duplicate email on same tender (service role)
      if (inviteeEmail) {
        try {
          const emailDups = await sr.entities.TenderInvitation.filter({
            tender_id: tenderId,
            invitee_email: inviteeEmail,
          });
          if (emailDups.length > 0) {
            trace(`Email duplicate: ${inviteeEmail} already invited`);
            return fail(`${inviteeEmail} is already invited to this tender`, 409);
          }
        } catch (e) {
          trace(`Email duplicate check failed (continuing): ${e.message}`);
        }
      }

      // Create via service role
      let record;
      try {
        record = await sr.entities.TenderInvitation.create({
          token,
          tender_id:     tenderId,
          invitee_email: inviteeEmail || '',
          invitee_name:  inviteeName  || '',
          status:        'Pending',
          sent_date:     null,
        });
        trace(`TenderInvitation CREATED id=${record.id}`);
      } catch (e) {
        return fail(`TenderInvitation create failed: ${e.message}`);
      }

      // ── Upsert TenderContact (non-fatal) ───────────────────────────────────
      if (inviteeName) {
        try {
          const emailLower = inviteeEmail?.toLowerCase();
          let existingContacts = [];
          try {
            existingContacts = await sr.entities.TenderContact.list('-created_date', 500);
          } catch (e) {
            trace(`TenderContact list failed (continuing): ${e.message}`);
          }

          let existing = emailLower
            ? existingContacts.find(c => c.email?.toLowerCase() === emailLower)
            : null;
          if (!existing && inviteeName && businessName) {
            existing = existingContacts.find(
              c => c.full_name?.toLowerCase() === inviteeName.toLowerCase() &&
                   c.business_name?.toLowerCase() === (businessName || '').toLowerCase()
            );
          }

          if (existing) {
            await sr.entities.TenderContact.update(existing.id, {
              full_name:     inviteeName,
              business_name: businessName || existing.business_name || '',
              phone:         phone        || existing.phone         || '',
              trade:         trade        || existing.trade         || '',
            });
            trace(`TenderContact UPDATED id=${existing.id}`);
          } else {
            const contact = await sr.entities.TenderContact.create({
              full_name:     inviteeName,
              business_name: businessName || '',
              email:         inviteeEmail  || '',
              phone:         phone         || '',
              trade:         trade         || '',
            });
            trace(`TenderContact CREATED id=${contact.id}`);
          }
        } catch (e) {
          trace(`TenderContact upsert failed (non-fatal): ${e.message}`);
        }
      }

      return Response.json({ success: true, invitation: record, trace: log });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { invitationId } = body;
      if (!invitationId) return fail('invitationId is required', 400);

      trace(`DELETE TenderInvitation id=${invitationId}`);

      try {
        await sr.entities.TenderInvitation.delete(invitationId);
        trace(`TenderInvitation id=${invitationId} deleted`);
      } catch (e) {
        return fail(`TenderInvitation delete failed: ${e.message}`);
      }

      return Response.json({ success: true, trace: log });
    }

    return fail(`Unknown action: ${action}`, 400);

  } catch (error) {
    console.error('[manageTenderInvitation] UNHANDLED:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack, trace: log }, { status: 500 });
  }
});