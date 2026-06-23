/**
 * processPendingAssignments
 *
 * Login-triggered sync: activates all PendingProjectAssignment records
 * for the authenticated user's email.
 *
 * Idempotent:
 *  - Checks Project.team for existing email before appending.
 *  - Skips assignments already Activated or Cancelled.
 *  - Marks InvitedUser as Accepted once all assignments processed.
 *  - Initializes User.role and profile from invitation metadata (first login only).
 *  - Never downgrades admin users.
 *  - Never overwrites existing values.
 *
 * Called from AuthContext after successful login.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Normalize email for consistent identity matching
function normalizeEmail(email: string | undefined | null): string {
  return String(email || '').trim().toLowerCase();
}

// Valid permission roles — only these may ever be written to User.role
const VALID_APP_ROLES = ['admin', 'internal', 'pricing', 'external'];

// Look up the system permission role for a named project role via the project_roles table.
// Falls back to 'external' if no matching record found.
async function getSystemRoleFromDb(projectRoleName: string): Promise<string> {
  if (!projectRoleName) return 'external';
  try {
    const { data: records } = await supabaseAdmin.from('project_roles').select('*');
    const match = (records ?? []).find((r: any) =>
      r.name?.toLowerCase().trim() === projectRoleName.toLowerCase().trim()
    );
    if (match && VALID_APP_ROLES.includes(match.permission_role)) {
      return match.permission_role;
    }
  } catch (e: any) {
    console.warn('[processPendingAssignments] ProjectRole lookup failed, falling back to external:', e.message);
  }
  return 'external';
}

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

    // Load profile from public.users
    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();
    const user = { ...profile, id: authUser.id, email: authUser.email };

    const email = user.email?.toLowerCase().trim();
    if (!email) {
      return Response.json({ activated: 0, skipped: 0 }, { headers: corsHeaders });
    }

    const now = new Date().toISOString();

    // Fetch all pending assignments for this email
    const { data: assignments } = await supabaseAdmin
      .from('pending_project_assignments')
      .select('*')
      .match({ email, status: 'Pending' });

    if (!assignments || assignments.length === 0) {
      return Response.json({ activated: 0, skipped: 0, roleAssigned: null }, { headers: corsHeaders });
    }

    console.info('INVITATION ACTIVATION STARTED', { email, count: assignments.length });

    let activated = 0;
    let skipped = 0;

    // Batch load all projects in one query to avoid N+1
    const projectIds = [...new Set(assignments.map((a: any) => a.project_id).filter(Boolean))];
    const { data: batchProjectRows } = await supabaseAdmin
      .from('projects')
      .select('*')
      .in('id', projectIds);
    const projectMap = new Map((batchProjectRows ?? []).map((p: any) => [p.id, p]));

    for (const assignment of assignments) {
      try {
        const project = projectMap.get(assignment.project_id) ?? null;

        if (!project) {
          // Project no longer exists — cancel the assignment
          await supabaseAdmin
            .from('pending_project_assignments')
            .update({ status: 'Cancelled' })
            .eq('id', assignment.id);
          skipped++;
          continue;
        }

        const team: any[] = project.team || [];
        const alreadyMember = team.some((m: any) => normalizeEmail(m.user_email) === email);

        if (!alreadyMember) {
          team.push({
            user_email: normalizeEmail(user.email),
            full_name: assignment.full_name || user.full_name || '',
            business_name: assignment.business_name || user.business_name || '',
            phone: assignment.phone || user.phone || '',
            role: assignment.role,
            trade: assignment.trade || '',
          });
          await supabaseAdmin
            .from('projects')
            .update({ team })
            .eq('id', project.id);
          console.info('PROJECT MEMBERSHIP CREATED', { email, projectId: project.id, projectName: project.name, role: assignment.role });
        }

        await supabaseAdmin
          .from('pending_project_assignments')
          .update({ status: 'Activated' })
          .eq('id', assignment.id);

        await supabaseAdmin.from('audit_logs').insert({
          action: 'Project Assignment Activated',
          entity_type: 'PendingProjectAssignment',
          entity_id: assignment.id,
          project_id: assignment.project_id,
          invitation_id: assignment.invitation_id,
          user_id: user.id,
          user_name: user.full_name || user.email,
          description: alreadyMember
            ? `${user.email} already in project "${project.name}" — assignment marked activated without duplicate`
            : `${user.email} added to project "${project.name}" as ${assignment.role} on registration`,
          created_date: now,
        });

        activated++;
      } catch (err: any) {
        console.error(`[processPendingAssignments] Failed for assignment ${assignment.id}:`, err.message);
        skipped++;
      }
    }

    // Mark InvitedUser as Accepted if all assignments are now resolved
    if (activated > 0) {
      const { data: inviteRows } = await supabaseAdmin
        .from('invited_users')
        .select('*')
        .eq('email', email);
      const pendingInvite = (inviteRows ?? []).find((i: any) => i.status === 'Pending');

      if (pendingInvite) {
        // Derive permission role:
        //  1. If app_role is already a valid system role, use it directly.
        //  2. Otherwise look up the project_role name in the project_roles table.
        //  3. Fall back to 'external' if the lookup fails.
        const rawRole = (pendingInvite.app_role || '').toLowerCase().trim();
        let permissionRole: string;
        if (VALID_APP_ROLES.includes(rawRole)) {
          permissionRole = rawRole;
        } else {
          const projectRoleName = pendingInvite.project_role || assignments[0]?.role || '';
          permissionRole = await getSystemRoleFromDb(projectRoleName);
          console.info(`[processPendingAssignments] Resolved project role "${projectRoleName}" → "${permissionRole}" via project_roles table`);
        }

        // ── Profile initialization (first registration only) ──────────────────
        const profileAssignment = assignments[0];
        const projectRole = pendingInvite.project_role || profileAssignment?.role || '';

        // Fetch current user record to check existing values
        const { data: currentUserRow } = await supabaseAdmin
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();
        const currentUser: any = currentUserRow || {};
        const currentRole = (currentUser.role || '').toLowerCase();
        const isAdmin = currentRole === 'admin';

        // Never downgrade admins; never overwrite an already-set permission role
        const shouldSetRole = !isAdmin && (!currentRole || currentRole === 'user' || currentRole === 'external' || currentRole === '');

        const profileUpdate: Record<string, any> = {};

        if (shouldSetRole) {
          profileUpdate.role = permissionRole;
        }

        // Populate profile columns — only fill missing fields, registration values win.
        // users table has first_name/last_name/phone/business_name as top-level columns.
        if (!currentUser.first_name && profileAssignment?.full_name) {
          const parts = profileAssignment.full_name.trim().split(' ');
          profileUpdate.first_name = parts[0] || '';
          if (parts.length > 1) profileUpdate.last_name = parts.slice(1).join(' ');
        }
        if (!currentUser.last_name && !profileUpdate.last_name && profileAssignment?.full_name) {
          const parts = profileAssignment.full_name.trim().split(' ');
          if (parts.length > 1) profileUpdate.last_name = parts.slice(1).join(' ');
        }
        if (!currentUser.phone && profileAssignment?.phone) {
          profileUpdate.phone = profileAssignment.phone;
        }
        if (!currentUser.business_name && profileAssignment?.business_name) {
          profileUpdate.business_name = profileAssignment.business_name;
        }

        if (Object.keys(profileUpdate).length > 0) {
          await supabaseAdmin
            .from('users')
            .update(profileUpdate)
            .eq('id', user.id);
          if (shouldSetRole) {
            console.info(`ROLE ASSIGNED: ${permissionRole}`, { email, userId: user.id });
          }
        }

        await supabaseAdmin
          .from('invited_users')
          .update({ status: 'Accepted' })
          .eq('id', pendingInvite.id);

        // Audit log — profile initialization
        if (Object.keys(profileUpdate).length > 0) {
          await supabaseAdmin.from('audit_logs').insert({
            action: 'User Profile Initialized From Invitation',
            entity_type: 'User',
            entity_id: user.id,
            invitation_id: pendingInvite.id,
            user_id: user.id,
            user_name: user.full_name || user.email,
            description: `Profile initialized for ${user.email} — projectRole: ${projectRole}, permissionRole: ${permissionRole}`,
            created_date: now,
          });
        }

        await supabaseAdmin.from('audit_logs').insert({
          action: 'User Registered',
          entity_type: 'InvitedUser',
          entity_id: pendingInvite.id,
          invitation_id: pendingInvite.id,
          user_id: user.id,
          user_name: user.full_name || user.email,
          description: `${user.email} registered and accepted invitation (permission role: ${permissionRole})`,
          created_date: now,
        });
      }
    }

    const finalRole = activated > 0
      ? (() => {
          const inv = assignments[0];
          const raw = (inv?.permission_role || '').toLowerCase().trim();
          return VALID_APP_ROLES.includes(raw) ? raw : null;
        })()
      : null;

    if (activated > 0) {
      console.info('USER SETUP COMPLETE', { email, activated, skipped, roleAssigned: finalRole });
    }

    return Response.json({ activated, skipped, roleAssigned: finalRole }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[processPendingAssignments] ERROR:', error?.message, error?.stack);
    return Response.json({ error: error?.message }, { status: 500, headers: corsHeaders });
  }
});
