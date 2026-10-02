import type { OrgResponse } from '@mission-control/contract';
import type { Route } from '../../http/route.ts';
import { getOrganisation } from './repository.ts';

export const orgRoutes: Route[] = [
  {
    method: 'GET',
    path: '/v1/org',
    permission: 'org:read',
    handler: async (c) => c.json<OrgResponse>(await getOrganisation(c.var.tenant)),
  },
];
