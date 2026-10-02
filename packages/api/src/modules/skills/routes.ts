import type { Skill } from '@mission-control/contract';
import type { Route } from '../../http/route.ts';
import { listSkillTaxonomy } from './service.ts';

export const skillRoutes: Route[] = [
  {
    method: 'GET',
    path: '/v1/skills',
    permission: 'skills:read',
    handler: async (c) => c.json<Skill[]>(await listSkillTaxonomy(c.var.tenant)),
  },
];
