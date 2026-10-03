import {
  createMissionSchema,
  type CrewMission,
  type Mission,
  type MissionEvent,
  noteOptionalSchema,
  noteRequiredSchema,
  setRequirementSchema,
  updateMissionSchema,
} from '@mission-control/contract';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { BUILT_TRANSITIONS, needsNote, routePermission } from './lifecycle.ts';
import {
  changeMission,
  createMission,
  listMissionsFor,
  makeTransition,
  missionHistory,
  removeRequirement,
  setRequirement,
  showMission,
} from './service.ts';

const recordRoutes: Route[] = [
  {
    method: 'GET',
    path: '/v1/missions',
    permission: 'missions:read',
    handler: async (context) => context.json<Mission[] | CrewMission[]>(await listMissionsFor(context.var.tenant)),
  },
  {
    method: 'POST',
    path: '/v1/missions',
    permission: 'missions:create',
    handler: async (context) => context.json<Mission>(await createMission(context.var.tenant, await readBody(context, createMissionSchema)), 201),
  },
  {
    method: 'GET',
    path: '/v1/missions/:ref',
    permission: 'missions:read',
    handler: async (context) => context.json<Mission | CrewMission>(await showMission(context.var.tenant, pathParam(context, 'ref'))),
  },
  {
    method: 'PATCH',
    path: '/v1/missions/:ref',
    permission: 'missions:edit',
    handler: async (context) => context.json<Mission>(await changeMission(context.var.tenant, pathParam(context, 'ref'), await readBody(context, updateMissionSchema))),
  },
  {
    method: 'GET',
    path: '/v1/missions/:ref/events',
    permission: 'missions:history',
    handler: async (context) => context.json<MissionEvent[]>(await missionHistory(context.var.tenant, pathParam(context, 'ref'))),
  },
  {
    method: 'PUT',
    path: '/v1/missions/:ref/requirements/:skill',
    permission: 'missions:edit',
    handler: async (context) =>
      context.json<Mission>(
        await setRequirement(context.var.tenant, pathParam(context, 'ref'), pathParam(context, 'skill'), await readBody(context, setRequirementSchema)),
      ),
  },
  {
    method: 'DELETE',
    path: '/v1/missions/:ref/requirements/:skill',
    permission: 'missions:edit',
    handler: async (context) => context.json<Mission>(await removeRequirement(context.var.tenant, pathParam(context, 'ref'), pathParam(context, 'skill'))),
  },
];

const transitionRoutes: Route[] = BUILT_TRANSITIONS.map((transition) => ({
  method: 'POST',
  path: `/v1/missions/:ref/${transition}`,
  permission: routePermission(transition),
  handler: async (context) => {
    const { note } = await readBody(context, needsNote(transition) ? noteRequiredSchema : noteOptionalSchema);
    return context.json<Mission>(await makeTransition(context.var.tenant, pathParam(context, 'ref'), transition, note ?? null));
  },
}));

export const missionRoutes: Route[] = [...recordRoutes, ...transitionRoutes];
