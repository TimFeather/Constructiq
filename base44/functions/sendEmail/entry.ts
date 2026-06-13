import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // STEP 1: Parse request body
    console.log('[STEP 1] Starting req.json()');
    let rawBody;
    try {
      rawBody = await req.json();
      console.log('[STEP 1] Completed req.json()');
      console.log('[STEP 1] typeof rawBody =', typeof rawBody);
      console.log('[STEP 1] Object.keys(rawBody) =', JSON.stringify(Object.keys(rawBody || {})));
      console.log('[STEP 1] RAW PAYLOAD =', JSON.stringify(rawBody));
    } catch (parseErr) {
      console.error('[STEP 1] FAILED req.json()', parseErr?.message);
      throw parseErr;
    }

    const { to, toName, subject, htmlBody, templateKey } = rawBody;

    console.log('[STEP 1] DESTRUCTURED: to=', JSON.stringify(to));
    console.log('[STEP 1] DESTRUCTURED: toName=', JSON.stringify(toName));
    console.log('[STEP 1] DESTRUCTURED: subject=', JSON.stringify(subject));
    console.log('[STEP 1] DESTRUCTURED: htmlBody (first 300)=', typeof htmlBody === 'string' ? htmlBody.substring(0, 300) : JSON.stringify(htmlBody));
    console.log('[STEP 1] DESTRUCTURED: templateKey=', JSON.stringify(templateKey));
    console.log('[STEP 1] TYPES: to=', typeof to, '| subject=', typeof subject, '| htmlBody=', typeof htmlBody);
    console.log('[STEP 1] LENGTHS: to=', to?.length, '| subject=', subject?.length, '| htmlBody=', htmlBody?.length);

    if (!to || !subject || !htmlBody) {
      console.log('[STEP 1] VALIDATION FAILED: to=', !!to, '| subject=', !!subject, '| htmlBody=', !!htmlBody);
      return Response.json({ error: 'to, subject, htmlBody required' }, { status: 400 });
    }

    // STEP 2: EmailBranding lookup
    console.log('[STEP 2] Starting EmailBranding lookup');
    let branding = {};
    try {
      const brandings = await base44.asServiceRole.entities.EmailBranding.list();
      branding = brandings[0] || {};
      console.log('[STEP 2] Completed EmailBranding lookup. branding keys=', JSON.stringify(Object.keys(branding)));
    } catch (brandErr) {
      console.error('[STEP 2] FAILED EmailBranding lookup', brandErr?.message);
      throw brandErr;
    }

    const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;
    console.log('[STEP 2] fromEmail=', fromEmail);

    // STEP 3: Build Resend payload
    console.log('[STEP 3] Building Resend payload');
    const resendPayload = {
      from: fromEmail,
      to: toName ? [{ email: to, name: toName }] : to,
      subject,
      html: htmlBody,
    };
    console.log('[STEP 3] typeof resendPayload =', typeof resendPayload);
    console.log('[STEP 3] JSON.stringify(resendPayload) (html truncated) =', JSON.stringify({
      ...resendPayload,
      html: typeof resendPayload.html === 'string' ? resendPayload.html.substring(0, 200) + '...' : resendPayload.html,
    }));

    // STEP 4: Resend initialization
    console.log('[STEP 4] Starting Resend initialization');
    let resend;
    try {
      resend = new Resend(Deno.env.get('RESEND_API_KEY'));
      console.log('[STEP 4] Completed Resend initialization');
    } catch (initErr) {
      console.error('[STEP 4] FAILED Resend initialization', initErr?.message);
      throw initErr;
    }

    // STEP 5: Send email
    console.log('[STEP 5] Starting resend.emails.send()');
    let result;
    try {
      result = await resend.emails.send(resendPayload);
      console.log('[STEP 5] Completed resend.emails.send()');
      console.log('[STEP 5] FULL RESULT =', JSON.stringify(result));
      console.log('[STEP 5] result.data =', JSON.stringify(result?.data));
      console.log('[STEP 5] result.data.id =', JSON.stringify(result?.data?.id));
      console.log('[STEP 5] result.error =', JSON.stringify(result?.error));
    } catch (sendErr) {
      console.error('[STEP 5] FAILED resend.emails.send()', sendErr?.message);
      throw sendErr;
    }

    if (!result || !result.data || !result.data.id) {
      console.error('[STEP 5] TRIGGER: "Resend did not confirm" — result=', JSON.stringify(result));
      return Response.json(
        { success: false, error: 'Resend did not return a message ID', result },
        { status: 500 }
      );
    }

    console.log('[STEP 5] SUCCESS id=', result.data.id, 'to=', to);
    return Response.json({ success: true, id: result.data.id });

  } catch (error) {
    console.error('[sendEmail] FULL ERROR', error);
    console.error('[sendEmail] STACK', error?.stack);
    return Response.json({
      error: error?.message,
      stack: error?.stack,
      name: error?.name,
    }, { status: 500 });
  }
});