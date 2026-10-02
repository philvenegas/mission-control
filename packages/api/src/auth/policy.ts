import type { Role } from '@mission-control/contract';

/**
 * How far a role's permission reaches: every record in the organisation, or only the caller's
 * own (a crew member's own crew record and what hangs off it).
 */
export type Scope = 'all' | 'own';

/**
 * Who may do what (DESIGN.md section 5). Every permission is declared here. The request pipeline
 * checks that the caller's role holds the route's permission (403 if not); a service then applies
 * the scope to the record, and a record outside it answers 404, as if it did not exist.
 */
export const PERMISSIONS = {
  /** See who you are logged in as. */
  'me:read': { director: 'all', mission_lead: 'all', crew_member: 'all' },
  /** Read the organisation and its settings. */
  'org:read': { director: 'all' },
  /** Read the organisation's skill taxonomy. */
  'skills:read': { director: 'all', mission_lead: 'all', crew_member: 'all' },
  /** Read crew members, their skills and their availability. */
  'crew:read': { director: 'all', mission_lead: 'all', crew_member: 'own' },
  /** Add a crew member. */
  'crew:create': { director: 'all' },
  /** Change a crew member's name or skills. */
  'crew:edit': { director: 'all', crew_member: 'own' },
  /** Make a crew member active or inactive. */
  'crew:set-status': { director: 'all' },
  /** Add and remove availability blocks. */
  'availability:manage': { director: 'all', crew_member: 'own' },
} as const satisfies Record<string, Partial<Record<Role, Scope>>>;

export type Permission = keyof typeof PERMISSIONS;

/** How far the role's permission reaches, or undefined when the role does not hold it. */
export function scopeOf(role: Role, permission: Permission): Scope | undefined {
  const scopes: Partial<Record<Role, Scope>> = PERMISSIONS[permission];
  return scopes[role];
}

export function can(role: Role, permission: Permission): boolean {
  return scopeOf(role, permission) !== undefined;
}
