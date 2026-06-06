// Default email templates — used as fallback when no custom template is saved
export const DEFAULT_TEMPLATES = {
  rfi_assigned: {
    name: 'RFI Assigned',
    subject: 'New RFI Assigned: {rfi_ref} – {title}',
    body_html: `
<p>Hi <strong>{assignee_name}</strong>,</p>
<p>You have been assigned a new Request for Information.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Project</td><td style="padding:6px 0;font-weight:500;">{project_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">RFI Reference</td><td style="padding:6px 0;font-weight:500;">{rfi_ref}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Title</td><td style="padding:6px 0;font-weight:500;">{title}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Priority</td><td style="padding:6px 0;">{priority}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Due Date</td><td style="padding:6px 0;">{due_date}</td></tr>
</table>
<p style="color:#374151;"><strong>Description:</strong><br>{description}</p>
<p style="margin-top:24px;">
  <a href="{url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View &amp; Respond to RFI</a>
</p>`,
  },
  rfi_response: {
    name: 'RFI Response Notification',
    subject: 'New response on {rfi_ref}: {title}',
    body_html: `
<p>Hi,</p>
<p><strong>{responder_name}</strong> has posted a new response on <strong>{rfi_ref}: {title}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Project</td><td style="padding:6px 0;font-weight:500;">{project_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">RFI Reference</td><td style="padding:6px 0;">{rfi_ref}</td></tr>
</table>
<p style="color:#374151;"><strong>Response:</strong><br><em>"{response_text}"</em></p>
<p style="margin-top:24px;">
  <a href="{url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Full Thread</a>
</p>`,
  },
  team_added: {
    name: 'Added to Project',
    subject: "You've been added to project: {project_name}",
    body_html: `
<p>Hi <strong>{name}</strong>,</p>
<p>You have been added to the project <strong>{project_name}</strong> as <strong>{role}</strong>.</p>
<p>Please log in to view your project details and get started.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Best regards,<br>ConstructIQ</p>`,
  },
  team_invited: {
    name: 'Project Invitation',
    subject: "You're invited to join {project_name} on ConstructIQ",
    body_html: `
<p>Hi,</p>
<p>You have been invited to collaborate on the project <strong>{project_name}</strong> on ConstructIQ.</p>
<p>Please sign up to get started and view your project details.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Best regards,<br>ConstructIQ</p>`,
  },
  tender_invitation: {
    name: 'Tender Invitation',
    subject: 'Tender Invitation — {tender_number}: {title}',
    body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p><strong>{company_name}</strong> invites you to submit a tender for the following project:</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:160px;">Tender Number</td><td style="padding:6px 0;font-weight:500;">{tender_number}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Project</td><td style="padding:6px 0;font-weight:500;">{title}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Location</td><td style="padding:6px 0;">{location}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Closing Date</td><td style="padding:6px 0;font-weight:500;color:#dc2626;">{closing_date}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Trade Package(s)</td><td style="padding:6px 0;">{trade_packages}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Client</td><td style="padding:6px 0;">{client_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Architect</td><td style="padding:6px 0;">{architect_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Project Manager</td><td style="padding:6px 0;">{project_manager_name}</td></tr>
</table>
<p style="color:#374151;"><strong>Scope:</strong><br>{description}</p>
<p style="margin-top:24px;">
  <a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Tender &amp; Submit Pricing</a>
</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
  },
  tender_outcome_unsuccessful: {
    name: 'Tender Outcome — Unsuccessful (We Lost)',
    subject: 'Tender Update — {tender_number}: {title}',
    body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>Thank you for submitting your pricing for <strong>{title}</strong>.</p>
<p>We wish to advise that unfortunately we were unsuccessful in our tender submission for this project.</p>
<p>We appreciate your time and effort in preparing your submission and look forward to working with you on future opportunities.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
  },
  tender_sub_awarded: {
    name: 'Tender Award — Subcontractor Selected',
    subject: 'Tender Award — {tender_number}: {title}',
    body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>We are pleased to advise that following a review of all tender submissions for <strong>{title}</strong>, your submission has been selected.</p>
<p>We will be in touch shortly to discuss next steps and formalise the engagement.</p>
<p>Thank you for your submission and we look forward to working with you.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
  },
  tender_sub_unsuccessful: {
    name: 'Tender Outcome — Subcontractor Not Selected',
    subject: 'Tender Outcome — {tender_number}: {title}',
    body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>Thank you for submitting your pricing for <strong>{title}</strong>.</p>
<p>After careful consideration of all submissions received, we regret to advise that your submission was not selected on this occasion.</p>
<p>We appreciate the time and effort you put into your submission and hope to have the opportunity to work with you in the future.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
  },
  user_invite: {
    name: 'User Invite to ConstructIQ',
    subject: "You've been invited to ConstructIQ",
    body_html: `
<p>Hi <strong>{name}</strong>,</p>
<p>You have been invited to join <strong>ConstructIQ</strong> by <strong>{invited_by}</strong>.</p>
{project_context}
<p style="margin-top:24px;">
  <a href="{invite_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">
    Accept Invitation &amp; Register
  </a>
</p>
<p style="font-size:13px;color:#6b7280;margin-top:8px;">
  If you did not expect this invitation, you can safely ignore this email.
</p>`,
  },
};

export const TEMPLATE_VARIABLES = {
  rfi_assigned: [
    { key: 'assignee_name', desc: 'Name of the person the RFI is assigned to' },
    { key: 'rfi_ref', desc: 'RFI reference number e.g. RFI-001' },
    { key: 'title', desc: 'RFI title' },
    { key: 'project_name', desc: 'Project name' },
    { key: 'priority', desc: 'Priority level' },
    { key: 'due_date', desc: 'Due date' },
    { key: 'description', desc: 'RFI description' },
    { key: 'url', desc: 'Direct link to the RFI' },
  ],
  rfi_response: [
    { key: 'responder_name', desc: 'Name of person who responded' },
    { key: 'rfi_ref', desc: 'RFI reference number' },
    { key: 'title', desc: 'RFI title' },
    { key: 'project_name', desc: 'Project name' },
    { key: 'response_text', desc: 'Text of the response' },
    { key: 'url', desc: 'Direct link to the RFI' },
  ],
  team_added: [
    { key: 'name', desc: 'Team member name' },
    { key: 'project_name', desc: 'Project name' },
    { key: 'role', desc: 'Their role on the project' },
  ],
  team_invited: [
    { key: 'project_name', desc: 'Project name' },
  ],
  tender_invitation: [
    { key: 'invitee_name', desc: 'Subcontractor name' },
    { key: 'company_name', desc: 'Your company name' },
    { key: 'tender_number', desc: 'Tender reference e.g. TDR-001' },
    { key: 'title', desc: 'Tender/project title' },
    { key: 'location', desc: 'Project location' },
    { key: 'closing_date', desc: 'Tender closing date' },
    { key: 'trade_packages', desc: 'Trade packages being priced' },
    { key: 'description', desc: 'Tender description/scope' },
    { key: 'client_name', desc: 'Client name' },
    { key: 'architect_name', desc: 'Architect name' },
    { key: 'project_manager_name', desc: 'Project manager name' },
    { key: 'submission_link', desc: 'Unique link for subcontractor to submit pricing' },
    { key: 'sender_name', desc: 'Your name' },
  ],
  tender_outcome_unsuccessful: [
    { key: 'invitee_name', desc: 'Subcontractor name' },
    { key: 'title', desc: 'Project title' },
    { key: 'tender_number', desc: 'Tender reference' },
    { key: 'sender_name', desc: 'Your name' },
    { key: 'company_name', desc: 'Your company name' },
  ],
  tender_sub_awarded: [
    { key: 'invitee_name', desc: 'Subcontractor name' },
    { key: 'title', desc: 'Project title' },
    { key: 'tender_number', desc: 'Tender reference' },
    { key: 'sender_name', desc: 'Your name' },
    { key: 'company_name', desc: 'Your company name' },
  ],
  tender_sub_unsuccessful: [
    { key: 'invitee_name', desc: 'Subcontractor name' },
    { key: 'title', desc: 'Project title' },
    { key: 'tender_number', desc: 'Tender reference' },
    { key: 'sender_name', desc: 'Your name' },
    { key: 'company_name', desc: 'Your company name' },
  ],
  user_invite: [
    { key: 'name', desc: 'Invitee full name or email' },
    { key: 'invited_by', desc: 'Name of the person sending the invite' },
    { key: 'project_context', desc: 'Optional project name paragraph' },
    { key: 'invite_link', desc: 'Registration link' },
  ],
};

export function applyTemplate(template, vars) {
  let subject = template.subject || '';
  let body = template.body_html || template.body || '';
  Object.entries(vars).forEach(([key, val]) => {
    const re = new RegExp(`\\{${key}\\}`, 'g');
    subject = subject.replace(re, val ?? '');
    body = body.replace(re, val ?? '');
  });
  return { subject, body };
}

export function resolveTemplate(allTemplates = [], key) {
  const found = allTemplates.find(t => t.template_key === key);
  return found || DEFAULT_TEMPLATES[key] || { subject: '', body_html: '' };
}

export function buildEmailHtml(bodyHtml, branding = {}) {
  const {
    logo_url = null,
    logo_width = 160,
    logo_alignment = 'left',
    brand_colour = '#1a56db',
    footer_text = '',
    company_name = '',
  } = branding;

  const alignMap = { left: 'left', center: 'center', right: 'right' };
  const logoAlign = alignMap[logo_alignment] || 'left';

  const logoHtml = logo_url ? `
    <div style="text-align:${logoAlign};margin-bottom:20px;">
      <img src="${logo_url}" alt="${company_name || 'Logo'}" width="${logo_width}"
           style="max-width:100%;height:auto;display:inline-block;" />
    </div>` : '';

  const footerHtml = footer_text ? `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;
                font-size:11px;color:#9ca3af;line-height:1.6;">
      ${footer_text.replace(/\n/g, '<br>')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Email</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;
                      overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr><td style="background:${brand_colour};height:4px;"></td></tr>
          <tr>
            <td style="padding:32px 40px;">
              ${logoHtml}
              <div style="font-size:15px;color:#111827;line-height:1.7;">
                ${bodyHtml}
              </div>
              ${footerHtml}
            </td>
          </tr>
          <tr><td style="background:${brand_colour};height:2px;"></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}