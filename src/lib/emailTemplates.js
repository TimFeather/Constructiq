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