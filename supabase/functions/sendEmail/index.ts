import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt);
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { data: senderProfile } = await supabaseAdmin.from('users').select('role').eq('id', authUser.id).single();
    if (!['admin', 'pricing', 'internal'].includes(senderProfile?.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const { to, toName, subject, htmlBody } = await req.json();
    if (!to || !subject || !htmlBody) {
      return Response.json({ error: 'to, subject, htmlBody required' }, { status: 400, headers: corsHeaders });
    }

    const { data: brandings } = await supabaseAdmin.from('email_branding').select('*').limit(1);
    const branding = brandings?.[0] || {};
    const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    const result = await resend.emails.send({
      from: `${fromName} <noreply@totalhomesolutions.co.nz>`,
      to,
      subject,
      html: htmlBody,
    });

    if (!result?.data?.id) {
      return Response.json({ success: false, error: 'Resend did not return a message ID', result }, { status: 500, headers: corsHeaders });
    }

    return Response.json({ success: true, id: result.data.id }, { headers: corsHeaders });
  } catch (error) {
    console.error('[sendEmail] ERROR:', error?.message);
    return Response.json({ error: error?.message }, { status: 500, headers: corsHeaders });
  }
});
