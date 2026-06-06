import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Verify authenticated user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenderId, inviteeIds, appUrl } = await req.json();

    if (!tenderId || !inviteeIds?.length) {
      return Response.json({ error: 'tenderId and inviteeIds are required' }, { status: 400 });
    }

    // Fetch tender, templates and branding server-side via service role
    const [tender, templates, brandings] = await Promise.all([
      base44.asServiceRole.entities.Tender.list().then(list => list.find(t => t.id === tenderId)),
      base44.asServiceRole.entities.EmailTemplate.list(),
      base44.asServiceRole.entities.EmailBranding.list(),
    ]);

    if (!tender) {
      return Response.json({ error: 'Tender not found' }, { status: 404 });
    }

    const branding = brandings[0] || {};
    const brandColour = branding.brand_colour || '#1a56db';
    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <tenders@totalhomesolutions.co.nz>`;

    // Resolve invitation template
    const tpl = templates.find(t => t.template_key === 'tender_invitation');
    const defaultSubject = `Tender Invitation — ${tender.tender_number || ''}: ${tender.title}`;
    const defaultBody = `You have been invited to submit pricing for {title}.\n\nPlease click the link below to view the tender documents and submit your pricing:\n\n{submission_link}\n\nClosing Date: {closing_date}\n\nRegards,\n{sender_name}`;

    const inviteesToEmail = (tender.invitees || []).filter(inv => inviteeIds.includes(inv.id) && inv.email);

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const inv of inviteesToEmail) {
      const submissionLink = `${appUrl}/tender-submit/${inv.token}`;

      // Apply template
      const vars = {
        tender_number: tender.tender_number || '',
        title: tender.title || '',
        invitee_name: inv.full_name || '',
        company_name: branding.company_name || 'ConstructIQ',
        location: tender.location || '',
        closing_date: tender.closing_date || '',
        trade_packages: (tender.trade_packages || []).join(', '),
        description: tender.description || '',
        client_name: tender.client_name || '',
        architect_name: tender.architect_name || '',
        project_manager_name: tender.project_manager_name || '',
        submission_link: submissionLink,
        sender_name: branding.sender_name || branding.company_name || 'ConstructIQ',
      };

      const replace = (str) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

      const subject = tpl?.subject ? replace(tpl.subject) : replace(defaultSubject);
      const rawBody = tpl?.body_html || tpl?.body_text || defaultBody;
      const bodyText = replace(rawBody);

      // Build branded HTML
      const isHtml = rawBody.trim().startsWith('<') || tpl?.body_html;
      const bodyContent = isHtml
        ? replace(rawBody)
        : replace(rawBody).replace(/\n/g, '<br>');

      const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f3f4f6;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
      <tr><td style="background:${brandColour};padding:24px 40px;">
        ${branding.logo_url ? `<img src="${branding.logo_url}" alt="${branding.company_name || ''}" style="height:40px;display:block;">` : `<span style="color:#fff;font-size:20px;font-weight:700;">${branding.company_name || 'ConstructIQ'}</span>`}
      </td></tr>
      <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
        <p>Dear <strong>${inv.full_name}</strong>,</p>
        ${bodyContent}
      </td></tr>
      ${branding.footer_text ? `<tr><td style="padding:16px 40px;background:#f9fafb;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">${branding.footer_text}</td></tr>` : ''}
      <tr><td style="background:${brandColour};height:3px;"></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

      try {
        await resend.emails.send({
          from: fromEmail,
          to: inv.email,
          subject,
          html: htmlBody,
          text: bodyText,
        });
        sent++;
      } catch (e) {
        failed++;
        errors.push(`${inv.full_name} (${inv.email}): ${e?.message || 'unknown'}`);
        console.error('Email send failed for', inv.email, e);
      }
    }

    return Response.json({ sent, failed, errors });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});