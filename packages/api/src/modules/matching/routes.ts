import { applyMatchRunSchema, type MatchRun, type Mission } from '@mission-control/contract';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { applyMatchRun, runMatcher, showMatchRun } from './service.ts';

export const matchingRoutes: Route[] = [
  {
    method: 'POST',
    path: '/v1/missions/:ref/match',
    permission: 'missions:assign-crew',
    handler: async (context) => context.json<MatchRun>(await runMatcher(context.var.tenant, pathParam(context, 'ref')), 201),
  },
  {
    method: 'GET',
    path: '/v1/match-runs/:ref',
    permission: 'missions:assign-crew',
    handler: async (context) => context.json<MatchRun>(await showMatchRun(context.var.tenant, pathParam(context, 'ref'))),
  },
  {
    method: 'POST',
    path: '/v1/match-runs/:ref/apply',
    permission: 'missions:assign-crew',
    handler: async (context) => context.json<Mission>(await applyMatchRun(context.var.tenant, pathParam(context, 'ref'), await readBody(context, applyMatchRunSchema))),
  },
];
