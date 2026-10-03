import { applyMatchRunSchema, type MatchRun, type Mission } from '@mission-control/contract';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { applyMatchRun, runMatcher, showMatchRun } from './service.ts';

export const matchingRoutes: Route[] = [
  {
    method: 'POST',
    path: '/v1/missions/:ref/match',
    permission: 'missions:assign-crew',
    handler: async (c) => c.json<MatchRun>(await runMatcher(c.var.tenant, pathParam(c, 'ref')), 201),
  },
  {
    method: 'GET',
    path: '/v1/match-runs/:ref',
    permission: 'missions:assign-crew',
    handler: async (c) => c.json<MatchRun>(await showMatchRun(c.var.tenant, pathParam(c, 'ref'))),
  },
  {
    method: 'POST',
    path: '/v1/match-runs/:ref/apply',
    permission: 'missions:assign-crew',
    handler: async (c) => c.json<Mission>(await applyMatchRun(c.var.tenant, pathParam(c, 'ref'), await readBody(c, applyMatchRunSchema))),
  },
];
