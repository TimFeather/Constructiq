import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { to, toName, subject, htmlBody } = await req.json();

    if (!to || !subject || !htmlBody) {
      return Response.json({ error: 'to, subject, htmlBody required' }, { status: 400 });
    }

    const brandings = await base44.asServiceRole.entities.EmailBranding.list();
    const branding = brandings[0] || {};
    const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    const result = await resend.emails.send({
      from: fromEmail,
      to: to,
      subject,
      html: htmlBody,
    });

    if (!result || !result.data || !result.data.id) {
      console.error('[sendEmail] Resend did not confirm — result:', JSON.stringify(result));
      return Response.json({ success: false, error: 'Resend did not return a message ID', result }, { status: 500 });
    }

    return Response.json({ success: true, id: result.data.id });

  } catch (error) {
    console.error('[sendEmail] ERROR:', error?.message, error?.stack);
    return Response.json({ error: error?.message }, { status: 500 });
  }
});