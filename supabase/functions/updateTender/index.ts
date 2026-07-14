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
  const trace = (msg: string) => { console.log(`[updateTender] ${msg}`); log.push(msg); };
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
    const { tenderId, data } = body;
    if (!tenderId) return fail('tenderId is required', 400);
    if (!data || typeof data !== 'object') return fail('data is required', 400);

    const ALLOWED_FIELDS = new Set([
      'title', 'description', 'status', 'location',
      'issue_date', 'site_visit_date', 'questions_date', 'closing_date', 'ths_rft_closing_date',
      'estimated_value', 'trade_packages',
      'tender_lead_user_id', 'tender_lead_name', 'tender_lead_email',
      'client_name', 'client_contact', 'client_email',
      'architect_name', 'architect_contact', 'architect_email',
      'project_manager_name', 'project_manager_contact', 'project_manager_email',
      'additional_contacts', 'notes', 'documents',
      'scoring_criteria', 'converted_project_id',
      'our_result', 'our_result_notes',
    ]);

    const sanitised: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (ALLOWED_FIELDS.has(key)) sanitised[key] = value;
    }
    if (Object.keys(sanitised).length === 0) return fail('No permitted fields in data', 400);

    trace(`UPDATE tender id=${tenderId} fields=${Object.keys(sanitised).join(',')}`);

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('tenders')
      .update(sanitised)
      .eq('id', tenderId)
      .select()
      .single();

    if (updateErr) return fail(`Tender update failed: ${updateErr.message}`);

    trace('UPDATE COMPLETE');
    return Response.json({ success: true, tender: updated, trace: log }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[updateTender] UNHANDLED:', error.message);
    return Response.json({ error: error.message, trace: log }, { status: 500, headers: corsHeaders });
  }
});
