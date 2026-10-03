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
    handler: async (c) => c.json<Mission[] | CrewMission[]>(await listMissionsFor(c.var.tenant)),
  },
  {
    method: 'POST',
    path: '/v1/missions',
    permission: 'missions:create',
    handler: async (c) => c.json<Mission>(await createMission(c.var.tenant, await readBody(c, createMissionSchema)), 201),
  },
  {
    method: 'GET',
    path: '/v1/missions/:ref',
    permission: 'missions:read',
    handler: async (c) => c.json<Mission | CrewMission>(await showMission(c.var.tenant, pathParam(c, 'ref'))),
  },
  {
    method: 'PATCH',
    path: '/v1/missions/:ref',
    permission: 'missions:edit',
    handler: async (c) => c.json<Mission>(await changeMission(c.var.tenant, pathParam(c, 'ref'), await readBody(c, updateMissionSchema))),
  },
  {
    method: 'GET',
    path: '/v1/missions/:ref/events',
    permission: 'missions:history',
    handler: async (c) => c.json<MissionEvent[]>(await missionHistory(c.var.tenant, pathParam(c, 'ref'))),
  },
  {
    method: 'PUT',
    path: '/v1/missions/:ref/requirements/:skill',
    permission: 'missions:edit',
    handler: async (c) =>
      c.json<Mission>(
        await setRequirement(c.var.tenant, pathParam(c, 'ref'), pathParam(c, 'skill'), await readBody(c, setRequirementSchema)),
      ),
  },
  {
    method: 'DELETE',
    path: '/v1/missions/:ref/requirements/:skill',
    permission: 'missions:edit',
    handler: async (c) => c.json<Mission>(await removeRequirement(c.var.tenant, pathParam(c, 'ref'), pathParam(c, 'skill'))),
  },
];

const transitionRoutes: Route[] = BUILT_TRANSITIONS.map((transition) => ({
  method: 'POST',
  path: `/v1/missions/:ref/${transition}`,
  permission: routePermission(transition),
  handler: async (c) => {
    const { note } = await readBody(c, needsNote(transition) ? noteRequiredSchema : noteOptionalSchema);
    return c.json<Mission>(await makeTransition(c.var.tenant, pathParam(c, 'ref'), transition, note ?? null));
  },
}));

export const missionRoutes: Route[] = [...recordRoutes, ...transitionRoutes];
