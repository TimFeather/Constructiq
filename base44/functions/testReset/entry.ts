import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Set TEST_UTILITIES_DISABLED=true in environment variables to disable in production
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

    if (action === 'purge_test_users') {
      // Delete all InvitedUser records
      const invited = await base44.asServiceRole.entities.InvitedUser.list();
      for (const r of invited) {
        await base44.asServiceRole.entities.InvitedUser.delete(r.id);
      }
      // Delete all PendingProjectAssignment records
      const pending = await base44.asServiceRole.entities.PendingProjectAssignment.list();
      for (const r of pending) {
        await base44.asServiceRole.entities.PendingProjectAssignment.delete(r.id);
      }
      return Response.json({
        message: `Purged ${invited.length} invited user(s) and ${pending.length} pending assignment(s).`
      });
    }

    if (action === 'reset_invitations') {
      // Delete all InvitedUser records
      const invited = await base44.asServiceRole.entities.InvitedUser.list();
      for (const r of invited) {
        await base44.asServiceRole.entities.InvitedUser.delete(r.id);
      }
      // Reset all PendingProjectAssignment statuses
      const pending = await base44.asServiceRole.entities.PendingProjectAssignment.list();
      for (const r of pending) {
        await base44.asServiceRole.entities.PendingProjectAssignment.update(r.id, { status: 'Pending' });
      }
      return Response.json({
        message: `Deleted ${invited.length} invitation(s). Reset ${pending.length} assignment(s) to Pending.`
      });
    }

    if (action === 'clear_audit_logs') {
      const logs = await base44.asServiceRole.entities.AuditLog.list();
      for (const r of logs) {
        await base44.asServiceRole.entities.AuditLog.delete(r.id);
      }
      return Response.json({ message: `Cleared ${logs.length} audit log record(s).` });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});