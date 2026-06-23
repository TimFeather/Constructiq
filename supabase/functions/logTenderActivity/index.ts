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
    const body = await req.json();
    const { tenderId, event_type, description, actor_name, actor_email, metadata } = body;

    if (!tenderId || !event_type || !description) {
      return Response.json(
        { error: 'tenderId, event_type, and description are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Try to get the current user; fall back to 'System' for automated calls
    let actorName  = actor_name  || 'System';
    let actorEmail = actor_email || '';
    try {
      const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
      if (jwt) {
        const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt);
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
      }
    } catch (_) {
      // Unauthenticated / automated call — use System
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
