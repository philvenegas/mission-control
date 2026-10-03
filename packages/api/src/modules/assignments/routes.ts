import { assignCrewSchema, type CrewAssignment, declineAssignmentSchema, type Mission } from '@mission-control/contract';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { assignByHand, clearProposals, listOwnAssignments, releaseAssignment, respondToAssignment } from './service.ts';

export const assignmentRoutes: Route[] = [
  {
    method: 'POST',
    path: '/v1/missions/:ref/assignments',
    permission: 'missions:assign-crew',
    handler: async (context) => context.json<Mission>(await assignByHand(context.var.tenant, pathParam(context, 'ref'), await readBody(context, assignCrewSchema)), 201),
  },
  {
    method: 'DELETE',
    path: '/v1/missions/:ref/assignments',
    permission: 'missions:assign-crew',
    handler: async (context) => context.json<Mission>(await clearProposals(context.var.tenant, pathParam(context, 'ref'))),
  },
  {
    method: 'DELETE',
    path: '/v1/assignments/:ref',
    permission: 'missions:assign-crew',
    handler: async (context) => context.json<Mission>(await releaseAssignment(context.var.tenant, pathParam(context, 'ref'))),
  },
  {
    method: 'GET',
    path: '/v1/assignments',
    permission: 'assignments:read',
    handler: async (context) => context.json<CrewAssignment[]>(await listOwnAssignments(context.var.tenant)),
  },
  {
    method: 'POST',
    path: '/v1/assignments/:ref/accept',
    permission: 'assignments:respond',
    handler: async (context) => context.json<CrewAssignment>(await respondToAssignment(context.var.tenant, pathParam(context, 'ref'), { to: 'accepted' })),
  },
  {
    method: 'POST',
    path: '/v1/assignments/:ref/decline',
    permission: 'assignments:respond',
    handler: async (context) => {
      const { reason } = await readBody(context, declineAssignmentSchema);
      return context.json<CrewAssignment>(await respondToAssignment(context.var.tenant, pathParam(context, 'ref'), { to: 'declined', reason: reason ?? null }));
    },
  },
];
