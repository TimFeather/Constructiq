import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const DISABLED = Deno.env.get('TEST_UTILITIES_DISABLED') === 'true';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    if (DISABLED) {
      return Response.json({ disabled: true, message: 'Testing utilities disabled in production mode' });
    }

    const { action } = await req.json();

    // ─── 1. Reset Invitation State ───────────────────────────────────────────
    // Deletes InvitedUser + PendingProjectAssignment records only.
    // Does NOT touch User entities, auth identities, or project memberships.
    if (action === 'reset_invitation_state') {
      const invited = await base44.asServiceRole.entities.InvitedUser.list();
      for (const r of invited) {
        await base44.asServiceRole.entities.InvitedUser.delete(r.id);
      }
      const pending = await base44.asServiceRole.entities.PendingProjectAssignment.list();
      for (const r of pending) {
        await base44.asServiceRole.entities.PendingProjectAssignment.delete(r.id);
      }
      return Response.json({
        message: `Deleted ${invited.length} invitation(s) and ${pending.length} pending assignment(s). User accounts and project memberships untouched.`
      });
    }

    // ─── 2. Purge Test Users ─────────────────────────────────────────────────
    // Removes all registered non-admin users and their associated data.
    // Keeps: logged-in admin, all other admins.
    // Cleans: User entity, project team references, pending assignments, invited records.
    if (action === 'purge_test_users') {
      const allUsers = await base44.asServiceRole.entities.User.list();
      const toDelete = allUsers.filter(u => u.role !== 'admin' && u.id !== user.id);

      const emails = new Set(toDelete.map(u => u.email));

      // Remove from project teams
      const projects = await base44.asServiceRole.entities.Project.list();
      for (const project of projects) {
        const team = (project.team || []).filter(m => !emails.has(m.user_email));
        if (team.length !== (project.team || []).length) {
          await base44.asServiceRole.entities.Project.update(project.id, { team });
        }
      }

      // Delete their pending assignments
      const pending = await base44.asServiceRole.entities.PendingProjectAssignment.list();
      for (const r of pending) {
        if (emails.has(r.email)) {
          await base44.asServiceRole.entities.PendingProjectAssignment.delete(r.id);
        }
      }

      // Delete their InvitedUser records
      const invited = await base44.asServiceRole.entities.InvitedUser.list();
      for (const r of invited) {
        if (emails.has(r.email)) {
          await base44.asServiceRole.entities.InvitedUser.delete(r.id);
        }
      }

      // Delete User entity records (allows re-registration with same email)
      for (const u of toDelete) {
        await base44.asServiceRole.entities.User.delete(u.id);
      }

      return Response.json({
        message: `Purged ${toDelete.length} non-admin user(s). Emails are free to re-register.`,
        deleted_emails: [...emails]
      });
    }

    // ─── 3. Clear Deactivated Users ──────────────────────────────────────────
    // Removes users where data.disabled = true.
    // Same cleanup process as purge_test_users.
    if (action === 'clear_deactivated_users') {
      const allUsers = await base44.asServiceRole.entities.User.list();
      const toDelete = allUsers.filter(u => u.data?.disabled === true && u.id !== user.id);

      const emails = new Set(toDelete.map(u => u.email));

      // Remove from project teams
      const projects = await base44.asServiceRole.entities.Project.list();
      for (const project of projects) {
        const team = (project.team || []).filter(m => !emails.has(m.user_email));
        if (team.length !== (project.team || []).length) {
          await base44.asServiceRole.entities.Project.update(project.id, { team });
        }
      }

      // Delete their pending assignments
      const pending = await base44.asServiceRole.entities.PendingProjectAssignment.list();
      for (const r of pending) {
        if (emails.has(r.email)) {
          await base44.asServiceRole.entities.PendingProjectAssignment.delete(r.id);
        }
      }

      // Delete their InvitedUser records
      const invited = await base44.asServiceRole.entities.InvitedUser.list();
      for (const r of invited) {
        if (emails.has(r.email)) {
          await base44.asServiceRole.entities.InvitedUser.delete(r.id);
        }
      }

      // Delete User entity records
      for (const u of toDelete) {
        await base44.asServiceRole.entities.User.delete(u.id);
      }

      return Response.json({
        message: `Removed ${toDelete.length} deactivated user(s). Emails are free to re-register.`,
        deleted_emails: [...emails]
      });
    }

    // ─── 4. Environment Summary ───────────────────────────────────────────────
    if (action === 'environment_summary') {
      const allUsers = await base44.asServiceRole.entities.User.list();
      const invited = await base44.asServiceRole.entities.InvitedUser.list();
      const pending = await base44.asServiceRole.entities.PendingProjectAssignment.list();

      const admins = allUsers.filter(u => u.role === 'admin').length;
      const internal = allUsers.filter(u => u.role === 'internal').length;
      const external = allUsers.filter(u => u.role === 'external').length;
      const pricing = allUsers.filter(u => u.role === 'pricing').length;
      const deactivated = allUsers.filter(u => u.data?.disabled === true).length;
      const active = allUsers.length - deactivated;
      const pendingInvitations = invited.filter(i => i.status === 'Pending').length;
      const pendingAssignments = pending.filter(p => p.status === 'Pending').length;

      return Response.json({
        summary: {
          users_total: allUsers.length,
          admins,
          internal,
          external,
          pricing,
          active,
          deactivated,
          pending_invitations: pendingInvitations,
          pending_assignments: pendingAssignments,
        }
      });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});