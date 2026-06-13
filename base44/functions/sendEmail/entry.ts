import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { to, toName, subject, htmlBody, templateKey } = await req.json();
    if (!to || !subject || !htmlBody) {
      return Response.json({ error: 'to, subject, htmlBody required' }, { status: 400 });
    }

    const brandings = await base44.asServiceRole.entities.EmailBranding.list();
    const branding = brandings[0] || {};
    const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;

    console.log(`[sendEmail] SEND to=${to} subject="${subject}" templateKey=${templateKey || 'n/a'} from="${fromEmail}"`);

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    const result = await resend.emails.send({
      from: fromEmail,
      to: toName ? [{ email: to, name: toName }] : to,
      subject,
      html: htmlBody,
    });

    console.log(`[sendEmail] Resend raw result: ${JSON.stringify(result)}`);

    // Validate that Resend accepted the email and returned a message ID
    if (!result || !result.data || !result.data.id) {
      console.error(`[sendEmail] FAILED — Resend did not return a message ID. Full result: ${JSON.stringify(result)}`);
      return Response.json(
        { success: false, error: 'Resend did not return a message ID', result },
        { status: 500 }
      );
    }

    console.log(`[sendEmail] SUCCESS id=${result.data.id} to=${to}`);
    return Response.json({ success: true, id: result.data.id });

  } catch (error) {
    console.error(`[sendEmail] EXCEPTION: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});