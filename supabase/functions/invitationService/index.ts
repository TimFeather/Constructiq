import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { escapeHtml } from '../_shared/escapeHtml.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
const TOKEN_EXPIRY_DAYS = 30;
const VALID_APP_ROLES = ['admin', 'internal', 'pricing', 'external'];

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

function toPermissionRole(role: string) {
  const r = (role || '').toLowerCase().trim();
  return VALID_APP_ROLES.includes(r) ? r : 'external';
}

async function getSystemRoleFromDb(projectRoleName: string) {
  if (!projectRoleName) return 'external';
  try {
    const { data: records } = await supabaseAdmin.from('project_roles').select('*');
    const match = (records ?? []).find((r: any) =>
      r.name?.toLowerCase().trim() === projectRoleName.toLowerCase().trim()
    );
    if (match && VALID_APP_ROLES.includes(match.permission_role)) return match.permission_role;
  } catch (e: any) {
    console.warn('[invitationService] ProjectRole lookup failed:', e.message);
  }
  return 'external';
}

function generateToken() { return crypto.randomUUID(); }

function tokenExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + TOKEN_EXPIRY_DAYS);
  return d.toISOString();
}

function isTokenValid(invitedUser: any) {
  if (!invitedUser.token || !invitedUser.token_expires_at) return false;
  return new Date(invitedUser.token_expires_at) > new Date();
}

async function sendInvitationEmail({ to, toName, projectName, inviterName, branding, token }: any) {
  const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
  const fromName = branding?.sender_name || branding?.company_name || 'ConstructIQ';
  // Invite-only: the register page requires this token to create an account.
  const registerUrl = token ? `${APP_URL}/register?token=${encodeURIComponent(token)}` : `${APP_URL}/register`;
  const brandColour = branding?.brand_colour || '#1a56db';
  const logoHtml = branding?.logo_url
    ? `<img src="${branding.logo_url}" alt="${fromName}" style="height:40px;" />`
    : `<div style="font-size:20px;font-weight:700;color:${brandColour};">${fromName}</div>`;

  const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Inter,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 0;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:${brandColour};padding:24px 32px;">${logoHtml}</td></tr>
<tr><td style="padding:32px;">
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">You've been invited to ConstructIQ</h2>
<p style="margin:0 0 12px;color:#4a5568;line-height:1.6;">Hi ${escapeHtml(toName || to)},</p>
<p style="margin:0 0 12px;color:#4a5568;line-height:1.6;"><strong>${escapeHtml(inviterName || 'A team member')}</strong> has invited you to join <strong>${projectName ? `the project "${escapeHtml(projectName)}"` : 'ConstructIQ'}</strong>.</p>
<p style="margin:0 0 24px;color:#4a5568;line-height:1.6;">Create your account to get started.</p>
<a href="${registerUrl}" style="display:inline-block;background:${brandColour};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Create Your Account →</a>
</td></tr></table></td></tr></table></body></html>`;

  return resend.emails.send({
    from: `${fromName} <${Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz'}>`,
    to,
    subject: projectName ? `You've been invited to join "${projectName}" on ConstructIQ` : `You've been invited to join ConstructIQ`,
    html: htmlBody,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt);
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();
    const user = { ...profile, id: authUser.id, email: authUser.email };

    if (!['admin', 'internal', 'pricing'].includes(user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { action } = body;

    // ── detect ──────────────────────────────────────────────────────────────
    if (action === 'detect') {
      const { email } = body;
      if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: corsHeaders });
      const normalEmail = normalizeEmail(email);

      const [{ data: users }, { data: invitedUsers }] = await Promise.all([
        supabaseAdmin.from('users').select('id, email, full_name, role').eq('email', normalEmail),
        supabaseAdmin.from('invited_users').select('*').eq('email', normalEmail),
      ]);

      const existingUser = (users ?? []).find((u: any) => normalizeEmail(u.email) === normalEmail);
      if (existingUser) return Response.json({ status: 'existing_user', user: existingUser }, { headers: corsHeaders });

      const pendingInvite = (invitedUsers ?? []).find((i: any) => i.status === 'Pending');
      if (pendingInvite) return Response.json({ status: 'pending', invitedUser: pendingInvite }, { headers: corsHeaders });

      const expiredInvite = (invitedUsers ?? []).find((i: any) => i.status === 'Expired');
      if (expiredInvite) return Response.json({ status: 'expired', invitedUser: expiredInvite }, { headers: corsHeaders });

      return Response.json({ status: 'new' }, { headers: corsHeaders });
    }

    // ── invitePlatform — invite a user to ConstructIQ (no project required) ─
    if (action === 'invitePlatform') {
      const { email, appRole, fullName } = body;
      if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: corsHeaders });

      const normalEmail = normalizeEmail(email);
      const permissionRole = VALID_APP_ROLES.includes((appRole || '').toLowerCase().trim())
        ? (appRole || '').toLowerCase().trim()
        : 'external';
      const now = new Date().toISOString();

      const { data: brandings } = await supabaseAdmin.from('email_branding').select('*').limit(1);
      const branding = brandings?.[0] || {};

      const { data: existingInvites } = await supabaseAdmin.from('invited_users').select('*').eq('email', normalEmail);
      let invitedUser: any = (existingInvites ?? []).find((i: any) => ['Pending', 'Expired'].includes(i.status)) || null;
      let isNewInvite = false;

      if (!invitedUser) {
        // Check if user already has an account
        const { data: existingUsers } = await supabaseAdmin.from('users').select('id, email').eq('email', normalEmail);
        if (existingUsers && existingUsers.length > 0) {
          return Response.json({ error: 'User already has an account' }, { status: 409, headers: corsHeaders });
        }

        const { data: newInvite } = await supabaseAdmin.from('invited_users').insert({
          email: normalEmail,
          app_role: permissionRole,
          project_role: '',
          invited_by_email: user.email,
          status: 'Pending',
          token: generateToken(),
          token_created_at: now,
          token_expires_at: tokenExpiryDate(),
          last_invited_at: now,
          resend_count: 0,
        }).select().single();
        invitedUser = newInvite;
        isNewInvite = true;
      } else {
        // Update existing pending/expired invite with new role + refresh token
        const { data: updated } = await supabaseAdmin.from('invited_users').update({
          app_role: permissionRole,
          status: 'Pending',
          token: generateToken(),
          token_created_at: now,
          token_expires_at: tokenExpiryDate(),
          last_invited_at: now,
          resend_count: (invitedUser.resend_count || 0) + 1,
        }).eq('id', invitedUser.id).select().single();
        invitedUser = updated;
      }

      sendInvitationEmail({ to: normalEmail, toName: fullName, inviterName: user.full_name || user.email, branding, token: invitedUser?.token }).catch((e: any) => {
        console.error('[invitationService] Platform invite email failed:', e.message);
        supabaseAdmin.from('audit_logs').insert({
          action: 'Email Failed',
          entity_type: 'InvitedUser',
          entity_id: invitedUser?.id,
          user_id: user.id,
          user_name: user.full_name || user.email,
          description: `Platform invitation email to ${normalEmail} failed: ${e.message}`,
          created_at: now,
        }).then(() => {});
      });

      supabaseAdmin.from('audit_logs').insert({
        action: isNewInvite ? 'Platform Invitation Created' : 'Platform Invitation Resent',
        entity_type: 'InvitedUser',
        entity_id: invitedUser?.id,
        user_id: user.id,
        user_name: user.full_name || user.email,
        description: `Platform invitation ${isNewInvite ? 'sent' : 'resent'} to ${normalEmail} with role ${permissionRole}`,
        created_date: now,
      }).then(null, () => {});

      return Response.json({ success: true, isNewInvite, invitedUser }, { headers: corsHeaders });
    }

    // ── invite ───────────────────────────────────────────────────────────────
    if (action === 'invite') {
      const { email, fullName, businessName, phone, trade, projectId, projectName, role, appRole, projectRole } = body;
      if (!email || !projectId || !role) {
        return Response.json({ error: 'email, projectId, role required' }, { status: 400, headers: corsHeaders });
      }

      const permissionRole = VALID_APP_ROLES.includes((appRole || '').toLowerCase().trim())
        ? toPermissionRole(appRole)
        : await getSystemRoleFromDb(projectRole || role);

      const normalEmail = normalizeEmail(email);
      const now = new Date().toISOString();

      const { data: brandings } = await supabaseAdmin.from('email_branding').select('*').limit(1);
      const branding = brandings?.[0] || {};

      const { data: existingInvites } = await supabaseAdmin.from('invited_users').select('*').eq('email', normalEmail);
      let invitedUser: any = (existingInvites ?? []).find((i: any) => ['Pending', 'Expired'].includes(i.status)) || null;
      let isNewInvite = false;

      if (!invitedUser) {
        const { data: newInvite } = await supabaseAdmin.from('invited_users').insert({
          email: normalEmail,
          app_role: permissionRole,
          project_role: projectRole || role || '',
          invited_by_email: user.email,
          status: 'Pending',
          token: generateToken(),
          token_created_at: now,
          token_expires_at: tokenExpiryDate(),
          last_invited_at: now,
          resend_count: 0,
        }).select().single();
        invitedUser = newInvite;
        isNewInvite = true;
      } else if (!isTokenValid(invitedUser)) {
        const { data: updated } = await supabaseAdmin.from('invited_users').update({
          status: 'Pending',
          token: generateToken(),
          token_created_at: now,
          token_expires_at: tokenExpiryDate(),
          last_invited_at: now,
          resend_count: (invitedUser.resend_count || 0) + 1,
        }).eq('id', invitedUser.id).select().single();
        invitedUser = updated;
      }

      const { data: existingAssignments } = await supabaseAdmin.from('pending_project_assignments')
        .select('*').eq('email', normalEmail).eq('project_id', projectId);
      const activeAssignment = (existingAssignments ?? []).find((a: any) => a.status === 'Pending');

      let assignment;
      if (!activeAssignment) {
        const { data: newAssignment } = await supabaseAdmin.from('pending_project_assignments').insert({
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
          project_role: projectRole || role || '',
          permission_role: permissionRole,
          created_date: now,
        }).select().single();
        assignment = newAssignment;
      } else {
        assignment = activeAssignment;
      }

      if (isNewInvite) {
        sendInvitationEmail({ to: normalEmail, toName: fullName, projectName, inviterName: user.full_name || user.email, branding, token: invitedUser?.token }).catch((e: any) => {
          console.error('[invitationService] Email failed:', e.message);
          supabaseAdmin.from('audit_logs').insert({
            action: 'Email Failed',
            entity_type: 'InvitedUser',
            entity_id: invitedUser?.id,
            project_id: projectId,
            user_id: user.id,
            user_name: user.full_name || user.email,
            description: `Invitation email to ${normalEmail} failed: ${e.message}`,
            created_at: new Date().toISOString(),
          }).then(() => {});
        });
      }

      supabaseAdmin.from('audit_logs').insert({
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
      }).then(null, () => {});

      return Response.json({ success: true, isNewInvite, duplicateAssignment: !!activeAssignment, invitedUser, assignment }, { headers: corsHeaders });
    }

    // ── resend ───────────────────────────────────────────────────────────────
    if (action === 'resend') {
      const { invitedUserId } = body;
      if (!invitedUserId) return Response.json({ error: 'invitedUserId required' }, { status: 400, headers: corsHeaders });

      const { data: brandings } = await supabaseAdmin.from('email_branding').select('*').limit(1);
      const branding = brandings?.[0] || {};
      const { data: invitedUser } = await supabaseAdmin.from('invited_users').select('*').eq('id', invitedUserId).single();
      if (!invitedUser) return Response.json({ error: 'InvitedUser not found' }, { status: 404, headers: corsHeaders });

      const now = new Date().toISOString();
      let token = invitedUser.token;
      if (!isTokenValid(invitedUser)) {
        token = generateToken();
        await supabaseAdmin.from('invited_users').update({ status: 'Pending', token, token_created_at: now, token_expires_at: tokenExpiryDate() }).eq('id', invitedUserId);
      }
      await supabaseAdmin.from('invited_users').update({ last_invited_at: now, resend_count: (invitedUser.resend_count || 0) + 1 }).eq('id', invitedUserId);

      const { data: assignments } = await supabaseAdmin.from('pending_project_assignments').select('*').eq('email', invitedUser.email).eq('status', 'Pending');
      let projectName = '';
      if ((assignments ?? []).length > 0) {
        const { data: projects } = await supabaseAdmin.from('projects').select('name').eq('id', assignments![0].project_id).single();
        projectName = projects?.name || '';
      }

      await sendInvitationEmail({ to: invitedUser.email, projectName, inviterName: user.full_name || user.email, branding, token });
      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // ── cancelProjectInvite — cancel pending invite for a specific project ───
    if (action === 'cancelProjectInvite') {
      const { email, projectId } = body;
      if (!email || !projectId) return Response.json({ error: 'email and projectId required' }, { status: 400, headers: corsHeaders });
      const normalEmail = normalizeEmail(email);

      // Cancel pending_project_assignments for this email + project
      await supabaseAdmin
        .from('pending_project_assignments')
        .update({ status: 'Cancelled' })
        .eq('email', normalEmail)
        .eq('project_id', projectId)
        .eq('status', 'Pending');

      // If invited_user has no remaining pending assignments, cancel their invite too
      const { data: remaining } = await supabaseAdmin
        .from('pending_project_assignments')
        .select('id')
        .eq('email', normalEmail)
        .eq('status', 'Pending');

      if (!remaining || remaining.length === 0) {
        await supabaseAdmin
          .from('invited_users')
          .update({ status: 'Cancelled' })
          .eq('email', normalEmail)
          .eq('status', 'Pending');
      }

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // ── cancel ───────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      const { invitedUserId } = body;
      if (!invitedUserId) return Response.json({ error: 'invitedUserId required' }, { status: 400, headers: corsHeaders });

      await supabaseAdmin.from('invited_users').update({ status: 'Cancelled' }).eq('id', invitedUserId);
      const { data: assignments } = await supabaseAdmin.from('pending_project_assignments').select('id').eq('invitation_id', invitedUserId).eq('status', 'Pending');
      await Promise.all((assignments ?? []).map((a: any) => supabaseAdmin.from('pending_project_assignments').update({ status: 'Cancelled' }).eq('id', a.id)));

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // ── addExistingUser ──────────────────────────────────────────────────────
    if (action === 'addExistingUser') {
      const { targetUserId, projectId, role, fullName, businessName, phone, trade } = body;
      if (!targetUserId || !projectId || !role) {
        return Response.json({ error: 'targetUserId, projectId, role required' }, { status: 400, headers: corsHeaders });
      }

      const [{ data: projectData }, { data: targetUserData }] = await Promise.all([
        supabaseAdmin.from('projects').select('*').eq('id', projectId).single(),
        supabaseAdmin.from('users').select('*').eq('id', targetUserId).single(),
      ]);

      if (!projectData) return Response.json({ error: 'Project not found' }, { status: 404, headers: corsHeaders });
      if (!targetUserData) return Response.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });

      const team = projectData.team || [];
      const alreadyMember = team.some((m: any) => normalizeEmail(m.user_email) === normalizeEmail(targetUserData.email));
      if (!alreadyMember) {
        team.push({
          user_email: normalizeEmail(targetUserData.email),
          full_name: fullName || targetUserData.full_name || '',
          business_name: businessName || targetUserData.business_name || '',
          phone: phone || targetUserData.phone || '',
          role,
          trade: trade || '',
        });
        await supabaseAdmin.from('projects').update({ team }).eq('id', projectId);
      }

      return Response.json({ success: true, alreadyMember }, { headers: corsHeaders });
    }

    // ── removeFromProjectTeams ───────────────────────────────────────────────
    if (action === 'removeFromProjectTeams') {
      const { targetEmail } = body;
      if (!targetEmail) return Response.json({ error: 'targetEmail required' }, { status: 400, headers: corsHeaders });
      const normalEmail = normalizeEmail(targetEmail);

      // Filter in DB using JSONB containment — avoids loading all projects into memory
      const { data: affected } = await supabaseAdmin
        .from('projects')
        .select('id, team')
        .filter('team', 'cs', JSON.stringify([{ user_email: normalEmail }]));

      await Promise.all(affected.map(async (project: any) => {
        const updatedTeam = project.team.filter((m: any) => normalizeEmail(m.user_email) !== normalEmail);
        await supabaseAdmin.from('projects').update({ team: updatedTeam }).eq('id', project.id);
      }));

      return Response.json({ success: true, projectsAffected: affected.length }, { headers: corsHeaders });
    }

    // ── bulkInviteProjectTeam ────────────────────────────────────────────────
    // Called after tender-to-project conversion to email/invite team members
    if (action === 'bulkInviteProjectTeam') {
      const { projectId, projectName, teamMembers } = body;
      if (!projectId || !teamMembers?.length) {
        return Response.json({ error: 'projectId and teamMembers required' }, { status: 400, headers: corsHeaders });
      }

      const { data: brandingsData } = await supabaseAdmin.from('email_branding').select('*');
      const branding    = (brandingsData ?? [])[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';
      const fromName    = branding.sender_name   || branding.company_name || 'ConstructIQ';
      const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
      const fromEmail   = `${fromName} <${senderEmail}>`;
      const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));

      const results = [];
      for (const member of teamMembers) {
        if (!member.email) continue;
        const email = normalizeEmail(member.email);

        // Check if user already exists in system
        const { data: existingUsers } = await supabaseAdmin
          .from('users').select('id, email, full_name').eq('email', email);
        const existingUser = (existingUsers ?? [])[0];

        if (existingUser) {
          // Existing user — send notification email
          try {
            await resend.emails.send({
              from:    fromEmail,
              to:      email,
              subject: `You've been added to ${projectName}`,
              html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px 16px;">
<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <tr><td style="background:${brandColour};height:4px;"></td></tr>
  <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
    <p>Hi <strong>${escapeHtml(member.name || existingUser.full_name || email)}</strong>,</p>
    <p>You have been added to <strong>${escapeHtml(projectName)}</strong> as a <strong>${escapeHtml(member.role || 'team member')}</strong>.</p>
    <p>Log in to ConstructIQ to view the project.</p>
    <p style="margin-top:24px;">
      <a href="${APP_URL}" style="background:${brandColour};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
        Open ConstructIQ
      </a>
    </p>
    <p style="color:#6b7280;font-size:13px;margin-top:24px;">Regards,<br>${escapeHtml(branding.company_name || 'ConstructIQ')}</p>
  </td></tr>
  <tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></body></html>`,
            });
            results.push({ email, status: 'notified', isNewUser: false });
          } catch (_e) {
            results.push({ email, status: 'notify_failed', isNewUser: false });
          }
        } else {
          // New user — create invited_users record (same as manual invite flow)
          const token   = generateToken();
          const expires = tokenExpiryDate();
          try {
            await supabaseAdmin.from('invited_users').upsert({
              email,
              app_role:     'external',
              project_id:   projectId,
              project_name: projectName,
              status:       'Pending',
              token,
              token_created_at: new Date().toISOString(),
              token_expires_at: expires,
              last_invited_at:  new Date().toISOString(),
              resend_count: 0,
            }, { onConflict: 'email' });

            // Send invitation email so new users know they've been added
            await sendInvitationEmail({
              to: email,
              toName: member.name || email,
              projectName,
              inviterName: null,
              branding,
              token,
            }).catch((_e: any) => {
              console.warn(`[bulkInviteProjectTeam] Email failed for ${email}:`, _e?.message);
            });

            results.push({ email, status: 'invited', isNewUser: true });
          } catch (_e) {
            results.push({ email, status: 'invite_failed', isNewUser: true });
          }
        }
      }

      return Response.json({ success: true, results }, { headers: corsHeaders });
    }

    // ── notifyCI ─────────────────────────────────────────────────────────────
    // Send CI notification to project subcontractors
    if (action === 'notifyCI') {
      const { projectId, projectName, ciNumber, ciTitle, ciType, recipients } = body;
      if (!recipients?.length) return Response.json({ success: true, sent: 0 }, { headers: corsHeaders });

      const { data: brandingsData } = await supabaseAdmin.from('email_branding').select('*');
      const branding    = (brandingsData ?? [])[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';
      const fromName    = branding.sender_name   || branding.company_name || 'ConstructIQ';
      const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
      const fromEmail   = `${fromName} <${senderEmail}>`;
      const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));

      let sent = 0;
      for (const r of recipients) {
        try {
          await resend.emails.send({
            from: fromEmail, to: r.email,
            subject: `${projectName} — ${ciNumber} Issued`,
            html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px 16px;">
<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:${brandColour};height:4px;"></td></tr>
  <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
    <p>Hi ${escapeHtml(r.name || r.email)},</p>
    <p>A new Contract Instruction has been issued for <strong>${escapeHtml(projectName)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:6px;">
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">CI Number</td>
          <td style="padding:10px 14px;font-weight:600;">${escapeHtml(ciNumber)}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Type</td>
          <td style="padding:10px 14px;">${escapeHtml(ciType)}</td></tr>
      <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;">Title</td>
          <td style="padding:10px 14px;">${escapeHtml(ciTitle)}</td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px;">Regards,<br>${escapeHtml(branding.company_name || 'ConstructIQ')}</p>
  </td></tr>
  <tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></body></html>`,
          });
          sent++;
        } catch (_e: any) {
          console.warn(`[invitationService] notifyCI email failed for ${r.email}:`, _e?.message);
        }
      }
      return Response.json({ success: true, sent }, { headers: corsHeaders });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: corsHeaders });

  } catch (error: any) {
    console.error('[invitationService] ERROR:', error?.message);
    return Response.json({ error: error?.message }, { status: 500, headers: corsHeaders });
  }
});
