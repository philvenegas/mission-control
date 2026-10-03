import {
  type CrewMember,
  createCrewMemberSchema,
  setCrewSkillSchema,
  updateCrewMemberSchema,
} from '@mission-control/contract';
import { pathParam, readBody } from '../../http/request.ts';
import type { Route } from '../../http/route.ts';
import { addCrewMember, changeCrewMember, listCrew, removeCrewSkill, setCrewSkill, showCrewMember } from './service.ts';

export const crewRoutes: Route[] = [
  {
    method: 'GET',
    path: '/v1/crew',
    permission: 'crew:read',
    handler: async (context) => context.json<CrewMember[]>(await listCrew(context.var.tenant)),
  },
  {
    method: 'POST',
    path: '/v1/crew',
    permission: 'crew:create',
    handler: async (context) => context.json<CrewMember>(await addCrewMember(context.var.tenant, await readBody(context, createCrewMemberSchema)), 201),
  },
  {
    method: 'GET',
    path: '/v1/crew/:ref',
    permission: 'crew:read',
    handler: async (context) => context.json<CrewMember>(await showCrewMember(context.var.tenant, pathParam(context, 'ref'))),
  },
  {
    method: 'PATCH',
    path: '/v1/crew/:ref',
    permission: 'crew:edit',
    handler: async (context) =>
      context.json<CrewMember>(await changeCrewMember(context.var.tenant, pathParam(context, 'ref'), await readBody(context, updateCrewMemberSchema))),
  },
  {
    method: 'PUT',
    path: '/v1/crew/:ref/skills/:skill',
    permission: 'crew:edit',
    handler: async (context) =>
      context.json<CrewMember>(
        await setCrewSkill(context.var.tenant, pathParam(context, 'ref'), pathParam(context, 'skill'), await readBody(context, setCrewSkillSchema)),
      ),
  },
  {
    method: 'DELETE',
    path: '/v1/crew/:ref/skills/:skill',
    permission: 'crew:edit',
    handler: async (context) => context.json<CrewMember>(await removeCrewSkill(context.var.tenant, pathParam(context, 'ref'), pathParam(context, 'skill'))),
  },
];
