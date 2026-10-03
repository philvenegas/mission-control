import { crewMissionSchema, errorResponseSchema, missionEventSchema, missionSchema } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../../test/app.ts';
import { arrangeCrew } from '../../test/arrange.ts';

const { app, owner } = useSeededApp();

let dana: Caller; // director
let sam: Caller; // mission lead
let mina: Caller; // crew member, accepted on Lunar Gateway Resupply (MSN-1), held on Phobos Survey (MSN-3)
let ada: Caller; // crew member, only proposed on drafts
let ines: Caller; // Helios Labs director

beforeAll(async () => {
  [dana, sam, mina, ada, ines] = await Promise.all([
    loginAs(app, 'artemis', 'dana@artemis.example'),
    loginAs(app, 'artemis', 'sam@artemis.example'),
    loginAs(app, 'artemis', 'mina@artemis.example'),
    loginAs(app, 'artemis', 'ada@artemis.example'),
    loginAs(app, 'helios', 'ines@helios.example'),
  ]);
});

const mission = async (response: Response) => bodyOf(response, missionSchema);
const error = async (response: Response) => ({ status: response.status, ...(await bodyOf(response, errorResponseSchema)).error });

const PRIYA = { name: 'Priya Nair', email: 'priya@artemis.example' };

describe('reading missions', () => {
  it('lists every mission of the organisation, by reference, to a director and a mission lead', async () => {
    for (const caller of [dana, sam]) {
      const missions = await bodyOf(await caller.get('/v1/missions'), z.array(missionSchema));
      expect(missions.map(({ ref, name, status }) => [ref, name, status])).toEqual([
        ['MSN-1', 'Lunar Gateway Resupply', 'active'],
        ['MSN-2', 'Mars Relay Repair', 'completed'],
        ['MSN-3', 'Phobos Survey', 'submitted'],
        ['MSN-4', 'Ceres Resupply', 'draft'],
        ['MSN-5', 'Vesta Mapping', 'draft'],
        ['MSN-6', 'Titan Relay', 'draft'],
        ['MSN-7', 'Io Flyby', 'draft'],
      ]);
    }
  });

  it('shows a mission with its period, owner, submitter, requirements and approval progress', async () => {
    expect(await mission(await sam.get('/v1/missions/MSN-3'))).toEqual({
      ref: 'MSN-3',
      name: 'Phobos Survey',
      description: 'Surface survey ahead of the sample-return programme.',
      from: '2027-06-01',
      to: '2027-06-30',
      status: 'submitted',
      owner: PRIYA,
      submitted_by: PRIYA,
      requirements: [{ skill: 'medic', min_level: 3, headcount: 2 }],
      approval: { required: 1, approved_by: [] },
    });
  });

  it('names who has approved the current submission', async () => {
    expect((await mission(await ines.get('/v1/missions/MSN-1'))).approval).toEqual({
      required: 2,
      approved_by: [{ name: 'Ines Varga', email: 'ines@helios.example' }],
    });
  });

  it('shows a crew member only the missions they are offered or accepted on, and only their own slot', async () => {
    const lunarGateway = { ref: 'MSN-1', name: 'Lunar Gateway Resupply', from: '2026-10-15', to: '2027-02-10' };
    const missions = await bodyOf(await mina.get('/v1/missions'), z.array(crewMissionSchema));
    expect(missions).toEqual([{ ...lunarGateway, slot: { assignment: expect.stringMatching(/^ASG-\d+$/), skill: 'medic', status: 'accepted' } }]);
    expect(await bodyOf(await mina.get('/v1/missions/MSN-1'), crewMissionSchema)).toEqual(missions[0]);
    // Held on Phobos Survey, which she cannot see until she is offered a place.
    expect(await error(await mina.get('/v1/missions/MSN-3'))).toMatchObject({ status: 404, message: 'MSN-3 was not found.' });
    expect(await bodyOf(await ada.get('/v1/missions'), z.array(crewMissionSchema))).toEqual([]);
  });

  it('answers 404 to a mission that does not exist, and to text that is not a mission reference', async () => {
    expect(await error(await dana.get('/v1/missions/MSN-99'))).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'MSN-99 was not found.' });
    expect(await error(await dana.get('/v1/missions/CRW-1'))).toMatchObject({ status: 404, message: 'CRW-1 was not found.' });
  });
});

const SAM = { name: 'Sam Okafor', email: 'sam@artemis.example' };
const EUROPA = { name: 'Europa Survey', from: '2027-03-01', to: '2027-03-20' };

describe('creating and changing a mission', () => {
  it('creates a draft with the next reference, owned by the user who made it', async () => {
    const created = await sam.post('/v1/missions', EUROPA);
    expect(created.status).toBe(201);
    expect(await mission(created)).toEqual({
      ref: 'MSN-8',
      ...EUROPA,
      description: '',
      status: 'draft',
      owner: SAM,
      submitted_by: null,
      requirements: [],
      approval: { required: 1, approved_by: [] },
    });
  });

  it('refuses a mission that ends before it starts, and a crew member creating one', async () => {
    expect(await error(await sam.post('/v1/missions', { ...EUROPA, to: '2027-02-01' }))).toMatchObject({
      status: 400,
      message: 'to: A period must end after it starts.',
    });
    expect(await error(await ada.post('/v1/missions', EUROPA))).toMatchObject({ status: 403 });
  });

  it('sets requirements by skill name, one per skill, and removes them', async () => {
    const ref = (await mission(await sam.post('/v1/missions', EUROPA))).ref;
    await sam.put(`/v1/missions/${ref}/requirements/pilot`, { min_level: 3 });
    await sam.put(`/v1/missions/${ref}/requirements/medic`, { min_level: 3, headcount: 2 });
    // Setting a skill again replaces its requirement.
    const changed = await mission(await sam.put(`/v1/missions/${ref}/requirements/medic`, { min_level: 4 }));
    expect(changed.requirements).toEqual([
      { skill: 'medic', min_level: 4, headcount: 1 },
      { skill: 'pilot', min_level: 3, headcount: 1 },
    ]);
    expect((await mission(await sam.delete(`/v1/missions/${ref}/requirements/medic`))).requirements).toEqual([
      { skill: 'pilot', min_level: 3, headcount: 1 },
    ]);
    expect(await error(await sam.delete(`/v1/missions/${ref}/requirements/medic`))).toMatchObject({
      status: 404,
      message: `${ref}'s medic requirement was not found.`,
    });
    expect(await error(await sam.put(`/v1/missions/${ref}/requirements/chef`, { min_level: 3 }))).toMatchObject({
      status: 404,
      message: 'The skill "chef" was not found.',
    });
  });

  it('changes a draft\'s name, description and period', async () => {
    const ref = (await mission(await sam.post('/v1/missions', EUROPA))).ref;
    expect(await mission(await sam.patch(`/v1/missions/${ref}`, { name: 'Europa Deep Survey', description: 'Longer.', from: '2027-03-02', to: '2027-03-25' }))).toMatchObject({
      name: 'Europa Deep Survey',
      description: 'Longer.',
      from: '2027-03-02',
      to: '2027-03-25',
    });
    expect(await error(await sam.patch(`/v1/missions/${ref}`, { from: '2027-03-02' }))).toMatchObject({
      status: 400,
      message: 'to: A new period gives both from and to.',
    });
  });

  it('moves the period of a draft\'s assignments with it, in the same change', async () => {
    // Ceres Resupply proposes Ada and Noor.
    await dana.patch('/v1/missions/MSN-4', { from: '2027-05-04', to: '2027-05-26' });
    const periods = await owner`
      SELECT DISTINCT a.period::text FROM assignments a JOIN missions m ON m.id = a.mission_id
      JOIN organisations o ON o.id = m.org_id WHERE o.slug = 'artemis' AND m.ref = 4`;
    expect(periods).toEqual([{ period: '[2027-05-04,2027-05-26)' }]);
  });

  it('lets a mission lead change only their own drafts, and a director any draft', async () => {
    // Vesta Mapping is Priya's.
    expect(await error(await sam.patch('/v1/missions/MSN-5', { name: 'Taken' }))).toMatchObject({
      status: 403,
      message: "Only MSN-5's owner or a director can change it.",
    });
    expect(await error(await sam.put('/v1/missions/MSN-5/requirements/pilot', { min_level: 1 }))).toMatchObject({ status: 403 });
    expect((await dana.patch('/v1/missions/MSN-5', { description: 'Mapped by Dana.' })).status).toBe(200);
  });

  it('changes nothing once a mission has left draft', async () => {
    for (const [ref, status] of [['MSN-3', 'submitted'], ['MSN-1', 'active'], ['MSN-2', 'completed']]) {
      expect(await error(await dana.patch(`/v1/missions/${ref}`, { name: 'Renamed' }))).toMatchObject({
        status: 409,
        code: 'NOT_DRAFT',
        message: `${ref} is ${status}, so it can no longer be changed.`,
      });
      expect(await error(await dana.put(`/v1/missions/${ref}/requirements/pilot`, { min_level: 1 }))).toMatchObject({ code: 'NOT_DRAFT' });
      expect(await error(await dana.delete(`/v1/missions/${ref}/requirements/medic`))).toMatchObject({ code: 'NOT_DRAFT' });
    }
  });

  it('keeps a requirement while crew are proposed for it, and its headcount at least their number', async () => {
    // Ceres Resupply proposes Ada as pilot.
    expect(await error(await sam.delete('/v1/missions/MSN-4/requirements/pilot'))).toMatchObject({
      status: 409,
      code: 'REQUIREMENT_STAFFED',
      message: 'MSN-4 has 1 crew proposed as pilot.',
    });
    // Titan Relay's two geologist slots, both proposed: Sven Dahl and Tala Moreno.
    await arrangeCrew(owner, 'artemis', 'MSN-6', [
      { crewMember: 'CRW-11', status: 'proposed' },
      { crewMember: 'CRW-12', status: 'proposed' },
    ]);
    expect(await error(await sam.put('/v1/missions/MSN-6/requirements/geologist', { min_level: 4, headcount: 1 }))).toMatchObject({
      status: 409,
      code: 'REQUIREMENT_STAFFED',
      message: 'MSN-6 has 2 crew proposed as geologist, so its headcount cannot go below 2.',
    });
    expect((await sam.put('/v1/missions/MSN-6/requirements/geologist', { min_level: 3, headcount: 2 })).status).toBe(200);
  });
});

const statusOf = async (caller: Caller, ref: string) => (await mission(await caller.get(`/v1/missions/${ref}`))).status;

/** The statuses of a mission's assignments, by crew member's name. */
async function crewStatuses(slug: string, ref: number) {
  const rows = await owner`
    SELECT c.name, a.status FROM assignments a JOIN missions m ON m.id = a.mission_id JOIN crew_members c ON c.id = a.crew_member_id
    JOIN organisations o ON o.id = m.org_id WHERE o.slug = ${slug} AND m.ref = ${ref} ORDER BY c.name`;
  return Object.fromEntries(rows.map((row) => [row.name, row.status]));
}

/** A new draft with one requirement, ready to submit. */
async function readyDraft(caller: Caller, skill: string, period = { from: '2028-03-01', to: '2028-03-10' }) {
  const { ref } = await mission(await caller.post('/v1/missions', { name: `Draft ${skill}`, ...period }));
  await caller.put(`/v1/missions/${ref}/requirements/${encodeURIComponent(skill)}`, { min_level: 1 });
  return ref;
}

const history = async (caller: Caller, ref: string) => bodyOf(await caller.get(`/v1/missions/${ref}/events`), z.array(missionEventSchema));

describe('submitting a mission', () => {
  it('submits a draft, holding its proposed crew, and records who did it', async () => {
    // Ceres Resupply proposes Ada and Noor.
    const submitted = await mission(await sam.post('/v1/missions/MSN-4/submit', {}));
    expect(submitted).toMatchObject({ status: 'submitted', submitted_by: SAM, approval: { required: 1, approved_by: [] } });
    expect(await crewStatuses('artemis', 4)).toEqual({ 'Ada Reyes': 'held', 'Noor Haddad': 'held' });
    expect((await history(dana, 'MSN-4')).at(-1)).toMatchObject({ type: 'submit', from_status: 'draft', to_status: 'submitted', actor: SAM, note: null });
  });

  it('refuses a mission with no requirements, or one that does not start in the future', async () => {
    const { ref: empty } = await mission(await sam.post('/v1/missions', EUROPA));
    expect(await error(await sam.post(`/v1/missions/${empty}/submit`, {}))).toMatchObject({
      status: 409,
      code: 'GUARD_FAILED',
      message: `${empty} cannot be submitted: it has no requirements.`,
    });
    const started = await readyDraft(sam, 'pilot', { from: '2026-09-01', to: '2026-09-10' });
    expect(await error(await sam.post(`/v1/missions/${started}/submit`, {}))).toMatchObject({
      code: 'GUARD_FAILED',
      message: `${started} cannot be submitted: it starts on 2026-09-01, which is not in the future.`,
    });
    expect(await statusOf(sam, started)).toBe('draft');
  });

  it('refuses when too few directors other than the submitter could approve it', async () => {
    await owner`UPDATE organisations SET settings = jsonb_set(settings, '{approvals_required}', '2') WHERE slug = 'artemis'`;
    try {
      const ref = await readyDraft(dana, 'comms');
      expect(await error(await dana.post(`/v1/missions/${ref}/submit`, {}))).toMatchObject({
        message: 'Artemis requires 2 approvals, but only 1 director other than you can approve.',
      });
    } finally {
      await owner`UPDATE organisations SET settings = jsonb_set(settings, '{approvals_required}', '1') WHERE slug = 'artemis'`;
    }
    await owner`UPDATE organisations SET settings = jsonb_set(settings, '{approvals_required}', '3') WHERE slug = 'helios'`;
    try {
      const ref = await readyDraft(ines, 'EVA');
      expect(await error(await ines.post(`/v1/missions/${ref}/submit`, {}))).toMatchObject({
        status: 409,
        code: 'GUARD_FAILED',
        message: 'Helios Labs requires 3 approvals, but only 2 directors other than you can approve.',
      });
      // A mission lead is not a director, so all three directors can approve.
      const farid = await loginAs(app, 'helios', 'farid@helios.example');
      const theirs = await readyDraft(farid, 'EVA');
      expect((await farid.post(`/v1/missions/${theirs}/submit`, {})).status).toBe(200);
    } finally {
      await owner`UPDATE organisations SET settings = jsonb_set(settings, '{approvals_required}', '2') WHERE slug = 'helios'`;
    }
  });

  it('refuses a mission that is not a draft, naming its status', async () => {
    expect(await error(await dana.post('/v1/missions/MSN-2/submit', {}))).toMatchObject({
      status: 409,
      code: 'TRANSITION_NOT_ALLOWED',
      message: 'MSN-2 is completed, so it cannot be submitted.',
    });
  });

  it('lets a mission lead submit only their own missions', async () => {
    expect(await error(await sam.post('/v1/missions/MSN-5/submit', {}))).toMatchObject({
      status: 403,
      message: "Only MSN-5's owner or a director can submit it.",
    });
  });
});

describe('approving and rejecting', () => {
  it('approves a submission that meets the policy, offering its crew their places', async () => {
    // Phobos Survey holds Mina and Quin as medics.
    const approved = await mission(await dana.post('/v1/missions/MSN-3/approve', {}));
    expect(approved).toMatchObject({ status: 'approved', approval: { required: 1, approved_by: [{ name: 'Dana Okoye', email: 'dana@artemis.example' }] } });
    expect(await crewStatuses('artemis', 3)).toEqual({ 'Mina Farouk': 'offered', 'Quin Abara': 'offered' });
    expect((await history(dana, 'MSN-3')).at(-1)).toMatchObject({ type: 'approve', from_status: 'submitted', to_status: 'approved' });
    // Now offered a place, Mina sees the mission.
    expect(await bodyOf(await mina.get('/v1/missions/MSN-3'), crewMissionSchema)).toMatchObject({ slot: { skill: 'medic', status: 'offered' } });
  });

  it('never lets the submitter approve or reject, director or not', async () => {
    const ref = await readyDraft(dana, 'navigator');
    await dana.post(`/v1/missions/${ref}/submit`, {});
    expect(await error(await dana.post(`/v1/missions/${ref}/approve`, {}))).toEqual({
      status: 403,
      code: 'SELF_APPROVAL_FORBIDDEN',
      message: `You submitted ${ref}, so you cannot approve it.`,
      hint: 'Ask another director to approve it.',
    });
    expect(await error(await dana.post(`/v1/missions/${ref}/reject`, { note: 'Not ready.' }))).toMatchObject({
      code: 'SELF_APPROVAL_FORBIDDEN',
      message: `You submitted ${ref}, so you cannot reject it.`,
    });
    // A mission lead cannot approve at all, their own submission included.
    expect(await error(await sam.post('/v1/missions/MSN-4/approve', {}))).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('needs a note to reject, and sends the mission back to draft with its holds dropped', async () => {
    const marcus = await loginAs(app, 'artemis', 'marcus@artemis.example');
    expect(await error(await marcus.post('/v1/missions/MSN-4/reject', {}))).toMatchObject({ status: 400, message: 'note: Invalid input: expected string, received undefined' });
    const rejected = await mission(await marcus.post('/v1/missions/MSN-4/reject', { note: 'Ada is needed elsewhere.' }));
    expect(rejected).toMatchObject({ status: 'draft', approval: { approved_by: [] } });
    expect(await crewStatuses('artemis', 4)).toEqual({ 'Ada Reyes': 'proposed', 'Noor Haddad': 'proposed' });
    expect((await history(sam, 'MSN-4')).at(-1)).toMatchObject({
      type: 'reject',
      from_status: 'submitted',
      to_status: 'draft',
      actor: { name: 'Marcus Hale' },
      note: 'Ada is needed elsewhere.',
    });
  });
});

describe('a submission that needs two approvals', () => {
  let farid: Caller;
  let tomas: Caller;
  let yuki: Caller;
  beforeAll(async () => {
    [farid, tomas, yuki] = await Promise.all([
      loginAs(app, 'helios', 'farid@helios.example'),
      loginAs(app, 'helios', 'tomas@helios.example'),
      loginAs(app, 'helios', 'yuki@helios.example'),
    ]);
  });

  it('stays submitted after one approval, refuses the same director twice, and is approved by a second', async () => {
    const ref = await readyDraft(farid, 'robotics');
    await farid.post(`/v1/missions/${ref}/submit`, {});
    expect(await mission(await ines.post(`/v1/missions/${ref}/approve`, {}))).toMatchObject({
      status: 'submitted',
      approval: { required: 2, approved_by: [{ name: 'Ines Varga' }] },
    });
    expect((await history(farid, ref)).at(-1)).toMatchObject({ type: 'approve', from_status: 'submitted', to_status: 'submitted' });
    expect(await error(await ines.post(`/v1/missions/${ref}/approve`, {}))).toMatchObject({
      status: 409,
      code: 'GUARD_FAILED',
      message: `You have already approved ${ref}.`,
    });
    expect(await mission(await tomas.post(`/v1/missions/${ref}/approve`, {}))).toMatchObject({
      status: 'approved',
      approval: { approved_by: [{ name: 'Ines Varga' }, { name: 'Tomas Brandt' }] },
    });
  });

  it('voids earlier approvals on a rejection, so a resubmission starts from zero', async () => {
    const ref = await readyDraft(farid, 'spectroscopy');
    await farid.post(`/v1/missions/${ref}/submit`, {});
    await ines.post(`/v1/missions/${ref}/approve`, {});
    expect(await mission(await tomas.post(`/v1/missions/${ref}/reject`, { note: 'Too short.' }))).toMatchObject({
      status: 'draft',
      approval: { approved_by: [] },
    });
    expect(await mission(await farid.post(`/v1/missions/${ref}/submit`, {}))).toMatchObject({ status: 'submitted', approval: { approved_by: [] } });
    // Ines's approval of the first submission does not count towards the second.
    expect(await mission(await yuki.post(`/v1/missions/${ref}/approve`, {}))).toMatchObject({
      status: 'submitted',
      approval: { approved_by: [{ name: 'Yuki Mori' }] },
    });
    expect((await ines.post(`/v1/missions/${ref}/approve`, {})).status).toBe(200);
    expect(await statusOf(farid, ref)).toBe('approved');
  });

  it('counts two directors approving at the same moment as two approvals', async () => {
    const ref = await readyDraft(farid, 'EVA', { from: '2028-04-01', to: '2028-04-05' });
    await farid.post(`/v1/missions/${ref}/submit`, {});
    const answers = await Promise.all([ines.post(`/v1/missions/${ref}/approve`, {}), tomas.post(`/v1/missions/${ref}/approve`, {})]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    expect(await statusOf(farid, ref)).toBe('approved');
  });

  it('lets only one of two submits at the same moment succeed', async () => {
    const ref = await readyDraft(farid, 'EVA', { from: '2028-05-01', to: '2028-05-05' });
    const answers = await Promise.all([farid.post(`/v1/missions/${ref}/submit`, {}), farid.post(`/v1/missions/${ref}/submit`, {})]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect((await history(farid, ref)).filter((event) => event.type === 'submit')).toHaveLength(1);
  });
});

describe('launching, completing and cancelling', () => {
  it('refuses to launch until every slot is accepted, then launches', async () => {
    // Phobos Survey was approved above: Mina and Quin are offered, not yet accepted.
    expect(await error(await dana.post('/v1/missions/MSN-3/launch', {}))).toMatchObject({
      status: 409,
      code: 'GUARD_FAILED',
      message: 'MSN-3 cannot be launched until every slot is accepted: medic 0 of 2.',
    });
    // Crew responses arrive in a later step; here they are arranged directly.
    await owner`UPDATE assignments SET status = 'accepted' WHERE status = 'offered' AND mission_id = (
      SELECT m.id FROM missions m JOIN organisations o ON o.id = m.org_id WHERE o.slug = 'artemis' AND m.ref = 3)`;
    expect(await mission(await dana.post('/v1/missions/MSN-3/launch', {}))).toMatchObject({ status: 'active' });
  });

  it('completes an active mission', async () => {
    expect(await mission(await sam.post('/v1/missions/MSN-1/complete', {}))).toMatchObject({ status: 'completed' });
    expect((await history(sam, 'MSN-1')).at(-1)).toMatchObject({ type: 'complete', from_status: 'active', to_status: 'completed', actor: SAM });
  });

  it('cancels with a note, releasing every proposed and live assignment', async () => {
    expect(await error(await dana.post('/v1/missions/MSN-5/cancel', {}))).toMatchObject({ status: 400 });
    // Vesta Mapping proposes Ada and Sven.
    expect(await mission(await dana.post('/v1/missions/MSN-5/cancel', { note: 'Budget moved to Ceres.' }))).toMatchObject({ status: 'cancelled' });
    expect(await crewStatuses('artemis', 5)).toEqual({ 'Ada Reyes': 'released', 'Sven Dahl': 'released' });
    expect(await error(await dana.post('/v1/missions/MSN-5/cancel', { note: 'Again.' }))).toMatchObject({
      code: 'TRANSITION_NOT_ALLOWED',
      message: 'MSN-5 is cancelled, so it cannot be cancelled.',
    });
  });

  it('lets only a director cancel a mission that is under way', async () => {
    // Phobos Survey is Priya's and active; Sam's own active mission would be refused the same way.
    const priya = await loginAs(app, 'artemis', 'priya@artemis.example');
    expect(await error(await priya.post('/v1/missions/MSN-3/cancel', { note: 'Weather.' }))).toMatchObject({
      status: 403,
      message: 'Only a director can cancel MSN-3 now that it is active.',
    });
    expect(await mission(await dana.post('/v1/missions/MSN-3/cancel', { note: 'Weather.' }))).toMatchObject({ status: 'cancelled' });
    expect(await crewStatuses('artemis', 3)).toEqual({ 'Mina Farouk': 'released', 'Quin Abara': 'released' });
  });
});

describe('a mission\'s history', () => {
  it('lists every transition, oldest first, with who made it', async () => {
    const events = await history(dana, 'MSN-2');
    expect(events.map((event) => [event.type, event.from_status, event.to_status, event.actor.name])).toEqual([
      ['submit', 'draft', 'submitted', 'Priya Nair'],
      ['approve', 'submitted', 'approved', 'Marcus Hale'],
      ['launch', 'approved', 'active', 'Priya Nair'],
      ['complete', 'active', 'completed', 'Priya Nair'],
    ]);
  });

  it('is read by a director and the mission\'s owner, not another mission lead nor a crew member', async () => {
    expect((await sam.get('/v1/missions/MSN-4/events')).status).toBe(200);
    expect(await error(await sam.get('/v1/missions/MSN-2/events'))).toMatchObject({
      status: 403,
      message: "Only MSN-2's owner or a director can read its history.",
    });
    expect(await error(await mina.get('/v1/missions/MSN-1/events'))).toMatchObject({ status: 403 });
  });
});
