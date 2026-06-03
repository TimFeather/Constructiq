// Default email templates — used as fallback when no custom template is saved
export const DEFAULT_TEMPLATES = {
  rfi_assigned: {
    name: 'RFI Assigned',
    subject: 'New RFI Assigned: {rfi_ref} – {title}',
    body: 'Hi {assignee_name},\n\nYou have been assigned a new Request for Information.\n\nProject: {project_name}\n{rfi_ref}: {title}\n\nPriority: {priority}\nDue Date: {due_date}\n\nDescription:\n{description}\n\nView the full RFI and respond here:\n{url}\n\nThank you.',
  },
  rfi_response: {
    name: 'RFI Response Notification',
    subject: 'New response on {rfi_ref}: {title}',
    body: 'Hi,\n\n{responder_name} has posted a new response on {rfi_ref}: {title}.\n\nProject: {project_name}\n\nResponse:\n"{response_text}"\n\nView the full thread here:\n{url}\n\nThank you.',
  },
  team_added: {
    name: 'Added to Project',
    subject: "You've been added to project: {project_name}",
    body: 'Hi {name},\n\nYou have been added to the project "{project_name}" as {role}.\n\nPlease log in to view your project details.\n\nBest regards,\nConstructIQ',
  },
  team_invited: {
    name: 'Project Invitation',
    subject: "You're invited to join {project_name} on ConstructIQ",
    body: 'Hi,\n\nYou have been invited to collaborate on the project "{project_name}" on ConstructIQ.\n\nPlease sign up to get started and view your project.\n\nBest regards,\nConstructIQ',
  },
  tender_invitation: {
    name: 'Tender Invitation',
    subject: 'Tender Invitation — {tender_number}: {title}',
    body: 'Dear {invitee_name},\n\n{company_name} invites you to submit a tender for the following project:\n\nProject: {title}\nLocation: {location}\nClosing Date: {closing_date}\nTrade Package(s): {trade_packages}\n\n{description}\n\nKey Contacts:\nClient: {client_name}\nArchitect: {architect_name}\nProject Manager: {project_manager_name}\n\nTender documents are attached / available for download at the link below:\n{submission_link}\n\nPlease submit your pricing and any supporting documents using the link above before the closing date.\n\nIf you have any questions, please contact us.\n\nRegards,\n{sender_name}\n{company_name}',
  },
  tender_outcome_unsuccessful: {
    name: 'Tender Outcome — Unsuccessful (We Lost)',
    subject: 'Tender Update — {tender_number}: {title}',
    body: 'Dear {invitee_name},\n\nThank you for submitting your pricing for {title}.\n\nWe wish to advise that unfortunately we were unsuccessful in our tender submission for this project.\n\nWe appreciate your time and effort in preparing your submission and look forward to working with you on future opportunities.\n\nRegards,\n{sender_name}\n{company_name}',
  },
  tender_sub_awarded: {
    name: 'Tender Award — Subcontractor Selected',
    subject: 'Tender Award — {tender_number}: {title}',
    body: 'Dear {invitee_name},\n\nWe are pleased to advise that following a review of all tender submissions for {title}, your submission has been selected.\n\nWe will be in touch shortly to discuss next steps and formalise the engagement.\n\nThank you for your submission and we look forward to working with you.\n\nRegards,\n{sender_name}\n{company_name}',
  },
  tender_sub_unsuccessful: {
    name: 'Tender Outcome — Subcontractor Not Selected',
    subject: 'Tender Outcome — {tender_number}: {title}',
    body: 'Dear {invitee_name},\n\nThank you for submitting your pricing for {title}.\n\nAfter careful consideration of all submissions received, we regret to advise that your submission was not selected on this occasion.\n\nWe appreciate the time and effort you put into your submission and hope to have the opportunity to work with you in the future.\n\nRegards,\n{sender_name}\n{company_name}',
  },
};

export function applyTemplate(template, vars) {
  let subject = template.subject || '';
  let body = template.body || '';
  Object.entries(vars).forEach(([key, val]) => {
    const re = new RegExp(`\\{${key}\\}`, 'g');
    subject = subject.replace(re, val ?? '');
    body = body.replace(re, val ?? '');
  });
  // Prepend logo as HTML image tag if provided
  if (template.logo_url) {
    body = `<img src="${template.logo_url}" alt="Logo" style="max-height:60px;margin-bottom:16px;" />\n\n${body}`;
  }
  return { subject, body };
}

export function resolveTemplate(allTemplates = [], key) {
  const found = allTemplates.find(t => t.template_key === key);
  return found || DEFAULT_TEMPLATES[key] || { subject: '', body: '' };
}