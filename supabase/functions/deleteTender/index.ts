import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const log: string[] = [];
  const trace = (msg: string) => { console.log(`[deleteTender] ${msg}`); log.push(msg); };
  const fail = (msg: string, status = 500) =>
    Response.json({ error: msg, trace: log }, { status, headers: corsHeaders });

  try {
    trace('START');
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt);
    if (!authUser) return fail('Unauthorized', 401);

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();
    const user = { ...profile, id: authUser.id, email: authUser.email };
    if (!['admin', 'pricing'].includes(user.role)) return fail(`Forbidden — role '${user.role}'`, 403);

    const body = await req.json();
    const { tenderId } = body;
    if (!tenderId) return fail('tenderId is required', 400);
    trace(`DELETE tender=${tenderId}`);

    // FK constraints on tender_submissions, tender_invitations, tender_invitees,
    // and folders all have ON DELETE CASCADE — the parent delete handles everything.
    trace(`Deleting tender id=${tenderId}…`);
    const { error } = await supabaseAdmin.from('tenders').delete().eq('id', tenderId);
    if (error) return fail(`Tender delete failed: ${error.message}`);
    trace('Tender deleted');

    trace('DELETE COMPLETE');
    return Response.json({ success: true, trace: log }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[deleteTender] UNHANDLED:', error.message);
    return Response.json({ error: error.message, trace: log }, { status: 500, headers: corsHeaders });
  }
});
