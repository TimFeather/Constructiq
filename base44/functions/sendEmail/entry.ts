import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const rawBody = await req.json();
    console.log(`[sendEmail] RAW INCOMING PAYLOAD: ${JSON.stringify(rawBody)}`);

    const { to, toName, subject, htmlBody, templateKey } = rawBody;

    console.log(`[sendEmail] DESTRUCTURED VALUES:`);
    console.log(`  to          = ${JSON.stringify(to)}`);
    console.log(`  toName      = ${JSON.stringify(toName)}`);
    console.log(`  subject     = ${JSON.stringify(subject)}`);
    console.log(`  htmlBody    = ${JSON.stringify(typeof htmlBody === 'string' ? htmlBody.substring(0, 200) : htmlBody)}`);
    console.log(`  templateKey = ${JSON.stringify(templateKey)}`);
    console.log(`[sendEmail] TYPES: to=${typeof to}, subject=${typeof subject}, htmlBody=${typeof htmlBody}`);
    console.log(`[sendEmail] LENGTHS: to=${to?.length}, subject=${subject?.length}, htmlBody=${htmlBody?.length}`);

    if (!to || !subject || !htmlBody) {
      console.log(`[sendEmail] VALIDATION FAILED: to=${!!to}, subject=${!!subject}, htmlBody=${!!htmlBody}`);
      return Response.json({ error: 'to, subject, htmlBody required' }, { status: 400 });
    }

    const brandings = await base44.asServiceRole.entities.EmailBranding.list();
    const branding = brandings[0] || {};
    const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;

    const resendPayload = {
      from: fromEmail,
      to: toName ? [{ email: to, name: toName }] : to,
      subject,
      html: htmlBody,
    };
    console.log(`[sendEmail] RESEND PAYLOAD (html truncated): ${JSON.stringify({
      ...resendPayload,
      html: typeof resendPayload.html === 'string' ? resendPayload.html.substring(0, 200) + '...' : resendPayload.html
    })}`);

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    const result = await resend.emails.send(resendPayload);

    console.log(`[sendEmail] RESEND RAW RESULT: ${JSON.stringify(result)}`);
    console.log(`[sendEmail] result.data = ${JSON.stringify(result?.data)}`);
    console.log(`[sendEmail] result.data.id = ${JSON.stringify(result?.data?.id)}`);
    console.log(`[sendEmail] result.error = ${JSON.stringify(result?.error)}`);

    if (!result || !result.data || !result.data.id) {
      console.error(`[sendEmail] TRIGGER: "Resend did not confirm" — result=${JSON.stringify(result)}`);
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