/**
 * userStatus.js
 * Single source of truth for user lifecycle checks in ConstructIQ.
 * All components and functions should use these helpers.
 *
 * Three states:
 *   Active      — user.disabled is falsy
 *   Deactivated — user.disabled === true
 *   Reactivated — previously deactivated, now active (disabled set back to false)
 */

/**
 * Returns true if the user is allowed to access the system.
 * @param {object|null} user - User record from base44.entities.User or base44.auth.me()
 */
export function isUserActive(user) {
  if (!user) return false;
  return user.disabled !== true;
}

/**
 * Returns true if the user is deactivated.
 * @param {object|null} user
 */
export function isUserDeactivated(user) {
  if (!user) return false;
  return user.disabled === true;
}

/**
 * Filters an array of user objects to only active users.
 * Safe to call with null/undefined — returns [].
 * @param {Array} users
 */
export function filterActiveUsers(users) {
  if (!Array.isArray(users)) return [];
  return users.filter(u => isUserActive(u));
}