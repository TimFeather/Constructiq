import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { action, token, submission } = payload;

    if (!token) {
      return Response.json({ error: 'Token required' }, { status: 400 });
    }

    // Find tender with this invitee token — check active tenders first for performance
    let tender = null;
    let inviteeIndex = -1;

    const activeTenders = await base44.asServiceRole.entities.Tender.filter(
      { status: 'Issued' }, '-created_date', 200
    );
    for (const t of activeTenders) {
      const idx = (t.invitees || []).findIndex(inv => inv.token === token);
      if (idx !== -1) { tender = t; inviteeIndex = idx; break; }
    }

    // If not found in active, check all (covers edge cases like Closed tenders)
    if (!tender) {
      const allTenders = await base44.asServiceRole.entities.Tender.list('-created_date', 500);
      for (const t of allTenders) {
        const idx = (t.invitees || []).findIndex(inv => inv.token === token);
        if (idx !== -1) { tender = t; inviteeIndex = idx; break; }
      }
    }

    if (!tender || inviteeIndex === -1) {
      return Response.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const invitee = tender.invitees[inviteeIndex];

    if (action === 'get') {
      return Response.json({
        tender: {
          id: tender.id,
          title: tender.title,
          description: tender.description,
          closing_date: tender.closing_date,
          trade_packages: tender.trade_packages || [],
          documents: tender.documents || [],
          location: tender.location,
          tender_number: tender.tender_number,
          status: tender.status,
        },
        invitee: {
          id: invitee.id,
          full_name: invitee.full_name,
          business_name: invitee.business_name,
          email: invitee.email,
          status: invitee.status,
          submission: invitee.submission || null,
        }
      });
    }

    if (action === 'submit') {
      if (tender.status !== 'Issued' && tender.status !== 'Closed') {
        return Response.json({ error: 'This tender is no longer accepting submissions.' }, { status: 400 });
      }

      if (tender.closing_date) {
        const today = new Date().toISOString().split('T')[0];
        if (today > tender.closing_date) {
          return Response.json({ error: 'The closing date for this tender has passed.' }, { status: 400 });
        }
      }

      if (!submission?.lump_sum_price) {
        return Response.json({ error: 'Lump sum price is required.' }, { status: 400 });
      }

      const updatedInvitees = [...tender.invitees];
      updatedInvitees[inviteeIndex] = {
        ...invitee,
        status: 'Submitted',
        submission: {
          ...submission,
          submitted_at: new Date().toISOString(),
        }
      };

      await base44.asServiceRole.entities.Tender.update(tender.id, {
        invitees: updatedInvitees
      });

      // Fetch branding for brand colour
      const brandings = await base44.asServiceRole.entities.EmailBranding.list();
      const branding = brandings[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';

      // Confirmation email to invitee
      try {
        if (invitee.email) {
          const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f3f4f6;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
      <tr><td style="background:${brandColour};height:4px;"></td></tr>
      <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
        <p>Dear <strong>${invitee.full_name}</strong>,</p>
        <p>Thank you for submitting your pricing for <strong>${tender.title}</strong>.</p>
        <p>Your submission has been received. We will be in touch following the
           closing date${tender.closing_date ? ' of <strong>' + tender.closing_date + '</strong>' : ''}.</p>
        <p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>${branding.company_name || 'ConstructIQ'}</p>
      </td></tr>
      <tr><td style="background:${brandColour};height:2px;"></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

          await base44.asServiceRole.integrations.Core.SendEmail({
            to: invitee.email,
            subject: `Tender Submission Received — ${tender.tender_number || ''}: ${tender.title}`,
            body: htmlBody,
          });
        }
      } catch (_e) { /* email failure is non-blocking */ }

      // Notify creator
      try {
        if (tender.created_by_email) {
          const price = submission.lump_sum_price
            ? `NZD ${Number(submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`
            : 'Not provided';

          const creatorHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f3f4f6;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
      <tr><td style="background:${brandColour};height:4px;"></td></tr>
      <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
        <p>A new submission has been received for <strong>${tender.title}</strong>.</p>
        <table style="width:100%;margin:16px 0;border-collapse:collapse;">
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Subcontractor</td>
              <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:600;">${invitee.full_name}${invitee.business_name ? ' (' + invitee.business_name + ')' : ''}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Submitted</td>
              <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;">${new Date().toLocaleDateString('en-NZ')}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#6b7280;">Price</td>
              <td style="padding:8px 0;font-size:14px;font-weight:600;">${price}</td></tr>
        </table>
        <p style="font-size:13px;color:#6b7280;">Log in to view and score this submission.</p>
      </td></tr>
      <tr><td style="background:${brandColour};height:2px;"></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

          await base44.asServiceRole.integrations.Core.SendEmail({
            to: tender.created_by_email,
            subject: `New Submission — ${tender.title}`,
            body: creatorHtml,
          });
        }
      } catch (_e) { /* email failure is non-blocking */ }

      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});