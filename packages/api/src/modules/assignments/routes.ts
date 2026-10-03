import { assignCrewSchema, type CrewAssignment, declineAssignmentSchema, type Mission } from '@mission-control/contract';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { assignByHand, clearProposals, listOwnAssignments, releaseAssignment, respondToAssignment } from './service.ts';

export const assignmentRoutes: Route[] = [
  {
    method: 'POST',
    path: '/v1/missions/:ref/assignments',
    permission: 'missions:assign-crew',
    handler: async (c) => c.json<Mission>(await assignByHand(c.var.tenant, pathParam(c, 'ref'), await readBody(c, assignCrewSchema)), 201),
  },
  {
    method: 'DELETE',
    path: '/v1/missions/:ref/assignments',
    permission: 'missions:assign-crew',
    handler: async (c) => c.json<Mission>(await clearProposals(c.var.tenant, pathParam(c, 'ref'))),
  },
  {
    method: 'DELETE',
    path: '/v1/assignments/:ref',
    permission: 'missions:assign-crew',
    handler: async (c) => c.json<Mission>(await releaseAssignment(c.var.tenant, pathParam(c, 'ref'))),
  },
  {
    method: 'GET',
    path: '/v1/assignments',
    permission: 'assignments:read',
    handler: async (c) => c.json<CrewAssignment[]>(await listOwnAssignments(c.var.tenant)),
  },
  {
    method: 'POST',
    path: '/v1/assignments/:ref/accept',
    permission: 'assignments:respond',
    handler: async (c) => c.json<CrewAssignment>(await respondToAssignment(c.var.tenant, pathParam(c, 'ref'), { to: 'accepted' })),
  },
  {
    method: 'POST',
    path: '/v1/assignments/:ref/decline',
    permission: 'assignments:respond',
    handler: async (c) => {
      const { reason } = await readBody(c, declineAssignmentSchema);
      return c.json<CrewAssignment>(await respondToAssignment(c.var.tenant, pathParam(c, 'ref'), { to: 'declined', reason: reason ?? null }));
    },
  },
];
