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
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Valid permission roles — only these may ever be written to User.role
const VALID_APP_ROLES = ['admin', 'internal', 'pricing', 'external'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const email = user.email?.toLowerCase().trim();
    if (!email) return Response.json({ activated: 0, skipped: 0 });

    const now = new Date().toISOString();

    // Fetch all pending assignments for this email
    const assignments = await base44.asServiceRole.entities.PendingProjectAssignment.filter({
      email,
      status: 'Pending',
    });

    if (assignments.length === 0) {
      return Response.json({ activated: 0, skipped: 0 });
    }

    let activated = 0;
    let skipped = 0;

    for (const assignment of assignments) {
      try {
        const projects = await base44.asServiceRole.entities.Project.filter({ id: assignment.project_id });
        const project = projects[0];
        if (!project) {
          // Project no longer exists — cancel the assignment
          await base44.asServiceRole.entities.PendingProjectAssignment.update(assignment.id, { status: 'Cancelled' });
          skipped++;
          continue;
        }

        const team = project.team || [];
        const alreadyMember = team.some(m => m.user_email?.toLowerCase() === email);

        if (!alreadyMember) {
          team.push({
            user_email: user.email,
            full_name: assignment.full_name || user.full_name || '',
            business_name: assignment.business_name || user.business_name || '',
            phone: assignment.phone || user.phone || '',
            role: assignment.role,
            trade: assignment.trade || '',
          });
          await base44.asServiceRole.entities.Project.update(project.id, { team });
        }

        await base44.asServiceRole.entities.PendingProjectAssignment.update(assignment.id, {
          status: 'Activated',
        });

        await base44.asServiceRole.entities.AuditLog.create({
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
      } catch (err) {
        console.error(`[processPendingAssignments] Failed for assignment ${assignment.id}:`, err.message);
        skipped++;
      }
    }

    // Mark InvitedUser as Accepted if all assignments are now resolved
    if (activated > 0) {
      const inviteRecords = await base44.asServiceRole.entities.InvitedUser.filter({ email });
      const pendingInvite = inviteRecords.find(i => i.status === 'Pending');
      if (pendingInvite) {
        // Sanitize permission role — project roles (e.g. Architect, Client) must never
        // be written to User.role. Fall back to 'external' for any unrecognised value.
        const rawRole = (pendingInvite.app_role || '').toLowerCase().trim();
        const permissionRole = VALID_APP_ROLES.includes(rawRole) ? rawRole : 'external';
        if (permissionRole !== rawRole) {
          console.warn(`[processPendingAssignments] Invalid app_role "${pendingInvite.app_role}" — defaulting to external`);
        }

        // ── Profile initialization (first registration only) ──────────────────
        // Read the most relevant pending assignment for profile metadata
        const profileAssignment = assignments[0];
        const projectRole = pendingInvite.project_role || profileAssignment?.role || '';

        // Fetch current user record to check existing values
        const userRecords = await base44.asServiceRole.entities.User.filter({ id: user.id });
        const currentUser = userRecords[0] || {};
        const currentRole = (currentUser.role || '').toLowerCase();
        const isAdmin = currentRole === 'admin';

        // Never downgrade admins; never overwrite an already-set permission role
        const shouldSetRole = !isAdmin && (!currentRole || currentRole === 'user' || currentRole === '');

        const profileUpdate = {};

        // Set permission role if not already set and not admin
        if (shouldSetRole) {
          profileUpdate.role = permissionRole;
        }

        // Populate profile data — only fill missing fields, registration values win
        const existingData = currentUser.data || {};
        const dataUpdate = {};

        if (!existingData.first_name && profileAssignment?.full_name) {
          const parts = profileAssignment.full_name.trim().split(' ');
          dataUpdate.first_name = parts[0] || '';
          if (parts.length > 1) dataUpdate.last_name = parts.slice(1).join(' ');
        }
        if (!existingData.last_name && dataUpdate.last_name === undefined && profileAssignment?.full_name) {
          const parts = profileAssignment.full_name.trim().split(' ');
          if (parts.length > 1) dataUpdate.last_name = parts.slice(1).join(' ');
        }
        if (!existingData.phone && profileAssignment?.phone) {
          dataUpdate.phone = profileAssignment.phone;
        }
        if (!existingData.business_name && profileAssignment?.business_name) {
          dataUpdate.business_name = profileAssignment.business_name;
        }
        if (!existingData.construction_role && projectRole) {
          dataUpdate.construction_role = projectRole;
        }

        if (Object.keys(dataUpdate).length > 0) {
          profileUpdate.data = { ...existingData, ...dataUpdate };
        }

        if (Object.keys(profileUpdate).length > 0) {
          await base44.asServiceRole.entities.User.update(user.id, profileUpdate);
        }

        await base44.asServiceRole.entities.InvitedUser.update(pendingInvite.id, { status: 'Accepted' });

        // Audit log — profile initialization
        if (Object.keys(dataUpdate).length > 0 || shouldSetRole) {
          await base44.asServiceRole.entities.AuditLog.create({
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

        await base44.asServiceRole.entities.AuditLog.create({
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

    return Response.json({ activated, skipped });

  } catch (error) {
    console.error('[processPendingAssignments] ERROR:', error?.message, error?.stack);
    return Response.json({ error: error?.message }, { status: 500 });
  }
});