export function isUserActive(user) {
  if (!user) return false;
  return user.disabled !== true;
}

export function isUserDeactivated(user) {
  if (!user) return false;
  return user.disabled === true;
}

export function filterActiveUsers(users) {
  if (!Array.isArray(users)) return [];
  return users.filter(u => isUserActive(u));
}
