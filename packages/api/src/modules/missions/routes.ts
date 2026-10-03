import {
  createMissionSchema,
  type CrewMission,
  type Mission,
  type MissionEvent,
  noteOptionalSchema,
  noteRequiredSchema,
  setRequirementSchema,
  type Transition,
  updateMissionSchema,
} from '@mission-control/contract';
import type { Permission } from '../../auth/policy.ts';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { TRANSITION_TABLE } from './lifecycle.ts';
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

/** The transitions the API offers. `withdraw` is designed, not built. */
const BUILT_TRANSITIONS = ['submit', 'approve', 'reject', 'launch', 'complete', 'cancel'] as const satisfies readonly Transition[];

/** The permission a route for each transition declares: the broadest any row of the table needs for it. */
const ROUTE_PERMISSION = {
  submit: 'missions:submit',
  approve: 'missions:approve',
  reject: 'missions:reject',
  launch: 'missions:launch',
  complete: 'missions:complete',
  cancel: 'missions:cancel',
} as const satisfies Record<(typeof BUILT_TRANSITIONS)[number], Permission>;

const transitionRoutes: Route[] = BUILT_TRANSITIONS.map((transition) => ({
  method: 'POST',
  path: `/v1/missions/:ref/${transition}`,
  permission: ROUTE_PERMISSION[transition],
  handler: async (c) => {
    const needsNote = TRANSITION_TABLE.some((rule) => rule.transition === transition && rule.needsNote);
    const { note } = await readBody(c, needsNote ? noteRequiredSchema : noteOptionalSchema);
    return c.json<Mission>(await makeTransition(c.var.tenant, pathParam(c, 'ref'), transition, note ?? null));
  },
}));

export const missionRoutes: Route[] = [...recordRoutes, ...transitionRoutes];
