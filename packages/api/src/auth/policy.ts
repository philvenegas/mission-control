import type { Role } from '@mission-control/contract';

/**
 * Who may do what (DESIGN.md section 5). Every permission is declared here and checked by one
 * middleware; a route cannot be registered without naming one.
 */
export const PERMISSIONS = {
  /** See who you are logged in as. */
  'me:read': ['director', 'mission_lead', 'crew_member'],
  /** Read the organisation and its settings. */
  'org:read': ['director'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  const allowed: readonly Role[] = PERMISSIONS[permission];
  return allowed.includes(role);
}
