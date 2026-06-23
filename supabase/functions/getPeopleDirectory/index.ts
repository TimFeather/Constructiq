/**
 * getPeopleDirectory
 *
 * Returns a flattened people directory from the users table.
 * Admin-only endpoint.
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
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();
    const user: any = { ...profile, id: authUser.id, email: authUser.email };

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const { data: usersData } = await supabaseAdmin.from('users').select('*');
    const users: any[] = usersData ?? [];

    const directory = users.map((u: any) => {
      // Custom profile fields are stored at the top level on the User record
      // u.data holds only entity-level overrides (e.g. disabled flag)
      const entityData = u.data || {};
      return {
        id:            u.id,
        email:         u.email,
        role:          u.role || 'external',
        disabled:      entityData.disabled === true || u.disabled === true || false,
        first_name:    u.first_name || '',
        last_name:     u.last_name || '',
        phone:         u.phone || '',
        business_name: u.business_name || '',
        full_name:     u.full_name || '',
      };
    });

    return Response.json({ users: directory }, { headers: corsHeaders });

  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
