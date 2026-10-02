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
    handler: async (c) => c.json<CrewMember[]>(await listCrew(c.var.tenant)),
  },
  {
    method: 'POST',
    path: '/v1/crew',
    permission: 'crew:create',
    handler: async (c) => c.json<CrewMember>(await addCrewMember(c.var.tenant, await readBody(c, createCrewMemberSchema)), 201),
  },
  {
    method: 'GET',
    path: '/v1/crew/:ref',
    permission: 'crew:read',
    handler: async (c) => c.json<CrewMember>(await showCrewMember(c.var.tenant, pathParam(c, 'ref'))),
  },
  {
    method: 'PATCH',
    path: '/v1/crew/:ref',
    permission: 'crew:edit',
    handler: async (c) =>
      c.json<CrewMember>(await changeCrewMember(c.var.tenant, pathParam(c, 'ref'), await readBody(c, updateCrewMemberSchema))),
  },
  {
    method: 'PUT',
    path: '/v1/crew/:ref/skills/:skill',
    permission: 'crew:edit',
    handler: async (c) =>
      c.json<CrewMember>(
        await setCrewSkill(c.var.tenant, pathParam(c, 'ref'), pathParam(c, 'skill'), await readBody(c, setCrewSkillSchema)),
      ),
  },
  {
    method: 'DELETE',
    path: '/v1/crew/:ref/skills/:skill',
    permission: 'crew:edit',
    handler: async (c) => c.json<CrewMember>(await removeCrewSkill(c.var.tenant, pathParam(c, 'ref'), pathParam(c, 'skill'))),
  },
];
