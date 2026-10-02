import { crewMemberSchema, errorResponseSchema, skillSchema } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../../test/app.ts';

const { app } = useSeededApp();

let dana: Caller; // director
let sam: Caller; // mission lead
let ada: Caller; // crew member, CRW-1
let ines: Caller; // Helios Labs director

beforeAll(async () => {
  [dana, sam, ada, ines] = await Promise.all([
    loginAs(app, 'artemis', 'dana@artemis.example'),
    loginAs(app, 'artemis', 'sam@artemis.example'),
    loginAs(app, 'artemis', 'ada@artemis.example'),
    loginAs(app, 'helios', 'ines@helios.example'),
  ]);
});

const crewList = async (caller: Caller) => bodyOf(await caller.get('/v1/crew'), z.array(crewMemberSchema));
const crewMember = async (response: Response) => bodyOf(response, crewMemberSchema);
const error = async (response: Response) => ({ status: response.status, ...(await bodyOf(response, errorResponseSchema)).error });

describe('the skill taxonomy', () => {
  it('lists the organisation\'s own skills, by name, to every role', async () => {
    for (const caller of [dana, sam, ada]) {
      expect(await bodyOf(await caller.get('/v1/skills'), z.array(skillSchema))).toEqual([
        { name: 'comms', category: 'operations' },
        { name: 'engineer', category: 'engineering' },
        { name: 'geologist', category: 'science' },
        { name: 'medic', category: 'medical' },
        { name: 'navigator', category: 'flight' },
        { name: 'pilot', category: 'flight' },
      ]);
    }
    expect((await bodyOf(await ines.get('/v1/skills'), z.array(skillSchema))).map((skill) => skill.name)).toEqual([
      'EVA',
      'field medicine',
      'flight operations',
      'robotics',
      'spectroscopy',
    ]);
  });
});

describe('reading crew', () => {
  it('lists every crew member, by reference, to a director and a mission lead', async () => {
    const expected = Array.from({ length: 12 }, (_, index) => `CRW-${index + 1}`);
    expect((await crewList(dana)).map((member) => member.ref)).toEqual(expected);
    expect((await crewList(sam)).map((member) => member.ref)).toEqual(expected);
  });

  it('shows a crew member with their skills, levels and certifications', async () => {
    expect(await crewMember(await sam.get('/v1/crew/CRW-4'))).toEqual({
      ref: 'CRW-4',
      name: 'Noor Haddad',
      status: 'active',
      user_email: null,
      skills: [
        { skill: 'engineer', level: 5, certified_until: null },
        { skill: 'medic', level: 3, certified_until: '2027-03-10' },
      ],
    });
  });

  it('lets a crew member see their own record, as CRW-n or as me, and no one else\'s', async () => {
    expect((await crewList(ada)).map((member) => member.ref)).toEqual(['CRW-1']);
    const own = await crewMember(await ada.get('/v1/crew/me'));
    expect(own).toMatchObject({ ref: 'CRW-1', name: 'Ada Reyes', user_email: 'ada@artemis.example' });
    expect(await crewMember(await ada.get('/v1/crew/CRW-1'))).toEqual(own);
    expect(await error(await ada.get('/v1/crew/CRW-2'))).toMatchObject({ status: 404, message: 'CRW-2 was not found.' });
  });

  it('answers 404 to me for a user who has no crew record', async () => {
    expect(await error(await dana.get('/v1/crew/me'))).toMatchObject({ status: 404, message: 'Your crew record was not found.' });
  });

  it('answers 404 to a reference that does not exist or is not a crew reference', async () => {
    expect(await error(await dana.get('/v1/crew/CRW-99'))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(await error(await dana.get('/v1/crew/MSN-1'))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('adding a crew member', () => {
  it('lets a director add one, numbered next within their organisation', async () => {
    const response = await dana.post('/v1/crew', { name: 'Zoe Park' });
    expect(response.status).toBe(201);
    expect(await crewMember(response)).toEqual({ ref: 'CRW-13', name: 'Zoe Park', status: 'active', user_email: null, skills: [] });
    // Helios Labs has eight crew; its next is its own ninth, whatever Artemis has.
    expect((await crewMember(await ines.post('/v1/crew', { name: 'Ola Berg' }))).ref).toBe('CRW-9');
  });

  it('refuses a mission lead and a crew member', async () => {
    expect((await sam.post('/v1/crew', { name: 'Zoe Park' })).status).toBe(403);
    expect((await ada.post('/v1/crew', { name: 'Zoe Park' })).status).toBe(403);
  });

  it('refuses a blank name', async () => {
    expect(await error(await dana.post('/v1/crew', { name: ' ' }))).toMatchObject({ status: 400, code: 'INVALID_INPUT' });
  });
});

describe('changing a crew member', () => {
  it('lets a director rename them and make them inactive', async () => {
    expect(await crewMember(await dana.patch('/v1/crew/CRW-11', { name: 'Sven Dahlberg', status: 'inactive' }))).toMatchObject({
      ref: 'CRW-11',
      name: 'Sven Dahlberg',
      status: 'inactive',
    });
  });

  it('lets a crew member rename themselves, but not change whether they are active', async () => {
    expect((await crewMember(await ada.patch('/v1/crew/me', { name: 'Ada Reyes-Okoro' }))).name).toBe('Ada Reyes-Okoro');
    expect(await error(await ada.patch('/v1/crew/me', { status: 'inactive' }))).toMatchObject({
      status: 403,
      message: 'Only a director can make a crew member active or inactive.',
    });
    expect((await crewMember(await ada.get('/v1/crew/me'))).status).toBe('active');
  });

  it('refuses a mission lead, and hides other crew from a crew member', async () => {
    expect((await sam.patch('/v1/crew/CRW-2', { name: 'Ben' })).status).toBe(403);
    expect((await ada.patch('/v1/crew/CRW-2', { name: 'Ben' })).status).toBe(404);
    expect((await crewMember(await dana.get('/v1/crew/CRW-2'))).name).toBe('Ben Osei');
  });
});

describe("setting a crew member's skills", () => {
  it('lets a director add a skill, change its level and certification, and remove it', async () => {
    expect((await crewMember(await dana.put('/v1/crew/CRW-2/skills/medic', { level: 2 }))).skills).toEqual([
      { skill: 'medic', level: 2, certified_until: null },
      { skill: 'pilot', level: 4, certified_until: null },
    ]);
    expect((await crewMember(await dana.put('/v1/crew/CRW-2/skills/medic', { level: 3, certified_until: '2028-01-31' }))).skills[0]).toEqual({
      skill: 'medic',
      level: 3,
      certified_until: '2028-01-31',
    });
    expect((await crewMember(await dana.put('/v1/crew/CRW-2/skills/medic', { level: 3, certified_until: null }))).skills[0]).toEqual({
      skill: 'medic',
      level: 3,
      certified_until: null,
    });
    expect((await crewMember(await dana.delete('/v1/crew/CRW-2/skills/medic'))).skills).toEqual([
      { skill: 'pilot', level: 4, certified_until: null },
    ]);
  });

  it('lets a crew member set their own skills, and no one else\'s', async () => {
    expect((await crewMember(await ada.put('/v1/crew/me/skills/comms', { level: 1 }))).skills.map((skill) => skill.skill)).toContain('comms');
    expect((await ada.put('/v1/crew/CRW-2/skills/comms', { level: 1 })).status).toBe(404);
  });

  it('refuses a mission lead', async () => {
    expect((await sam.put('/v1/crew/CRW-2/skills/comms', { level: 1 })).status).toBe(403);
    expect((await sam.delete('/v1/crew/CRW-2/skills/pilot')).status).toBe(403);
  });

  it('accepts a skill name with a space in it', async () => {
    expect((await crewMember(await ines.put('/v1/crew/CRW-1/skills/field%20medicine', { level: 2 }))).skills).toContainEqual({
      skill: 'field medicine',
      level: 2,
      certified_until: null,
    });
  });

  it('answers 404 to a skill the organisation does not have, and to removing one not held', async () => {
    expect(await error(await dana.put('/v1/crew/CRW-2/skills/chef', { level: 3 }))).toMatchObject({
      status: 404,
      message: 'The skill "chef" was not found.',
    });
    expect(await error(await dana.delete('/v1/crew/CRW-2/skills/geologist'))).toMatchObject({
      status: 404,
      message: "CRW-2's geologist skill was not found.",
    });
  });

  it('refuses a level outside 1 to 5', async () => {
    expect(await error(await dana.put('/v1/crew/CRW-2/skills/medic', { level: 6 }))).toMatchObject({ status: 400, code: 'INVALID_INPUT' });
  });
});
