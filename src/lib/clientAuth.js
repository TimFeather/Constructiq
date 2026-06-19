/**
 * clearClientAuthState
 *
 * Wipes all client-side auth/session/onboarding/invitation cache WITHOUT
 * deleting any backend user data. Safe to call before registration, on logout,
 * or whenever stale state causes a registration loop in a normal browser.
 */
export function clearClientAuthState() {
  try {
    // Explicit keys used by base44 SDK, this app, and invitation/onboarding flows
    const authKeys = [
      'base44_token',
      'base44_access_token',
      'auth_token',
      'token',
      'access_token',
      'user',
      'onboarding',
      'onboarding_step',
      'pending_email',
      'registration_email',
      'invitation_token',
      'invitation_email',
      'invitation_meta',
      'invite_token',
      'invite_email',
    ];

    authKeys.forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });

    // Full wipe of sessionStorage (tab-scoped, safe to clear entirely)
    sessionStorage.clear();

    // Pattern-based wipe of remaining localStorage artifacts
    [...Object.keys(localStorage)].forEach(key => {
      if (
        key.startsWith('base44') ||
        key.startsWith('auth') ||
        key.startsWith('token') ||
        key.startsWith('onboard') ||
        key.startsWith('invite') ||
        key.startsWith('user_') ||
        key.startsWith('iq_')
      ) {
        localStorage.removeItem(key);
      }
    });

    console.info('AUTH STATE RESET');
  } catch (e) {
    console.warn('[clientAuth] clearClientAuthState error:', e?.message);
  }
}