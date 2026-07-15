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
{quote_context}
<p>Please log in to view your project details and get started.</p>
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
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br><strong>{sender_name}</strong><br>{sender_email}<br>{company_name}</p>`,
  },
  tender_question_posted: {
    name: 'Tender Question — Admin Notification',
    subject: 'New Tender Question — {tender_number}: {title}',
    body_html: `
<p>Hi,</p>
<p><strong>{invitee_name}</strong> ({invitee_email}) has submitted a question on tender <strong>{tender_number}: {title}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Subject</td><td style="padding:6px 0;font-weight:500;">{question_subject}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">From</td><td style="padding:6px 0;">{invitee_name} — {invitee_company}</td></tr>
</table>
<p style="color:#374151;"><strong>Question:</strong><br>{question_description}</p>
<p style="margin-top:24px;">
  <a href="{admin_url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View &amp; Respond</a>
</p>`,
  },
  tender_question_answered: {
    name: 'Tender Question — Answer Notification',
    subject: 'Your question on {tender_number} has been answered',
    body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>Your question on tender <strong>{tender_number}: {title}</strong> has been answered.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Question</td><td style="padding:6px 0;font-weight:500;">{question_subject}</td></tr>
</table>
<p style="color:#374151;"><strong>Answer:</strong><br>{answer_text}</p>
<p style="margin-top:24px;">
  <a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View on Tender Portal</a>
</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br><strong>{sender_name}</strong><br>{sender_email}<br>{company_name}</p>`,
  },
  tender_notice_issued: {
    name: 'Notice to Tenderers Issued',
    subject: '{title} — {notice_number} Issued',
    body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>A new Notice to Tenderers has been issued for <strong>{title}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:6px;font-size:14px;">
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:120px;">Notice</td><td style="padding:10px 14px;font-weight:600;">{notice_number}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Type</td><td style="padding:10px 14px;">{notice_type}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;">Issued</td><td style="padding:10px 14px;">{issue_date}</td></tr>
</table>
<p style="color:#374151;">Please review the tender portal for full details and any attached documents.</p>
<p style="margin-top:24px;">
  <a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Tender Portal</a>
</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{company_name}</p>`,
  },
  tender_reminder_external: {
    name: 'Tender Closing Reminder — Subcontractor',
    subject: 'Reminder: {tender_number} — {title} closes in {days_remaining} day(s)',
    body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>This is a reminder that the tender for <strong>{title}</strong> is closing soon.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:6px;font-size:14px;">
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:160px;">Tender Number</td><td style="padding:10px 14px;font-weight:600;">{tender_number}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Project</td><td style="padding:10px 14px;font-weight:500;">{title}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Location</td><td style="padding:10px 14px;">{location}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;">Closing Date</td><td style="padding:10px 14px;font-weight:600;color:#dc2626;">{closing_date}</td></tr>
</table>
<p style="color:#374151;">Please ensure your pricing submission is completed before the closing date.</p>
<p style="margin-top:24px;">
  <a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Submit Pricing Now</a>
</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
  },
  tender_reminder_internal: {
    name: 'Tender Closing Reminder — Internal',
    subject: 'Reminder: {tender_number} — {title} closes in {days_remaining} day(s)',
    body_html: `
<p>Hi,</p>
<p>This is an internal reminder that tender <strong>{tender_number}: {title}</strong> is closing soon.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:6px;font-size:14px;">
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:160px;">Tender Number</td><td style="padding:10px 14px;font-weight:600;">{tender_number}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Project</td><td style="padding:10px 14px;font-weight:500;">{title}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Closing Date</td><td style="padding:10px 14px;font-weight:600;color:#dc2626;">{closing_date}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;">Submissions So Far</td><td style="padding:10px 14px;">{submission_count}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;">Invitees</td><td style="padding:10px 14px;">{invitee_count}</td></tr>
</table>
<p style="margin-top:24px;">
  <a href="{admin_url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Tender</a>
</p>`,
  },
  rfi_reminder: {
    name: 'RFI Questions Deadline Reminder',
    subject: 'Reminder: Questions close in {days_remaining} day(s) — {tender_number}: {title}',
    body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>This is a reminder that the deadline to submit questions for tender <strong>{tender_number}: {title}</strong> is approaching.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:6px;font-size:14px;">
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:160px;">Tender Number</td><td style="padding:10px 14px;font-weight:600;">{tender_number}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Project</td><td style="padding:10px 14px;font-weight:500;">{title}</td></tr>
  <tr><td style="padding:10px 14px;color:#6b7280;">Questions Deadline</td><td style="padding:10px 14px;font-weight:600;color:#dc2626;">{questions_date}</td></tr>
</table>
<p style="color:#374151;">Please submit any questions before the deadline to allow sufficient time for responses.</p>
<p style="margin-top:24px;">
  <a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Submit a Question</a>
</p>
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
  contract_instruction: {
    name: 'Contract Instruction Issued',
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
  },
  subcontractor_invite: {
    name: 'Subcontractor Invite',
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
  },
  subcontractor_invite_quote: {
    name: 'Subcontractor Invite — Quote Accepted',
    subject: "You've been appointed to {project_name} — Quote {quote_number} Accepted",
    body_html: `
<p>Hi <strong>{name}</strong>,</p>
<p><strong>{invited_by}</strong> has appointed you as a subcontractor on <strong>{project_name}</strong>, following acceptance of your quote <strong>{quote_number}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Project</td><td style="padding:6px 0;font-weight:500;">{project_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Company</td><td style="padding:6px 0;">{business_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Trade</td><td style="padding:6px 0;">{trade}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Accepted Quote</td><td style="padding:6px 0;font-weight:500;">{quote_number}</td></tr>
</table>
<p>Create your account to access the project details.</p>
<p style="margin-top:24px;">
  <a href="{invite_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">
    Accept Invitation &amp; Register
  </a>
</p>
<p style="font-size:13px;color:#6b7280;margin-top:8px;">
  If you did not expect this invitation, you can safely ignore this email.
</p>`,
  },
  team_added_quote: {
    name: 'Added to Project — Quote Accepted',
    subject: "You've been added to {project_name} — Quote {quote_number} Accepted",
    body_html: `
<p>Hi <strong>{name}</strong>,</p>
<p>You have been added to the project <strong>{project_name}</strong> as <strong>{role}</strong>, following acceptance of your quote <strong>{quote_number}</strong>.</p>
<p>Please log in to view your project details and get started.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Best regards,<br>ConstructIQ</p>`,
  },
  programme_published: {
    name: 'Programme Update Notification',
    subject: 'Programme Updated — {project_name}',
    body_html: `<p>Hi,</p>
<p>The construction programme for <strong>{project_name}</strong> has been updated by {sender_name}.</p>
<p>Please refer to the latest schedule for current dates, and let us know if you have any questions.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
  },
  user_invite: {
    name: 'User Invite to ConstructIQ',
    subject: "You've been invited to ConstructIQ",
    body_html: `
<p>Hi <strong>{name}</strong>,</p>
<p>You have been invited to join <strong>ConstructIQ</strong> by <strong>{invited_by}</strong>.</p>
{project_context}
{quote_context}
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
    { key: 'quote_context', desc: 'Optional accepted-quote paragraph (subcontractors added with a quote ref)' },
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
    { key: 'sender_name', desc: 'Name of the THS employee issuing the invitation' },
    { key: 'sender_email', desc: 'Email of the THS employee issuing the invitation' },
  ],
  tender_question_posted: [
    { key: 'invitee_name', desc: 'Subcontractor name' },
    { key: 'invitee_email', desc: 'Subcontractor email' },
    { key: 'invitee_company', desc: 'Subcontractor company' },
    { key: 'tender_number', desc: 'Tender reference' },
    { key: 'title', desc: 'Tender title' },
    { key: 'question_subject', desc: 'Subject of the question' },
    { key: 'question_description', desc: 'Body of the question' },
    { key: 'admin_url', desc: 'Link to Questions tab in TenderDetail' },
  ],
  tender_question_answered: [
    { key: 'invitee_name', desc: 'Subcontractor name' },
    { key: 'tender_number', desc: 'Tender reference' },
    { key: 'title', desc: 'Tender title' },
    { key: 'question_subject', desc: 'Subject of the question' },
    { key: 'answer_text', desc: 'The answer text' },
    { key: 'submission_link', desc: 'Link to portal Questions tab' },
    { key: 'sender_name', desc: 'Name of THS employee who answered' },
    { key: 'sender_email', desc: 'Email of THS employee who answered' },
    { key: 'company_name', desc: 'Company name' },
  ],
  tender_notice_issued: [
    { key: 'invitee_name', desc: 'Subcontractor/invitee name' },
    { key: 'title', desc: 'Tender/project title' },
    { key: 'notice_number', desc: 'Notice reference e.g. NTT-001' },
    { key: 'notice_type', desc: 'Type of notice' },
    { key: 'issue_date', desc: 'Date notice was issued' },
    { key: 'submission_link', desc: 'Link to tender portal' },
    { key: 'company_name', desc: 'Company name' },
  ],
  tender_reminder_external: [
    { key: 'invitee_name', desc: 'Subcontractor name' },
    { key: 'tender_number', desc: 'Tender reference' },
    { key: 'title', desc: 'Tender title' },
    { key: 'location', desc: 'Project location' },
    { key: 'closing_date', desc: 'Tender closing date' },
    { key: 'days_remaining', desc: 'Days until closing' },
    { key: 'submission_link', desc: 'Link to submit pricing' },
    { key: 'sender_name', desc: 'Your name' },
    { key: 'company_name', desc: 'Your company name' },
  ],
  tender_reminder_internal: [
    { key: 'tender_number', desc: 'Tender reference' },
    { key: 'title', desc: 'Tender title' },
    { key: 'closing_date', desc: 'Tender closing date' },
    { key: 'days_remaining', desc: 'Days until closing' },
    { key: 'submission_count', desc: 'Number of submissions received so far' },
    { key: 'invitee_count', desc: 'Total number of invitees' },
    { key: 'admin_url', desc: 'Link to tender in admin panel' },
  ],
  rfi_reminder: [
    { key: 'invitee_name', desc: 'Subcontractor name' },
    { key: 'tender_number', desc: 'Tender reference' },
    { key: 'title', desc: 'Tender title' },
    { key: 'questions_date', desc: 'Questions deadline date' },
    { key: 'days_remaining', desc: 'Days until questions deadline' },
    { key: 'submission_link', desc: 'Link to tender portal' },
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
  contract_instruction: [
    { key: 'recipient_name', desc: 'Recipient name' },
    { key: 'ci_number', desc: 'CI reference e.g. CI-001' },
    { key: 'project_name', desc: 'Project name' },
    { key: 'title', desc: 'CI title' },
    { key: 'instruction_type', desc: 'Type of instruction' },
    { key: 'issue_date', desc: 'Date issued' },
    { key: 'description', desc: 'CI description' },
    { key: 'attachments_note', desc: 'Optional paragraph about attachments' },
    { key: 'url', desc: 'Link to the project' },
    { key: 'sender_name', desc: 'Name of the person issuing' },
  ],
  subcontractor_invite: [
    { key: 'name', desc: 'Subcontractor name (or email if no name)' },
    { key: 'business_name', desc: 'Subcontractor business/company name' },
    { key: 'trade', desc: 'Subcontractor trade' },
    { key: 'project_name', desc: 'Project name' },
    { key: 'invited_by', desc: 'Name of the person sending the invite' },
    { key: 'quote_number', desc: 'Accepted quote reference e.g. Q-1042 (empty if none entered)' },
    { key: 'quote_context', desc: 'Optional accepted-quote paragraph (only when a quote ref was entered)' },
    { key: 'invite_link', desc: 'Registration link' },
  ],
  subcontractor_invite_quote: [
    { key: 'name', desc: 'Subcontractor name (or email if no name)' },
    { key: 'business_name', desc: 'Subcontractor business/company name' },
    { key: 'trade', desc: 'Subcontractor trade' },
    { key: 'project_name', desc: 'Project name' },
    { key: 'invited_by', desc: 'Name of the person sending the invite' },
    { key: 'quote_number', desc: 'Accepted quote reference e.g. Q-1042' },
    { key: 'invite_link', desc: 'Registration link' },
  ],
  team_added_quote: [
    { key: 'name', desc: 'Team member name' },
    { key: 'project_name', desc: 'Project name' },
    { key: 'role', desc: 'Their role on the project' },
    { key: 'quote_number', desc: 'Accepted quote reference e.g. Q-1042' },
  ],
  programme_published: [
    { key: 'project_name', desc: 'Project name' },
    { key: 'sender_name', desc: 'Name of the person who published the programme' },
    { key: 'company_name', desc: 'Your company name' },
  ],
  user_invite: [
    { key: 'name', desc: 'Invitee full name or email' },
    { key: 'invited_by', desc: 'Name of the person sending the invite' },
    { key: 'project_context', desc: 'Optional project name paragraph' },
    { key: 'quote_context', desc: 'Optional accepted-quote paragraph (subcontractors added with a quote ref)' },
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