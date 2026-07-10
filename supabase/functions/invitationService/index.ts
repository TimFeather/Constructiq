import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { escapeHtml } from '../_shared/escapeHtml.ts';
import { upsertTenderContact } from '../_shared/upsertTenderContact.ts';

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

// Optional accepted-quote paragraph for add/invite emails. Empty string when no
// quote ref was entered so templates render unchanged.
function quoteContextHtml(quoteRef: string) {
  const ref = String(quoteRef || '').trim();
  if (!ref) return '';
  return `<p>This appointment relates to your quote <strong>${escapeHtml(ref)}</strong>, which we have accepted.</p>`;
}

function tokenExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + TOKEN_EXPIRY_DAYS);
  return d.toISOString();
}

function isTokenValid(invitedUser: any) {
  if (!invitedUser.token || !invitedUser.token_expires_at) return false;
  return new Date(invitedUser.token_expires_at) > new Date();
}

// Default template for subcontractor invites — kept in sync with
// DEFAULT_TEMPLATES.subcontractor_invite in src/lib/emailTemplates.js.
// Used when no customised row exists in email_templates.
const SUBCONTRACTOR_INVITE_DEFAULT = {
  subject: "You've been appointed to {project_name}",
  body_html: `
<p>Hi <strong>{name}</strong>,</p>
<p><strong>{invited_by}</strong> has appointed you as a subcontractor on <strong>{project_name}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Project</td><td style="padding:6px 0;font-weight:500;">{project_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Company</td><td style="padding:6px 0;">{business_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Trade</td><td style="padding:6px 0;">{trade}</td></tr>
</table>
{quote_context}
<p>Create your account to access the project details.</p>
<p style="margin-top:24px;">
  <a href="{invite_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">
    Accept Invitation &amp; Register
  </a>
</p>
<p style="font-size:13px;color:#6b7280;margin-top:8px;">
  If you did not expect this invitation, you can safely ignore this email.
</p>`,
};

async function sendInvitationEmail({ to, toName, projectName, inviterName, branding, token, quoteRef, role, businessName, trade }: any) {
  const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
  const fromName = branding?.sender_name || branding?.company_name || 'ConstructIQ';
  // Invite-only: the register page requires this token to create an account.
  const registerUrl = token ? `${APP_URL}/register?token=${encodeURIComponent(token)}` : `${APP_URL}/register`;
  const brandColour = branding?.brand_colour || '#1a56db';

  // Subcontractor invites get their own customizable template (with quote
  // number, trade, etc.); everyone else keeps the generic user_invite.
  const isSubcontractor = String(role || '').trim().toLowerCase() === 'subcontractor';
  const templateKey = isSubcontractor ? 'subcontractor_invite' : 'user_invite';

  const { data: templates } = await supabaseAdmin.from('email_templates').select('*').eq('template_key', templateKey).limit(1);
  const dbTemplate = templates?.[0] || (isSubcontractor ? SUBCONTRACTOR_INVITE_DEFAULT : null);

  const quoteContext = quoteContextHtml(quoteRef);

  if (dbTemplate) {
    const vars: Record<string, string> = {
      name: escapeHtml(toName || to),
      invited_by: escapeHtml(inviterName || 'A team member'),
      business_name: escapeHtml(businessName || ''),
      trade: escapeHtml(trade || ''),
      project_name: escapeHtml(projectName || ''),
      quote_number: escapeHtml(String(quoteRef || '').trim()),
      project_context: projectName ? `<p>You've been invited to collaborate on <strong>${escapeHtml(projectName)}</strong>.</p>` : '',
      quote_context: quoteContext,
      invite_link: registerUrl,
    };
    let subject = dbTemplate.subject || '';
    let bodyHtml = dbTemplate.body_html || dbTemplate.body || '';
    // Customised DB templates may predate {quote_context}; append the quote
    // paragraph so an entered quote ref is never silently dropped.
    if (quoteContext && !bodyHtml.includes('{quote_context}')) bodyHtml += quoteContext;
    for (const [key, val] of Object.entries(vars)) {
      const re = new RegExp(`\\{${key}\\}`, 'g');
      subject = subject.replace(re, val ?? '');
      bodyHtml = bodyHtml.replace(re, val ?? '');
    }
    const logoHtml = branding?.logo_url
      ? `<div style="text-align:${branding.logo_alignment || 'left'};margin-bottom:20px;"><img src="${branding.logo_url}" alt="${escapeHtml(branding.company_name || 'Logo')}" width="${branding.logo_width || 160}" style="max-width:100%;height:auto;display:inline-block;" /></div>`
      : '';
    const footerHtml = branding?.footer_text
      ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.6;">${String(branding.footer_text).replace(/\n/g, '<br>')}</div>`
      : '';
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="background:${brandColour};height:4px;"></td></tr>
<tr><td style="padding:32px 40px;">${logoHtml}<div style="font-size:15px;color:#111827;line-height:1.7;">${bodyHtml}</div>${footerHtml}</td></tr>
<tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></td></tr></table></body></html>`;

    return resend.emails.send({
      from: `${fromName} <${Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz'}>`,
      to,
      subject,
      html,
    });
  }

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
${quoteContext}
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
      const { email, fullName, businessName, phone, trade, projectId, projectName, role, appRole, projectRole, quoteRef } = body;
      if (!email || !projectId || !role) {
        return Response.json({ error: 'email, projectId, role required' }, { status: 400, headers: corsHeaders });
      }

      const permissionRole = VALID_APP_ROLES.includes((appRole || '').toLowerCase().trim())
        ? toPermissionRole(appRole)
        : await getSystemRoleFromDb(projectRole || role);

      const normalEmail = normalizeEmail(email);
      const now = new Date().toISOString();

      // Non-fatal write-back into the shared people directory so this person
      // shows up as a suggestion next time (e.g. in InviteeManager).
      upsertTenderContact(supabaseAdmin, { fullName, businessName, email: normalEmail, phone, trade }).catch(() => {});

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

      if (isNewInvite || !activeAssignment) {
        sendInvitationEmail({ to: normalEmail, toName: fullName, projectName, inviterName: user.full_name || user.email, branding, token: invitedUser?.token, quoteRef, role: projectRole || role, businessName, trade }).catch((e: any) => {
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
      const { targetUserId, projectId, role, fullName, businessName, phone, trade, quoteRef } = body;
      if (!targetUserId || !projectId || !role) {
        return Response.json({ error: 'targetUserId, projectId, role required' }, { status: 400, headers: corsHeaders });
      }

      const [{ data: projectData }, { data: targetUserData }] = await Promise.all([
        supabaseAdmin.from('projects').select('*').eq('id', projectId).single(),
        supabaseAdmin.from('users').select('*').eq('id', targetUserId).single(),
      ]);

      if (!projectData) return Response.json({ error: 'Project not found' }, { status: 404, headers: corsHeaders });
      if (!targetUserData) return Response.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });

      // Non-fatal write-back into the shared people directory.
      upsertTenderContact(supabaseAdmin, {
        fullName: fullName || targetUserData.full_name || '',
        businessName: businessName || targetUserData.business_name || '',
        email: normalizeEmail(targetUserData.email),
        phone: phone || targetUserData.phone || '',
        trade,
      }).catch(() => {});

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
          quote_ref: quoteRef || '',
        });
        await supabaseAdmin.from('projects').update({ team }).eq('id', projectId);
      }

      // Send the "you've been added to project X" email server-side so it can't be
      // silently swallowed by a client-side try/catch. Never let this fail the request.
      // Skipped when they were already on the team (re-adding must not re-email).
      let emailSent = false;
      if (!alreadyMember) try {
        const memberName = fullName || targetUserData.full_name || targetUserData.email;

        const [{ data: templates }, { data: brandings }] = await Promise.all([
          supabaseAdmin.from('email_templates').select('*').eq('template_key', 'team_added').limit(1),
          supabaseAdmin.from('email_branding').select('*').limit(1),
        ]);

        const template = templates?.[0] || {
          subject: "You've been added to project: {project_name}",
          body_html: `
<p>Hi <strong>{name}</strong>,</p>
<p>You have been added to the project <strong>{project_name}</strong> as <strong>{role}</strong>.</p>
{quote_context}
<p>Please log in to view your project details and get started.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Best regards,<br>ConstructIQ</p>`,
        };
        const branding = brandings?.[0] || {};

        const quoteContext = quoteContextHtml(quoteRef);
        const vars: Record<string, string> = {
          name: escapeHtml(memberName),
          project_name: escapeHtml(projectData.name || ''),
          role: escapeHtml(role),
          quote_context: quoteContext,
        };

        let subject = template.subject || '';
        let bodyHtml = template.body_html || template.body || '';
        // Customised DB templates may predate {quote_context}; append the quote
        // paragraph so an entered quote ref is never silently dropped.
        if (quoteContext && !bodyHtml.includes('{quote_context}')) bodyHtml += quoteContext;
        for (const [key, val] of Object.entries(vars)) {
          const re = new RegExp(`\\{${key}\\}`, 'g');
          subject = subject.replace(re, val ?? '');
          bodyHtml = bodyHtml.replace(re, val ?? '');
        }

        const brandColour = branding.brand_colour || '#1a56db';
        const fromName    = branding.sender_name || branding.company_name || 'ConstructIQ';
        const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
        const fromEmail   = `${fromName} <${senderEmail}>`;
        const logoHtml = branding.logo_url
          ? `<div style="text-align:${branding.logo_alignment || 'left'};margin-bottom:20px;"><img src="${branding.logo_url}" alt="${escapeHtml(branding.company_name || 'Logo')}" width="${branding.logo_width || 160}" style="max-width:100%;height:auto;display:inline-block;" /></div>`
          : '';
        const footerHtml = branding.footer_text
          ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.6;">${String(branding.footer_text).replace(/\n/g, '<br>')}</div>`
          : '';

        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="background:${brandColour};height:4px;"></td></tr>
<tr><td style="padding:32px 40px;">${logoHtml}<div style="font-size:15px;color:#111827;line-height:1.7;">${bodyHtml}</div>${footerHtml}</td></tr>
<tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></td></tr></table></body></html>`;

        const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
        await resend.emails.send({
          from: fromEmail,
          to: targetUserData.email,
          subject,
          html,
        });
        emailSent = true;
      } catch (e: any) {
        console.error('[invitationService] addExistingUser email failed:', e?.message);
        await supabaseAdmin.from('audit_logs').insert({
          action: 'Email Failed',
          entity_type: 'Project',
          entity_id: projectId,
          project_id: projectId,
          user_id: user.id,
          user_name: user.full_name || user.email,
          description: `Team-added email to ${targetUserData.email} failed: ${e?.message}`,
          created_at: new Date().toISOString(),
        }).then(null, () => {});
      }

      return Response.json({ success: true, alreadyMember, emailSent }, { headers: corsHeaders });
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
      const { projectId, projectName, ciNumber, ciTitle, ciType, description, issueDate, hasAttachments, recipients } = body;
      if (!recipients?.length) return Response.json({ success: true, sent: 0 }, { headers: corsHeaders });

      const [{ data: templates }, { data: brandingsData }] = await Promise.all([
        supabaseAdmin.from('email_templates').select('*').eq('template_key', 'contract_instruction').limit(1),
        supabaseAdmin.from('email_branding').select('*'),
      ]);
      const template = templates?.[0] || {
        subject: 'Contract Instruction {ci_number} — {project_name}',
        body_html: `
<p>Hi <strong>{recipient_name}</strong>,</p>
<p>A Contract Instruction has been issued on project <strong>{project_name}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:160px;">Reference</td><td style="padding:6px 0;font-weight:500;">{ci_number}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Project</td><td style="padding:6px 0;font-weight:500;">{project_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Title</td><td style="padding:6px 0;font-weight:500;">{title}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Type</td><td style="padding:6px 0;">{instruction_type}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Issued</td><td style="padding:6px 0;">{issue_date}</td></tr>
</table>
<p style="color:#374151;"><strong>Description:</strong><br>{description}</p>
{attachments_note}
<p style="margin-top:24px;">
  <a href="{url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Contract Instruction</a>
</p>
<p style="font-size:13px;color:#6b7280;margin-top:8px;">Note: Attachments can be viewed by logging into the project portal.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}</p>`,
      };
      const branding    = (brandingsData ?? [])[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';
      const fromName    = branding.sender_name   || branding.company_name || 'ConstructIQ';
      const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
      const fromEmail   = `${fromName} <${senderEmail}>`;
      const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));
      const senderName  = user.full_name || user.email;
      const attachmentsNote = hasAttachments
        ? '<p style="color:#374151;">Attachments are available in the portal.</p>'
        : '';
      const logoHtml = branding.logo_url
        ? `<div style="text-align:${branding.logo_alignment || 'left'};margin-bottom:20px;"><img src="${branding.logo_url}" alt="${escapeHtml(branding.company_name || 'Logo')}" width="${branding.logo_width || 160}" style="max-width:100%;height:auto;display:inline-block;" /></div>`
        : '';
      const footerHtml = branding.footer_text
        ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.6;">${String(branding.footer_text).replace(/\n/g, '<br>')}</div>`
        : '';

      let sent = 0;
      for (const r of recipients) {
        try {
          const vars: Record<string, string> = {
            recipient_name:    escapeHtml(r.name || r.email),
            ci_number:         escapeHtml(ciNumber || ''),
            project_name:      escapeHtml(projectName || ''),
            title:             escapeHtml(ciTitle || ''),
            instruction_type:  escapeHtml(ciType || ''),
            issue_date:        escapeHtml(issueDate || ''),
            description:       escapeHtml(description || ''),
            attachments_note:  attachmentsNote,
            url:               `${APP_URL}/projects/${projectId}`,
            sender_name:       escapeHtml(senderName),
          };

          let subject = template.subject || '';
          let bodyHtml = template.body_html || template.body || '';
          for (const [key, val] of Object.entries(vars)) {
            const re = new RegExp(`\\{${key}\\}`, 'g');
            subject = subject.replace(re, val ?? '');
            bodyHtml = bodyHtml.replace(re, val ?? '');
          }

          const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="background:${brandColour};height:4px;"></td></tr>
<tr><td style="padding:32px 40px;">${logoHtml}<div style="font-size:15px;color:#111827;line-height:1.7;">${bodyHtml}</div>${footerHtml}</td></tr>
<tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></td></tr></table></body></html>`;

          await resend.emails.send({
            from: fromEmail,
            to: r.email,
            subject,
            html,
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
