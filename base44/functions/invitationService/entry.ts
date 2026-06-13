/**
 * invitationService
 *
 * Central invitation engine for ConstructIQ.
 * Handles all user invitation lifecycle events:
 *   - Detect invitation status (existing user / pending / new)
 *   - Create InvitedUser with token
 *   - Reuse existing valid tokens
 *   - Create PendingProjectAssignment
 *   - Send invitation email via Resend
 *   - Write AuditLog entries
 *
 * Future user types (Clients, Architects, External PMs, Subcontractors)
 * must all route through this service.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

const APP_URL = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const TOKEN_EXPIRY_DAYS = 30;

function generateToken() {
  return crypto.randomUUID();
}

function tokenExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + TOKEN_EXPIRY_DAYS);
  return d.toISOString();
}

function isTokenValid(invitedUser) {
  if (!invitedUser.token || !invitedUser.token_expires_at) return false;
  return new Date(invitedUser.token_expires_at) > new Date();
}

async function sendInvitationEmail(base44, { to, toName, projectName, inviterName, token, branding }) {
  const resend = new Resend(RESEND_API_KEY);
  const fromName = branding?.sender_name || branding?.company_name || 'ConstructIQ';
  const registerUrl = `${APP_URL}/register`;

  const brandColour = branding?.brand_colour || '#1a56db';
  const logoHtml = branding?.logo_url
    ? `<img src="${branding.logo_url}" alt="${fromName}" style="height:40px;margin-bottom:16px;" />`
    : `<div style="font-size:20px;font-weight:700;color:${brandColour};margin-bottom:16px;">${fromName}</div>`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Inter,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:${brandColour};padding:24px 32px;">
          ${logoHtml.replace('margin-bottom:16px;', 'margin-bottom:0;')}
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">You've been invited to ConstructIQ</h2>
          <p style="margin:0 0 12px;color:#4a5568;line-height:1.6;">
            Hi ${toName || to},
          </p>
          <p style="margin:0 0 12px;color:#4a5568;line-height:1.6;">
            <strong>${inviterName || 'A team member'}</strong> has invited you to join
            <strong>${projectName ? `the project "${projectName}"` : 'ConstructIQ'}</strong>.
          </p>
          <p style="margin:0 0 24px;color:#4a5568;line-height:1.6;">
            Create your account to get started.
          </p>
          <a href="${registerUrl}"
            style="display:inline-block;background:${brandColour};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">
            Create Your Account →
          </a>
          <p style="margin:24px 0 0;color:#718096;font-size:13px;line-height:1.6;">
            If you did not expect this invitation, you can safely ignore this email.
          </p>
        </td></tr>
        ${branding?.footer_text ? `<tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#a0aec0;font-size:12px;">${branding.footer_text}</p>
        </td></tr>` : ''}
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return resend.emails.send({
    from: `${fromName} <noreply@totalhomesolutions.co.nz>`,
    to,
    subject: projectName
      ? `You've been invited to join "${projectName}" on ConstructIQ`
      : `You've been invited to join ConstructIQ`,
    html: htmlBody,
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = ['admin', 'internal', 'pricing'].includes(user.role);
    if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const { action } = body;

    // ── ACTION: detect ─────────────────────────────────────────────────────
    // Returns { status: 'existing_user'|'pending'|'new', invitedUser?, user? }
    if (action === 'detect') {
      const { email } = body;
      if (!email) return Response.json({ error: 'email required' }, { status: 400 });

      const normalEmail = email.toLowerCase().trim();
      const [users, invitedUsers] = await Promise.all([
        base44.asServiceRole.entities.User.list(),
        base44.asServiceRole.entities.InvitedUser.filter({ email: normalEmail }),
      ]);

      const existingUser = users.find(u => u.email?.toLowerCase() === normalEmail);
      if (existingUser) {
        return Response.json({ status: 'existing_user', user: existingUser });
      }

      const activeInvite = invitedUsers.find(i => ['Pending', 'Expired'].includes(i.status));
      if (activeInvite) {
        return Response.json({ status: 'pending', invitedUser: activeInvite });
      }

      return Response.json({ status: 'new' });
    }

    // ── ACTION: invite ─────────────────────────────────────────────────────
    // Creates or reuses InvitedUser, creates PendingProjectAssignment, sends email
    if (action === 'invite') {
      const { email, fullName, businessName, phone, trade, projectId, projectName, role } = body;
      if (!email || !projectId || !role) {
        return Response.json({ error: 'email, projectId, role required' }, { status: 400 });
      }

      const normalEmail = email.toLowerCase().trim();
      const now = new Date().toISOString();

      // Load branding
      const brandings = await base44.asServiceRole.entities.EmailBranding.list();
      const branding = brandings[0] || {};

      // Find or create InvitedUser
      const existing = await base44.asServiceRole.entities.InvitedUser.filter({ email: normalEmail });
      let invitedUser = existing.find(i => ['Pending', 'Expired'].includes(i.status)) || null;
      let isNewInvite = false;

      if (!invitedUser) {
        // New invite
        const token = generateToken();
        invitedUser = await base44.asServiceRole.entities.InvitedUser.create({
          email: normalEmail,
          app_role: 'external',
          invited_by_email: user.email,
          status: 'Pending',
          token,
          token_created_at: now,
          token_expires_at: tokenExpiryDate(),
          last_invited_at: now,
          resend_count: 0,
        });
        isNewInvite = true;
      } else if (!isTokenValid(invitedUser)) {
        // Expired token — regenerate
        const token = generateToken();
        invitedUser = await base44.asServiceRole.entities.InvitedUser.update(invitedUser.id, {
          status: 'Pending',
          token,
          token_created_at: now,
          token_expires_at: tokenExpiryDate(),
          last_invited_at: now,
          resend_count: (invitedUser.resend_count || 0) + 1,
        });
      }
      // else: reuse existing valid token — no update needed

      // Check for duplicate PendingProjectAssignment
      const existingAssignments = await base44.asServiceRole.entities.PendingProjectAssignment.filter({
        email: normalEmail,
        project_id: projectId,
      });
      const activeAssignment = existingAssignments.find(a => a.status === 'Pending');

      let assignment;
      if (!activeAssignment) {
        assignment = await base44.asServiceRole.entities.PendingProjectAssignment.create({
          email: normalEmail,
          project_id: projectId,
          role,
          invited_by: user.email,
          invitation_id: invitedUser.id,
          status: 'Pending',
          full_name: fullName || '',
          business_name: businessName || '',
          phone: phone || '',
          trade: trade || '',
          created_date: now,
        });
      } else {
        assignment = activeAssignment;
      }

      // Send email only for new invites or if explicitly requested
      let emailResult = null;
      if (isNewInvite) {
        try {
          emailResult = await sendInvitationEmail(base44, {
            to: normalEmail,
            toName: fullName,
            projectName,
            inviterName: user.full_name || user.email,
            token: invitedUser.token,
            branding,
          });
        } catch (e) {
          console.error('[invitationService] Email failed:', e.message);
        }
      }

      // AuditLog
      await base44.asServiceRole.entities.AuditLog.create({
        action: isNewInvite ? 'Invitation Created' : 'Pending User Assigned To Project',
        entity_type: 'InvitedUser',
        entity_id: invitedUser.id,
        project_id: projectId,
        invitation_id: invitedUser.id,
        user_id: user.id,
        user_name: user.full_name || user.email,
        description: isNewInvite
          ? `Invitation sent to ${normalEmail} for project "${projectName || projectId}"`
          : `${normalEmail} assigned to project "${projectName || projectId}" (reusing existing invitation)`,
        created_date: now,
      });

      return Response.json({
        success: true,
        isNewInvite,
        duplicateAssignment: !!activeAssignment,
        invitedUser,
        assignment,
      });
    }

    // ── ACTION: resend ─────────────────────────────────────────────────────
    if (action === 'resend') {
      const { invitedUserId } = body;
      if (!invitedUserId) return Response.json({ error: 'invitedUserId required' }, { status: 400 });

      const brandings = await base44.asServiceRole.entities.EmailBranding.list();
      const branding = brandings[0] || {};

      const records = await base44.asServiceRole.entities.InvitedUser.filter({ id: invitedUserId });
      const invitedUser = records[0];
      if (!invitedUser) return Response.json({ error: 'InvitedUser not found' }, { status: 404 });

      const now = new Date().toISOString();
      let token = invitedUser.token;

      if (!isTokenValid(invitedUser)) {
        token = generateToken();
        await base44.asServiceRole.entities.InvitedUser.update(invitedUserId, {
          status: 'Pending',
          token,
          token_created_at: now,
          token_expires_at: tokenExpiryDate(),
        });
      }

      await base44.asServiceRole.entities.InvitedUser.update(invitedUserId, {
        last_invited_at: now,
        resend_count: (invitedUser.resend_count || 0) + 1,
      });

      // Get one of their pending project assignments for context
      const assignments = await base44.asServiceRole.entities.PendingProjectAssignment.filter({
        email: invitedUser.email,
        status: 'Pending',
      });
      let projectName = '';
      if (assignments.length > 0) {
        const projects = await base44.asServiceRole.entities.Project.filter({ id: assignments[0].project_id });
        projectName = projects[0]?.name || '';
      }

      await sendInvitationEmail(base44, {
        to: invitedUser.email,
        projectName,
        inviterName: user.full_name || user.email,
        token,
        branding,
      });

      await base44.asServiceRole.entities.AuditLog.create({
        action: 'Invitation Resent',
        entity_type: 'InvitedUser',
        entity_id: invitedUserId,
        invitation_id: invitedUserId,
        user_id: user.id,
        user_name: user.full_name || user.email,
        description: `Invitation resent to ${invitedUser.email}`,
        created_date: now,
      });

      return Response.json({ success: true });
    }

    // ── ACTION: cancel ─────────────────────────────────────────────────────
    if (action === 'cancel') {
      const { invitedUserId } = body;
      if (!invitedUserId) return Response.json({ error: 'invitedUserId required' }, { status: 400 });

      const now = new Date().toISOString();
      await base44.asServiceRole.entities.InvitedUser.update(invitedUserId, { status: 'Cancelled' });

      // Cancel all pending assignments
      const assignments = await base44.asServiceRole.entities.PendingProjectAssignment.filter({
        invitation_id: invitedUserId,
        status: 'Pending',
      });
      await Promise.all(assignments.map(a =>
        base44.asServiceRole.entities.PendingProjectAssignment.update(a.id, { status: 'Cancelled' })
      ));

      await base44.asServiceRole.entities.AuditLog.create({
        action: 'Invitation Cancelled',
        entity_type: 'InvitedUser',
        entity_id: invitedUserId,
        invitation_id: invitedUserId,
        user_id: user.id,
        user_name: user.full_name || user.email,
        description: `Invitation cancelled`,
        created_date: now,
      });

      return Response.json({ success: true });
    }

    // ── ACTION: addExistingUser ────────────────────────────────────────────
    // Adds a registered user directly to Project.team + sends notification
    if (action === 'addExistingUser') {
      const { targetUserId, projectId, role, fullName, businessName, phone, trade } = body;
      if (!targetUserId || !projectId || !role) {
        return Response.json({ error: 'targetUserId, projectId, role required' }, { status: 400 });
      }

      const now = new Date().toISOString();
      const [projectArr, targetUserArr] = await Promise.all([
        base44.asServiceRole.entities.Project.filter({ id: projectId }),
        base44.asServiceRole.entities.User.filter({ id: targetUserId }),
      ]);
      const project = projectArr[0];
      const targetUser = targetUserArr[0];
      if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });
      if (!targetUser) return Response.json({ error: 'User not found' }, { status: 404 });

      const team = project.team || [];
      const alreadyMember = team.some(m => m.user_email?.toLowerCase() === targetUser.email?.toLowerCase());
      if (!alreadyMember) {
        team.push({
          user_email: targetUser.email,
          full_name: fullName || targetUser.full_name || '',
          business_name: businessName || targetUser.business_name || '',
          phone: phone || targetUser.phone || '',
          role,
          trade: trade || '',
        });
        await base44.asServiceRole.entities.Project.update(projectId, { team });
      }

      await base44.asServiceRole.entities.AuditLog.create({
        action: 'User Added To Project',
        entity_type: 'Project',
        entity_id: projectId,
        project_id: projectId,
        user_id: user.id,
        user_name: user.full_name || user.email,
        description: `${targetUser.full_name || targetUser.email} added to project "${project.name}" as ${role}${alreadyMember ? ' (already member — skipped)' : ''}`,
        created_date: now,
      });

      return Response.json({ success: true, alreadyMember });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (error) {
    console.error('[invitationService] ERROR:', error?.message, error?.stack);
    return Response.json({ error: error?.message }, { status: 500 });
  }
});