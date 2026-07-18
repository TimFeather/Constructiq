/**
 * Centralized permissions engine for ConstructIQ.
 * Add new roles or module rules here — no need to touch individual pages.
 *
 * Role hierarchy:
 *  admin    – full access to everything
 *  pricing  – tenders + all project modules + subcontractors, no admin settings
 *  internal – project modules (assigned only), no tenders
 *  external – read-only access to assigned project modules
 *  user     – treated as external (fallback for unactivated accounts)
 */

// ─── Module-level rules (source of truth) ────────────────────────────────────
// Each module lists which roles may perform each action.
// To add a new role: add it to the relevant action arrays below.

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
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing', 'internal'],
  },
  programme: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing', 'internal'],
    import: ['admin', 'pricing', 'internal'],
    export: ['admin', 'pricing', 'internal'],
  },
  documents: {
    access: ['admin', 'pricing', 'internal', 'external'],
    edit:   ['admin', 'pricing', 'internal'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing', 'internal'],
  },
  rfis: {
    access:  ['admin', 'pricing', 'internal', 'external'],
    create:  ['admin', 'pricing', 'internal', 'external'],
    respond: ['admin', 'pricing', 'internal', 'external'],
    edit:    ['admin', 'pricing', 'internal'],
    delete:  ['admin', 'pricing'],
    manage:  ['admin', 'pricing', 'internal'],
  },
  tenders: {
    access: ['admin', 'pricing'],
    edit:   ['admin', 'pricing'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing'],
  },
  subcontractors: {
    access: ['admin', 'pricing'],
    edit:   ['admin', 'pricing'],
    delete: ['admin', 'pricing'],
    manage: ['admin', 'pricing'],
  },
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

// ─── Role definitions (derived from MODULE_RULES) ────────────────────────────
// Used by hasPermission() for simple "can this role touch this module?" checks.
// Populated automatically — do not edit manually.
// To add a future role (estimator, site_manager, client, project_manager etc.):
//   1. Add it to the relevant MODULE_RULES action arrays above.
//   2. It will appear here automatically.

function buildRoleDefinitions() {
  const roles = {};
  for (const [module, actions] of Object.entries(MODULE_RULES)) {
    const allRoles = new Set(Object.values(actions).flat());
    for (const role of allRoles) {
      if (!roles[role]) roles[role] = { permissions: [] };
      if (!roles[role].permissions.includes(module)) {
        roles[role].permissions.push(module);
      }
    }
  }
  return roles;
}

export const ROLE_DEFINITIONS = buildRoleDefinitions();

// ─── Role resolver ────────────────────────────────────────────────────────────
// Falls back through: user.role → user.data.role → 'external'
// Defaults to 'external' (not 'user') to prevent visibility regressions on
// accounts that haven't been through the activation flow yet.

export function getRole(user) {
  return (
    user?.role ||
    user?.data?.role ||
    'external'
  ).toLowerCase().trim();
}

// ─── Permission wrapper ───────────────────────────────────────────────────────
// Simple "does this user have access to this module?" check.
// Admin always returns true. Unknown roles return false.

export function hasPermission(user, permission) {
  const role = getRole(user);
  if (role === 'admin') return true;
  const config = ROLE_DEFINITIONS[role];
  if (!config) return false;
  return config.permissions?.includes(permission) ?? false;
}

// ─── Internal check helper ────────────────────────────────────────────────────

function check(user, module, action) {
  const rules = MODULE_RULES[module];
  if (!rules) return false;
  const allowed = rules[action] || [];
  return allowed.includes(getRole(user));
}

// ─── Existing exports (unchanged) ────────────────────────────────────────────
// All callers throughout the app continue to work without modification.

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

export function canImport(user, module) {
  return check(user, module, 'import');
}

export function canExport(user, module) {
  return check(user, module, 'export');
}

export function isAdmin(user) {
  return getRole(user) === 'admin';
}

export function isPricing(user) {
  return getRole(user) === 'pricing';
}

export function isAdminOrPricing(user) {
  return isAdmin(user) || isPricing(user);
}