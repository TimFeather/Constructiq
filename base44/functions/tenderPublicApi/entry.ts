import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { action, token, submission } = payload;

    if (!token) {
      return Response.json({ error: 'Token required' }, { status: 400 });
    }

    // Find tender with this invitee token
    const tenders = await base44.asServiceRole.entities.Tender.list('-created_date', 500);
    let tender = null;
    let inviteeIndex = -1;

    for (const t of tenders) {
      const idx = (t.invitees || []).findIndex(inv => inv.token === token);
      if (idx !== -1) {
        tender = t;
        inviteeIndex = idx;
        break;
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

      // Confirmation email to invitee
      try {
        if (invitee.email) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: invitee.email,
            subject: `Tender Submission Received — ${tender.tender_number || ''}: ${tender.title}`,
            body: `Dear ${invitee.full_name},\n\nThank you for submitting your pricing for ${tender.title}.\n\nYour submission has been received. We will be in touch following the closing date of ${tender.closing_date || 'advised separately'}.\n\nRegards,\nConstructIQ`,
          });
        }
      } catch (_e) { /* email failure is non-blocking */ }

      // Notify creator
      try {
        if (tender.created_by_email) {
          const price = submission.lump_sum_price
            ? `NZD ${Number(submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`
            : 'Not provided';
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: tender.created_by_email,
            subject: `New Submission — ${tender.title}`,
            body: `New submission received from ${invitee.full_name}${invitee.business_name ? ' (' + invitee.business_name + ')' : ''} for ${tender.title}.\n\nSubmitted: ${new Date().toLocaleDateString('en-NZ')}\nPrice: ${price}\n\nLog in to view and score this submission.`,
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