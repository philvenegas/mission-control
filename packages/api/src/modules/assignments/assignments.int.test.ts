import { matchRunSchema, type Period } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../../test/app.ts';
import { type ArrangedCrew, arrangeMission, weekOf2031 } from '../../test/arrange.ts';
import { crewOf, errorOf as error, missionOf as mission } from '../../test/missions.ts';

const { app, owner } = useSeededApp();

let dana: Caller; // director
let sam: Caller; // mission lead, owns MSN-4, MSN-6 and MSN-7
let priya: Caller; // mission lead, owns MSN-3 and MSN-5
let ada: Caller; // crew member

beforeAll(async () => {
  [dana, sam, priya, ada] = await Promise.all([
    loginAs(app, 'artemis', 'dana@artemis.example'),
    loginAs(app, 'artemis', 'sam@artemis.example'),
    loginAs(app, 'artemis', 'priya@artemis.example'),
    loginAs(app, 'artemis', 'ada@artemis.example'),
  ]);
});

const SAM = { name: 'Sam Okafor', email: 'sam@artemis.example' };
const MARCH = { from: '2027-03-01', to: '2027-03-20' };


/** A new draft of Sam's needing one skill. */
async function draftNeeding(skill: string, minLevel: number, period: Period = MARCH, headcount = 1) {
  const { ref } = await mission(await sam.post('/v1/missions', { name: `Needs ${skill}`, ...period }));
  await sam.put(`/v1/missions/${ref}/requirements/${skill}`, { min_level: minLevel, headcount });
  return ref;
}

let arranged = 0;
/** A mission of Sam's in a status, on its own week of 2031, needing a pilot, optionally with crew in its slot. */
function arrangeOwn(status: 'approved' | 'submitted', crew: ArrangedCrew[] = []) {
  const week = arranged++;
  return arrangeMission(owner, {
    org: 'artemis',
    name: `Assigned ${week}`,
    period: weekOf2031(week),
    status,
    owner: 'sam@artemis.example',
    skill: 'pilot',
    crew,
  });
}

/** The reference of the assignment that puts a crew member on a mission. */
async function assignmentOf(ref: string, crewMember: string) {
  const { requirements } = await mission(await dana.get(`/v1/missions/${ref}`));
  const found = requirements.flatMap(({ crew }) => crew).find((crew) => crew.crew_member.ref === crewMember);
  if (!found) throw new Error(`${crewMember} is not on ${ref}`);
  return found.assignment;
}

describe('assigning crew by hand', () => {
  it('puts a named crew member in an open slot, recording who assigned them and their score', async () => {
    const draft = await draftNeeding('pilot', 3);
    const response = await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-2', skill: 'pilot' });
    expect(response.status).toBe(201);
    const [pilot] = (await mission(response)).requirements;
    expect(pilot?.crew).toEqual([
      {
        assignment: expect.stringMatching(/^ASG-\d+$/),
        crew_member: { ref: 'CRW-2', name: 'Ben Osei' },
        status: 'proposed',
        score: expect.any(Number),
        match_run: null,
        assigned_by: SAM,
        decline_reason: null,
      },
    ]);
  });

  it('gives the score the matcher gives the same crew member for the same slot', async () => {
    const draft = await draftNeeding('pilot', 3);
    const run = await bodyOf(await sam.post(`/v1/missions/${draft}/match`), matchRunSchema);
    const [slot] = run.slots;
    const [pilot] = (await mission(await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: slot?.chosen?.crew_member.ref, skill: 'pilot' }))).requirements;
    expect(pilot?.crew[0]?.score).toBe(slot?.chosen?.score.total);
  });

  it('refuses a crew member who fails a hard constraint, with the reasons the matcher gives, whoever asks', async () => {
    const draft = await draftNeeding('medic', 3);
    const run = await bodyOf(await sam.post(`/v1/missions/${draft}/match`), matchRunSchema);
    // Omar Vance is on a training course from 5 to 12 March.
    expect(run.ruled_out).toContainEqual({
      crew_member: { ref: 'CRW-5', name: 'Omar Vance' },
      skill: 'medic',
      failures: [{ constraint: 'availability', block: { ref: 'AVL-1', from: '2027-03-05', to: '2027-03-12' } }],
    });
    for (const caller of [sam, dana]) {
      expect(await error(await caller.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-5', skill: 'medic' }))).toEqual({
        status: 409,
        code: 'HARD_CONSTRAINT_FAILED',
        message: `Omar Vance CRW-5 cannot be assigned as medic on ${draft}: Omar Vance CRW-5 has availability block AVL-1, 2027-03-05 to 2027-03-12.`,
        hint: 'Nobody can assign against a hard constraint. Change the record that blocks it instead.',
      });
    }
    expect(await error(await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-4', skill: 'medic' }))).toMatchObject({
      message: `Noor Haddad CRW-4 cannot be assigned as medic on ${draft}: Noor Haddad CRW-4's medic certification expires on 2027-03-10, before the mission's last day, 2027-03-19.`,
    });
    expect(await error(await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-2', skill: 'medic' }))).toMatchObject({
      message: `Ben Osei CRW-2 cannot be assigned as medic on ${draft}: Ben Osei CRW-2 does not have medic.`,
    });
    expect(await crewOf(sam, draft)).toEqual([]);
  });

  it('names every constraint that fails, and the mission that holds a crew member', async () => {
    // Quin Abara is held by Phobos Survey in June, and is a medic at level 3 only.
    const draft = await draftNeeding('medic', 4, { from: '2027-06-07', to: '2027-06-15' });
    expect(await error(await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-7', skill: 'medic' }))).toMatchObject({
      message:
        `Quin Abara CRW-7 cannot be assigned as medic on ${draft}: Quin Abara CRW-7 is medic level 3, below the 4 needed; ` +
        'Quin Abara CRW-7 is held on MSN-3 Phobos Survey (submitted, Priya Nair) over the same period.',
    });
  });

  it('refuses an inactive crew member, one already in another slot, and one who declined the mission', async () => {
    const draft = await draftNeeding('pilot', 3, { from: '2027-09-01', to: '2027-09-10' });
    await sam.put(`/v1/missions/${draft}/requirements/medic`, { min_level: 3 });
    await dana.patch('/v1/crew/CRW-6', { status: 'inactive' });
    try {
      expect(await error(await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-6', skill: 'medic' }))).toMatchObject({
        message: `Kira Novak CRW-6 cannot be assigned as medic on ${draft}: Kira Novak CRW-6 is inactive.`,
      });
    } finally {
      await dana.patch('/v1/crew/CRW-6', { status: 'active' });
    }
    await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-1', skill: 'pilot' });
    const asPilot = await assignmentOf(draft, 'CRW-1');
    expect(await error(await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-1', skill: 'medic' }))).toMatchObject({
      message: `Ada Reyes CRW-1 cannot be assigned as medic on ${draft}: Ada Reyes CRW-1 is already in one of ${draft}'s slots (${asPilot}).`,
    });
    // A declined slot is open again, but not to the crew member who declined it.
    const approved = await arrangeOwn('approved', [{ crewMember: 'CRW-2', status: 'declined' }]);
    expect(await error(await sam.post(`/v1/missions/${approved}/assignments`, { crew_member: 'CRW-2', skill: 'pilot' }))).toMatchObject({
      message: `Ben Osei CRW-2 cannot be assigned as pilot on ${approved}: Ben Osei CRW-2 declined ${approved}.`,
    });
  });

  it('refuses a skill the mission does not need, a slot already filled, and records that do not exist', async () => {
    const draft = await draftNeeding('pilot', 3);
    expect(await error(await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-1', skill: 'medic' }))).toMatchObject({
      status: 404,
      message: `${draft}'s medic requirement was not found.`,
    });
    await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-2', skill: 'pilot' });
    expect(await error(await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-1', skill: 'pilot' }))).toMatchObject({
      status: 409,
      code: 'NO_OPEN_SLOT',
      message: `${draft}'s pilot slots are all filled (1 of 1).`,
    });
    expect((await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-99', skill: 'pilot' })).status).toBe(404);
    expect((await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-1', skill: 'chef' })).status).toBe(404);
    expect((await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-1' })).status).toBe(400);
  });

  it('fills an open slot of an approved mission directly as offered', async () => {
    const approved = await arrangeOwn('approved');
    await sam.post(`/v1/missions/${approved}/assignments`, { crew_member: 'CRW-2', skill: 'pilot' });
    expect(await crewOf(sam, approved)).toEqual(['pilot: Ben Osei offered']);
  });

  it('is for the mission\'s owner and directors, while its crew can change', async () => {
    expect(await error(await sam.post('/v1/missions/MSN-5/assignments', { crew_member: 'CRW-2', skill: 'pilot' }))).toMatchObject({
      status: 403,
      message: "Only MSN-5's owner or a director can change its crew.",
    });
    expect((await ada.post('/v1/missions/MSN-7/assignments', { crew_member: 'CRW-2', skill: 'pilot' })).status).toBe(403);
    expect(await error(await priya.post('/v1/missions/MSN-3/assignments', { crew_member: 'CRW-6', skill: 'medic' }))).toMatchObject({
      status: 409,
      code: 'NOT_STAFFABLE',
      message: 'MSN-3 is submitted, so its crew cannot change.',
    });
  });
});

describe('releasing crew', () => {
  it('releases one crew member, which reopens their slot', async () => {
    const draft = await draftNeeding('pilot', 3);
    await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-2', skill: 'pilot' });
    const released = await mission(await sam.delete(`/v1/assignments/${await assignmentOf(draft, 'CRW-2')}`));
    expect(released.requirements[0]?.crew).toEqual([]);
    expect((await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-9', skill: 'pilot' })).status).toBe(201);
    expect(await crewOf(sam, draft)).toEqual(['pilot: Cy Lindqvist proposed']);
  });

  it('lets a mission lead release crew only from their own missions, and a director from any', async () => {
    // Vesta Mapping, Priya's draft, proposes Ada as pilot.
    const proposal = await assignmentOf('MSN-5', 'CRW-1');
    expect(await error(await sam.delete(`/v1/assignments/${proposal}`))).toMatchObject({
      status: 403,
      message: "Only MSN-5's owner or a director can change its crew.",
    });
    expect((await ada.delete(`/v1/assignments/${proposal}`)).status).toBe(403);
    expect((await dana.delete(`/v1/assignments/${proposal}`)).status).toBe(200);
    expect(await crewOf(priya, 'MSN-5')).toEqual(['geologist: Sven Dahl proposed']);
    expect((await dana.delete('/v1/assignments/ASG-999')).status).toBe(404);
  });

  it('keeps a declined assignment, which records that the crew member said no to the mission', async () => {
    const approved = await arrangeOwn('approved', [{ crewMember: 'CRW-2', status: 'declined' }]);
    const declined = await assignmentOf(approved, 'CRW-2');
    expect(await error(await sam.delete(`/v1/assignments/${declined}`))).toMatchObject({
      status: 409,
      code: 'WRONG_ASSIGNMENT_STATUS',
      message: `${declined} is declined, so it cannot be released.`,
    });
  });

  it('releases an offered or accepted crew member from an approved mission, but no one held by a submitted one', async () => {
    const approved = await arrangeOwn('approved', [{ crewMember: 'CRW-2', status: 'accepted' }]);
    await sam.delete(`/v1/assignments/${await assignmentOf(approved, 'CRW-2')}`);
    expect(await crewOf(sam, approved)).toEqual([]);
    const submitted = await arrangeOwn('submitted', [{ crewMember: 'CRW-2', status: 'held' }]);
    expect(await error(await sam.delete(`/v1/assignments/${await assignmentOf(submitted, 'CRW-2')}`))).toMatchObject({
      status: 409,
      code: 'NOT_STAFFABLE',
    });
  });
});

describe('clearing a draft\'s proposals', () => {
  it('releases every crew member a draft proposes', async () => {
    expect(await crewOf(sam, 'MSN-4')).toEqual(['engineer: Noor Haddad proposed', 'pilot: Ada Reyes proposed']);
    expect(await error(await priya.delete('/v1/missions/MSN-4/assignments'))).toMatchObject({ status: 403 });
    const cleared = await mission(await sam.delete('/v1/missions/MSN-4/assignments'));
    expect(cleared.requirements.map(({ skill, crew }) => [skill, crew])).toEqual([
      ['engineer', []],
      ['pilot', []],
    ]);
  });

  it('clears only a draft: an approved mission releases its crew one at a time', async () => {
    const approved = await arrangeOwn('approved', [{ crewMember: 'CRW-2', status: 'offered' }]);
    expect(await error(await sam.delete(`/v1/missions/${approved}/assignments`))).toMatchObject({
      status: 409,
      code: 'NOT_DRAFT',
      message: `${approved} is approved, so it has no proposals to clear.`,
    });
    expect(await crewOf(sam, approved)).toEqual(['pilot: Ben Osei offered']);
  });
});
