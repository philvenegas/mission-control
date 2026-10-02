import { type AvailabilityBlock, createAvailabilityBlockSchema } from '@mission-control/contract';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { addAvailabilityBlock, listAvailability, removeAvailabilityBlock } from './service.ts';

export const availabilityRoutes: Route[] = [
  {
    method: 'GET',
    path: '/v1/crew/:ref/availability',
    permission: 'crew:read',
    handler: async (c) => c.json<AvailabilityBlock[]>(await listAvailability(c.var.tenant, pathParam(c, 'ref'))),
  },
  {
    method: 'POST',
    path: '/v1/crew/:ref/availability',
    permission: 'availability:manage',
    handler: async (c) =>
      c.json<AvailabilityBlock>(
        await addAvailabilityBlock(c.var.tenant, pathParam(c, 'ref'), await readBody(c, createAvailabilityBlockSchema)),
        201,
      ),
  },
  {
    method: 'DELETE',
    path: '/v1/availability/:ref',
    permission: 'availability:manage',
    handler: async (c) => {
      await removeAvailabilityBlock(c.var.tenant, pathParam(c, 'ref'));
      return c.body(null, 204);
    },
  },
];
