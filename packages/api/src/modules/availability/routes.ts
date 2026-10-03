import { type AvailabilityBlock, createAvailabilityBlockSchema } from '@mission-control/contract';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { addAvailabilityBlock, listAvailability, removeAvailabilityBlock } from './service.ts';

export const availabilityRoutes: Route[] = [
  {
    method: 'GET',
    path: '/v1/crew/:ref/availability',
    permission: 'crew:read',
    handler: async (context) => context.json<AvailabilityBlock[]>(await listAvailability(context.var.tenant, pathParam(context, 'ref'))),
  },
  {
    method: 'POST',
    path: '/v1/crew/:ref/availability',
    permission: 'availability:manage',
    handler: async (context) =>
      context.json<AvailabilityBlock>(
        await addAvailabilityBlock(context.var.tenant, pathParam(context, 'ref'), await readBody(context, createAvailabilityBlockSchema)),
        201,
      ),
  },
  {
    method: 'DELETE',
    path: '/v1/availability/:ref',
    permission: 'availability:manage',
    handler: async (context) => {
      await removeAvailabilityBlock(context.var.tenant, pathParam(context, 'ref'));
      return context.body(null, 204);
    },
  },
];
