/**
 * Centralized permissions engine for ConstructIQ.
 * Add new roles or module rules here — no need to touch individual pages.
 */

// Role hierarchy:
// admin    – full access to everything
// pricing  – tenders + all project modules + subcontractors, no admin settings
// internal – project modules (assigned only), no tenders
// external – read-only access to assigned project modules
// (any other) – treated as external

const MODULE_RULES = {
  dashboard: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:    ['admin', 'pricing', 'internal'],
    delete:  ['admin'],
    manage:  ['admin'],
  },
  // Projects: internal=RW Assigned, external=R Assigned, pricing=RW All, admin=RW All
  projects: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing', 'internal'],
  },
  // Gantt/Programme: internal=RW Assigned, external=R Assigned, pricing=RW All, admin=RW All
  programme: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing', 'internal'],
  },
  // Documents: internal=RW Assigned, external=R Assigned, pricing=RW All, admin=RW All
  documents: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing', 'internal'],
  },
  // RFIs follow same pattern as documents
  rfis: {
    access:  ['admin', 'pricing', 'internal', 'external'],
    create:  ['admin', 'pricing', 'internal'],
    respond: ['admin', 'pricing', 'internal', 'external'],
    edit:    ['admin', 'pricing', 'internal'],
    delete:  ['admin', 'pricing'],
    manage:  ['admin', 'pricing', 'internal'],
  },
  // Tenders: internal=No Access, external=No Access, pricing=RW All, admin=RW All
  tenders: {
    access: ['admin', 'pricing'],
    edit:   ['admin', 'pricing'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing'],
  },
  // Subcontractors: internal=No Access, external=No Access, pricing=RW All, admin=RW All
  subcontractors: {
    access: ['admin', 'pricing'],
    edit:   ['admin', 'pricing'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing'],
  },
  // Settings: all roles see Profile + Notifications; pricing also sees Subcontractors; admin sees everything
  settings: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal', 'external'],
    delete: ['admin'],
    manage: ['admin'],
  },
  team: {
    access: ['admin', 'pricing', 'internal'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing'],
  },
  users: {
    access: ['admin'],
    edit:   ['admin'],
    delete: ['admin'],
    manage: ['admin'],
  },
};

function getRole(user) {
  return user?.role || 'external';
}

function check(user, module, action) {
  const rules = MODULE_RULES[module];
  if (!rules) return false;
  const allowed = rules[action] || [];
  return allowed.includes(getRole(user));
}

export function canAccess(user, module) {
  return check(user, module, 'access');
}

export function canEdit(user, module) {
  return check(user, module, 'edit');
}

export function canDelete(user, module) {
  return check(user, module, 'delete');
}

export function canManage(user, module) {
  return check(user, module, 'manage');
}

export function canCreate(user, module) {
  return check(user, module, 'create');
}

// Convenience helpers used throughout the app
export function isAdmin(user) {
  return getRole(user) === 'admin';
}

export function isPricing(user) {
  return getRole(user) === 'pricing';
}

export function isAdminOrPricing(user) {
  return isAdmin(user) || isPricing(user);
}