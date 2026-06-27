/**
 * logTenderActivity
 *
 * Logs a structured event to the TenderActivity feed.
 * Can be called from the frontend or other backend functions.
 *
 * Payload:
 *   tenderId      string  (required)
 *   event_type    string  (required) — see tender_activity event_type enum
 *   description   string  (required)
 *   actor_name    string  (optional — defaults to current user or 'System')
 *   actor_email   string  (optional)
 *   metadata      object  (optional)
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Auth: require SERVICE_ROLE_KEY (backend callers) or admin/pricing/internal JWT
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const isServiceRole = token === SERVICE_ROLE_KEY;

    let authUser: any = null;
    if (!isServiceRole) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      const { data: profile } = await supabaseAdmin.from('users').select('role').eq('id', user.id).single();
      if (!['admin', 'pricing', 'internal'].includes(profile?.role || ''))
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
      authUser = user;
    }

    const body = await req.json();
    const { tenderId, event_type, description, actor_name, actor_email, metadata } = body;

    if (!tenderId || !event_type || !description) {
      return Response.json(
        { error: 'tenderId, event_type, and description are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    let actorName  = actor_name  || 'System';
    let actorEmail = actor_email || '';
    if (authUser) {
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      const user: any = { ...profile, id: authUser.id, email: authUser.email };
      actorName  = actor_name  || user.full_name || user.email || 'System';
      actorEmail = actor_email || user.email     || '';
    }

    const { data: record, error: insertError } = await supabaseAdmin
      .from('tender_activity')
      .insert({
        tender_id:   tenderId,
        event_type,
        description,
        actor_name:  actorName,
        actor_email: actorEmail,
        metadata:    metadata || null,
        occurred_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    return Response.json({ success: true, id: record?.id }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[logTenderActivity] ERROR:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
