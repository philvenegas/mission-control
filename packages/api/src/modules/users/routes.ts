import type { Route } from '../../http/route.ts';

export const userRoutes: Route[] = [
  // The request pipeline has already established who is acting; this route only reports it.
  { method: 'GET', path: '/v1/me', permission: 'me:read', handler: (c) => c.json(c.var.actingAs) },
];
