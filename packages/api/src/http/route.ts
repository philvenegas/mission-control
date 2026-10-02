import type { MeResponse } from '@mission-control/contract';
import type { Handler } from 'hono';
import type { Permission } from '../auth/policy.ts';
import type { TenantContext } from '../db/tenant.ts';

/** What the request pipeline gives every handler. */
export type AppEnv = { Variables: { tenant: TenantContext; actingAs: MeResponse } };

/**
 * A route that acts as a logged-in user. It cannot be declared without the permission it needs,
 * and the pipeline refuses to run a handler that was registered any other way.
 */
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  handler: Handler<AppEnv>;
}

export const routeKey = (route: { method: string; path: string }) => `${route.method} ${route.path}`;
