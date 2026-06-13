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
 *
 * Called from AuthContext after successful login.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
        await base44.asServiceRole.entities.InvitedUser.update(pendingInvite.id, { status: 'Accepted' });
        await base44.asServiceRole.entities.AuditLog.create({
          action: 'User Registered',
          entity_type: 'InvitedUser',
          entity_id: pendingInvite.id,
          invitation_id: pendingInvite.id,
          user_id: user.id,
          user_name: user.full_name || user.email,
          description: `${user.email} registered and accepted invitation`,
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