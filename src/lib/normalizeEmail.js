/**
 * Normalize an email address for consistent identity matching.
 * Trims whitespace and converts to lowercase.
 */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}