/**
 * Centralized permissions engine for ConstructIQ.
 * Add new roles or module rules here — no need to touch individual pages.
 */

// Role hierarchy for reference:
// admin    – full access to everything
// pricing  – tenders + standard modules, no admin settings
// internal – standard project modules (no tenders, no admin settings)
// external – limited read-only access to assigned project modules
// (any other) – treated as external

const MODULE_RULES = {
  dashboard: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:    ['admin', 'pricing', 'internal'],
    delete:  ['admin'],
    manage:  ['admin'],
  },
  projects: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin'],
    manage: ['admin', 'pricing', 'internal'],
  },
  documents: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin', 'internal'],
    manage: ['admin', 'internal'],
  },
  rfis: {
    access:  ['admin', 'pricing', 'internal', 'external'],
    create:  ['admin', 'pricing', 'internal'],
    respond: ['admin', 'pricing', 'internal', 'external'],
    edit:    ['admin', 'internal'],
    delete:  ['admin', 'internal'],
    manage:  ['admin', 'internal'],
  },
  programme: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin', 'internal'],
    manage: ['admin', 'internal'],
  },
  tenders: {
    access: ['admin', 'pricing'],
    edit:   ['admin', 'pricing'],
    delete: ['admin'],
    manage: ['admin', 'pricing'],
  },
  settings: {
    access: ['admin', 'pricing', 'internal', 'external'], // profile tab visible to all
    edit:   ['admin', 'pricing', 'internal', 'external'],
    delete: ['admin'],
    manage: ['admin'], // admin-only sections gated separately
  },
  team: {
    access: ['admin', 'pricing', 'internal'],
    edit:   ['admin', 'internal'],
    delete: ['admin'],
    manage: ['admin'],
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