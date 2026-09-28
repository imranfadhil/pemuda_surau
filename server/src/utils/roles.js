/**
 * Role-based access control.
 *
 * Roles:
 *   admin   - full access
 *   parent  - manage children + prayer check-in
 *   teacher - prayer check-in + Quran (recitation/memorization) + merits
 *   ajk     - prayer check-in + merits
 *   youth   - basic member (prayer check-in only)
 *
 * Capabilities are the single source of truth for what a role may do. Both the
 * server middleware and the client (via `publicUser.capabilities`) use the same
 * names, so the UI and API stay in sync.
 */

export const ROLES = ['admin', 'parent', 'teacher', 'ajk', 'youth'];

export const ROLE_LABELS = {
  admin: 'Admin',
  parent: 'Parent',
  teacher: 'Teacher',
  ajk: 'AJK / Committee',
  youth: 'Member',
};

export const CAPABILITIES = {
  admin: [
    'manageUsers',
    'managePrograms',
    'manageMerits',
    'manageQuran',
    'manageAttendance',
    'manageDependents',
    'viewMembers',
    'identifyMembers',
    'checkIn',
  ],
  parent: ['manageDependents', 'checkIn'],
  teacher: ['manageQuran', 'manageMerits', 'viewMembers', 'identifyMembers', 'checkIn'],
  ajk: ['manageMerits', 'viewMembers', 'identifyMembers', 'checkIn'],
  // Every member may manage their OWN dependents (children). The dependents
  // routes are scoped to the caller, so this is not a privilege escalation —
  // it just means a newly registered member can add their children without an
  // admin having to promote them to `parent` first.
  youth: ['manageDependents', 'checkIn'],
};

export function capabilitiesFor(role) {
  return CAPABILITIES[role] || CAPABILITIES.youth;
}

export function roleHasCapability(role, capability) {
  return capabilitiesFor(role).includes(capability);
}
