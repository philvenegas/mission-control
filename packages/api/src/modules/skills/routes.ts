import type { Skill } from '@mission-control/contract';
import type { Route } from '../../http/route.ts';
import { listSkills } from './repository.ts';

export const skillRoutes: Route[] = [
  {
    method: 'GET',
    path: '/v1/skills',
    permission: 'skills:read',
    handler: async (c) => c.json<Skill[]>(await listSkills(c.var.tenant)),
  },
];
