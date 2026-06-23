/**
 * testReset — admin test/QA cleanup utilities
 * Actions: environment_summary, reset_invitation_state, purge_test_users, clear_deactivated_users
 * Disabled via TEST_UTILITIES_DISABLED=true (default in production)
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
    const disabled = Deno.env.get('TEST_UTILITIES_DISABLED') === 'true';
    if (disabled) {
      return Response.json({ disabled: true, message: 'Test utilities are disabled' }, { headers: corsHeaders });
    }

    // Get auth user + verify admin/pricing role
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ error: 'Invalid token' }, { status: 401, headers: corsHeaders });
    }

    // Verify admin or pricing role
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = userData?.role;
    if (!['admin', 'pricing'].includes(role || '')) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const payload = await req.json();
    const { action } = payload;

    console.log(`[testReset] ${action} by ${user.email}`);

    // ── ENVIRONMENT_SUMMARY ──────────────────────────────────────────
    if (action === 'environment_summary') {
      const [users, invites, assignments] = await Promise.all([
        supabaseAdmin.from('users').select('id, role, disabled', { count: 'exact', head: false }),
        supabaseAdmin.from('invited_users').select('id, status', { count: 'exact', head: false }),
        supabaseAdmin.from('pending_project_assignments').select('id, status', { count: 'exact', head: false }),
      ]);

      const userList = users.data || [];
      const adminCount = userList.filter((u: any) => u.role === 'admin').length;
      const internalCount = userList.filter((u: any) => u.role === 'internal').length;
      const externalCount = userList.filter((u: any) => u.role === 'external').length;
      const pricingCount = userList.filter((u: any) => u.role === 'pricing').length;
      const activeCount = userList.filter((u: any) => !u.disabled).length;
      const deactivatedCount = userList.filter((u: any) => u.disabled).length;

      const inviteList = invites.data || [];
      const pendingInvites = inviteList.filter((i: any) => i.status === 'Pending').length;

      const assignmentList = assignments.data || [];
      const pendingAssignments = assignmentList.filter((a: any) => a.status === 'Pending').length;

      return Response.json({
        summary: {
          users_total: userList.length,
          admins: adminCount,
          internal: internalCount,
          external: externalCount,
          pricing: pricingCount,
          active: activeCount,
          deactivated: deactivatedCount,
          pending_invitations: pendingInvites,
          pending_assignments: pendingAssignments,
        },
      }, { headers: corsHeaders });
    }

    // ── RESET_INVITATION_STATE ───────────────────────────────────────
    if (action === 'reset_invitation_state') {
      const { error: e1 } = await supabaseAdmin.from('invited_users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      const { error: e2 } = await supabaseAdmin.from('pending_project_assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      if (e1 || e2) throw e1 || e2;
      return Response.json({ message: 'Invitation state reset — all invited_users and pending_project_assignments deleted' }, { headers: corsHeaders });
    }

    // ── PURGE_TEST_USERS ─────────────────────────────────────────────
    if (action === 'purge_test_users') {
      // Get all non-admin users
      const { data: nonAdminUsers } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .neq('role', 'admin');

      const nonAdminIds = (nonAdminUsers || []).map((u: any) => u.id);

      if (nonAdminIds.length === 0) {
        return Response.json({ message: 'No non-admin users to purge' }, { headers: corsHeaders });
      }

      // Remove from project teams
      const { data: projects } = await supabaseAdmin.from('projects').select('id, team');
      for (const proj of projects || []) {
        const updatedTeam = (proj.team || []).filter((m: any) => !nonAdminIds.includes(m.user_id));
        await supabaseAdmin.from('projects').update({ team: updatedTeam }).eq('id', proj.id);
      }

      // Delete invited_users and pending_assignments for these users
      await supabaseAdmin.from('invited_users').delete().in('id', nonAdminIds.map(() => '00000000-0000-0000-0000-000000000000')).or(`email.in.(${(nonAdminUsers || []).map((u: any) => `"${u.email}"`).join(',')})`);
      await supabaseAdmin.from('pending_project_assignments').delete().in('id', nonAdminIds.map(() => '00000000-0000-0000-0000-000000000000')).or(`email.in.(${(nonAdminUsers || []).map((u: any) => `"${u.email}"`).join(',')})`);

      // Delete users table records
      await supabaseAdmin.from('users').delete().in('id', nonAdminIds);

      // Delete auth users
      for (const userId of nonAdminIds) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(userId);
        } catch (e) {
          console.warn(`Failed to delete auth user ${userId}:`, e);
        }
      }

      return Response.json({ message: `Purged ${nonAdminIds.length} non-admin users and their references` }, { headers: corsHeaders });
    }

    // ── CLEAR_DEACTIVATED_USERS ──────────────────────────────────────
    if (action === 'clear_deactivated_users') {
      const { data: deactivatedUsers } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .eq('disabled', true);

      const deactivatedIds = (deactivatedUsers || []).map((u: any) => u.id);

      if (deactivatedIds.length === 0) {
        return Response.json({ message: 'No deactivated users to clear' }, { headers: corsHeaders });
      }

      // Remove from project teams
      const { data: projects } = await supabaseAdmin.from('projects').select('id, team');
      for (const proj of projects || []) {
        const updatedTeam = (proj.team || []).filter((m: any) => !deactivatedIds.includes(m.user_id));
        await supabaseAdmin.from('projects').update({ team: updatedTeam }).eq('id', proj.id);
      }

      // Delete invitation records
      await supabaseAdmin.from('invited_users').delete().in('id', deactivatedIds.map(() => '00000000-0000-0000-0000-000000000000')).or(`email.in.(${(deactivatedUsers || []).map((u: any) => `"${u.email}"`).join(',')})`);
      await supabaseAdmin.from('pending_project_assignments').delete().in('id', deactivatedIds.map(() => '00000000-0000-0000-0000-000000000000')).or(`email.in.(${(deactivatedUsers || []).map((u: any) => `"${u.email}"`).join(',')})`);

      // Delete users
      await supabaseAdmin.from('users').delete().in('id', deactivatedIds);

      // Delete auth users
      for (const userId of deactivatedIds) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(userId);
        } catch (e) {
          console.warn(`Failed to delete auth user ${userId}:`, e);
        }
      }

      return Response.json({ message: `Cleared ${deactivatedIds.length} deactivated users and their references` }, { headers: corsHeaders });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400, headers: corsHeaders });
  } catch (e: any) {
    console.error('[testReset] error:', e);
    return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
});
