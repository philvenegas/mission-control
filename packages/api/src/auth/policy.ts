import type { Role } from '@mission-control/contract';

/**
 * How far a role's permission reaches: every record in the organisation, or only the caller's
 * own. A crew member's own is their crew record and what hangs off it, and the missions they are
 * offered or accepted on; a mission lead's own is the missions they own.
 */
type Scope = 'all' | 'own';

/**
 * Who may do what (DESIGN.md section 5). Every permission is declared here. The request pipeline
 * checks that the caller's role holds the route's permission (403 if not); a service then applies
 * the scope to the record, and a record outside it answers 404, as if it did not exist.
 */
const PERMISSIONS = {
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
  /** Read missions. A crew member reads only those they are offered or accepted on, and only their own slot. */
  'missions:read': { director: 'all', mission_lead: 'all', crew_member: 'own' },
  /** Create a mission, which the user who creates it then owns. */
  'missions:create': { director: 'all', mission_lead: 'all' },
  /** Change a draft: its details, period and requirements. */
  'missions:edit': { director: 'all', mission_lead: 'own' },
  /** Read a mission's history. */
  'missions:history': { director: 'all', mission_lead: 'own' },
  // The transitions (DESIGN.md section 4). The lifecycle table names which each one needs.
  'missions:submit': { director: 'all', mission_lead: 'own' },
  'missions:approve': { director: 'all' },
  'missions:reject': { director: 'all' },
  'missions:launch': { director: 'all', mission_lead: 'own' },
  'missions:complete': { director: 'all', mission_lead: 'own' },
  /** Cancel a mission before it is active. */
  'missions:cancel': { director: 'all', mission_lead: 'own' },
  /** Cancel a mission that is under way. */
  'missions:cancel-active': { director: 'all' },
  /** Run the matcher, see and apply a match run, assign crew by hand, and release them. */
  'missions:assign-crew': { director: 'all', mission_lead: 'own' },
  /** List your own offered and accepted assignments. */
  'assignments:read': { crew_member: 'own' },
  /** Accept or decline your own offered assignment. */
  'assignments:respond': { crew_member: 'own' },
} as const satisfies Record<string, Partial<Record<Role, Scope>>>;

export type Permission = keyof typeof PERMISSIONS;

/** How far the role's permission reaches, or undefined when the role does not hold it. */
export function scopeOf(role: Role, permission: Permission): Scope | undefined {
  const scopes: Partial<Record<Role, Scope>> = PERMISSIONS[permission];
  return scopes[role];
}

/**
 * Whether the caller reaches a record under a permission: every record when their scope is `all`,
 * only a record that is theirs when it is `own`, none when they lack the permission. A service
 * answers 404 for a record the caller does not reach.
 */
export function reaches(caller: { role: Role; userId: string }, permission: Permission, ownerUserId: string | null): boolean {
  const scope = scopeOf(caller.role, permission);
  return scope === 'all' || (scope === 'own' && ownerUserId === caller.userId);
}

export function can(role: Role, permission: Permission): boolean {
  return scopeOf(role, permission) !== undefined;
}
