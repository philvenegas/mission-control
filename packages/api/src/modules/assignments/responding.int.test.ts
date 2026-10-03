import { crewAssignmentSchema, errorResponseSchema, type MatchRun, matchRunSchema, missionSchema } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../../test/app.ts';

const { app } = useSeededApp();

let dana: Caller; // director
let sam: Caller; // mission lead
let ada: Caller; // crew member: pilot 5, medic 4
let quin: Caller; // crew member: medic 3, held by Phobos Survey in June
let mina: Caller; // crew member: medic 4, back from Lunar Gateway Resupply on 10 February

beforeAll(async () => {
  [dana, sam, ada, quin, mina] = await Promise.all([
    loginAs(app, 'artemis', 'dana@artemis.example'),
    loginAs(app, 'artemis', 'sam@artemis.example'),
    loginAs(app, 'artemis', 'ada@artemis.example'),
    loginAs(app, 'artemis', 'quin@artemis.example'),
    loginAs(app, 'artemis', 'mina@artemis.example'),
  ]);
});

const mission = async (response: Response) => bodyOf(response, missionSchema);
const matchRun = async (response: Response) => bodyOf(response, matchRunSchema);
const ownAssignments = async (caller: Caller) => bodyOf(await caller.get('/v1/assignments'), z.array(crewAssignmentSchema));
const error = async (response: Response) => ({ status: response.status, ...(await bodyOf(response, errorResponseSchema)).error });

const choices = (run: MatchRun) => run.slots.map(({ slot, chosen }) => `${slot.skill} ${slot.number}: ${chosen ? chosen.crew_member.name : 'unfilled'}`);

/** Each slot's crew member, status and decline reason, as `skill: name status`. */
async function crewOf(ref: string) {
  const { requirements } = await mission(await sam.get(`/v1/missions/${ref}`));
  return requirements.flatMap(({ skill, crew }) =>
    crew.map(({ crew_member, status, decline_reason }) => `${skill}: ${crew_member.name} ${status}${decline_reason ? ` (${decline_reason})` : ''}`),
  );
}

/** The reference of the assignment that offers a crew member a place, as they see it. */
async function offerTo(caller: Caller, missionRef: string) {
  const offer = (await ownAssignments(caller)).find((assignment) => assignment.mission.ref === missionRef);
  if (!offer) throw new Error(`No offer on ${missionRef}`);
  return offer.ref;
}

// Act 1 of the walk-through (DESIGN.md section 8): plan to launch, with a decline and a refill.
describe('Europa Survey, from plan to launch', () => {
  let europa: string;
  let quinsOffer: string;

  beforeAll(async () => {
    ({ ref: europa } = await mission(await sam.post('/v1/missions', { name: 'Europa Survey', from: '2027-03-01', to: '2027-03-20' })));
    await sam.put(`/v1/missions/${europa}/requirements/pilot`, { min_level: 3 });
    await sam.put(`/v1/missions/${europa}/requirements/medic`, { min_level: 3 });
    const run = await matchRun(await sam.post(`/v1/missions/${europa}/match`));
    expect(choices(run)).toEqual(['medic 1: Quin Abara', 'pilot 1: Ada Reyes']);
    await sam.post(`/v1/match-runs/${run.ref}/apply`, {});
    await sam.post(`/v1/missions/${europa}/submit`, {});
    await dana.post(`/v1/missions/${europa}/approve`, {});
  });

  it('shows each crew member their own offers, not a mission that only holds them', async () => {
    const offers = await ownAssignments(quin);
    // Quin is also held by Phobos Survey, which is still awaiting approval: she is not told of it.
    expect(offers).toEqual([
      { ref: expect.stringMatching(/^ASG-\d+$/), mission: { ref: europa, name: 'Europa Survey', from: '2027-03-01', to: '2027-03-20' }, skill: 'medic', status: 'offered' },
    ]);
    quinsOffer = offers[0]?.ref ?? '';
    expect((await ownAssignments(ada)).map(({ mission: { ref }, skill, status }) => [ref, skill, status])).toEqual([[europa, 'pilot', 'offered']]);
    expect((await sam.get('/v1/assignments')).status).toBe(403);
  });

  it('lets a crew member respond only to their own offer', async () => {
    expect(await error(await ada.post(`/v1/assignments/${quinsOffer}/accept`))).toEqual({ status: 404, code: 'NOT_FOUND', message: `${quinsOffer} was not found.` });
    expect(await error(await ada.post(`/v1/assignments/${quinsOffer}/decline`, {}))).toMatchObject({ status: 404 });
    expect((await sam.post(`/v1/assignments/${quinsOffer}/accept`)).status).toBe(403);
    expect((await dana.post(`/v1/assignments/${quinsOffer}/decline`, {})).status).toBe(403);
    expect(await crewOf(europa)).toEqual(['medic: Quin Abara offered', 'pilot: Ada Reyes offered']);
  });

  it('records a decline with its reason, and reopens the slot', async () => {
    const declined = await bodyOf(await quin.post(`/v1/assignments/${quinsOffer}/decline`, { reason: 'Medical leave' }), crewAssignmentSchema);
    expect(declined).toMatchObject({ ref: quinsOffer, skill: 'medic', status: 'declined' });
    expect(await crewOf(europa)).toEqual(['medic: Quin Abara declined (Medical leave)', 'pilot: Ada Reyes offered']);
    expect(await ownAssignments(quin)).toEqual([]);
    expect(await error(await quin.post(`/v1/assignments/${quinsOffer}/accept`))).toMatchObject({ status: 404 });
  });

  it('refuses to launch while a slot is not accepted', async () => {
    expect(await error(await sam.post(`/v1/missions/${europa}/launch`, {}))).toMatchObject({
      status: 409,
      code: 'GUARD_FAILED',
      message: `${europa} cannot be launched until every slot is accepted: medic 0 of 1, pilot 0 of 1.`,
    });
  });

  it('refills only the reopened slot, as an offer, never choosing whoever declined', async () => {
    const rerun = await matchRun(await sam.post(`/v1/missions/${europa}/match`));
    expect(rerun.summary).toMatchObject({ slots: 2, already_filled: 1, open: 1, filled: 1 });
    // Mina is the stronger medic, but her time on Lunar Gateway Resupply put her below Quin the first time.
    expect(choices(rerun)).toEqual(['medic 1: Mina Farouk']);
    expect(rerun.ruled_out).toContainEqual({
      crew_member: { ref: 'CRW-7', name: 'Quin Abara' },
      skill: 'medic',
      failures: [{ constraint: 'not_declined', assignment: expect.objectContaining({ ref: quinsOffer, status: 'declined' }) }],
    });
    await sam.post(`/v1/match-runs/${rerun.ref}/apply`, {});
    expect(await crewOf(europa)).toEqual(['medic: Quin Abara declined (Medical leave)', 'medic: Mina Farouk offered', 'pilot: Ada Reyes offered']);
    expect(await error(await sam.post(`/v1/missions/${europa}/assignments`, { crew_member: 'CRW-7', skill: 'medic' }))).toMatchObject({
      code: 'NO_OPEN_SLOT',
    });
  });

  it('launches once every slot is accepted, and a response is final', async () => {
    const adasOffer = await offerTo(ada, europa);
    const accepted = await bodyOf(await ada.post(`/v1/assignments/${adasOffer}/accept`), crewAssignmentSchema);
    expect(accepted).toMatchObject({ ref: adasOffer, status: 'accepted' });
    expect(await error(await ada.post(`/v1/assignments/${adasOffer}/accept`))).toMatchObject({
      status: 409,
      code: 'WRONG_ASSIGNMENT_STATUS',
      message: `${adasOffer} is accepted; only an offered assignment can be accepted.`,
    });
    expect(await error(await ada.post(`/v1/assignments/${adasOffer}/decline`, {}))).toMatchObject({
      message: `${adasOffer} is accepted; only an offered assignment can be declined.`,
    });
    await mina.post(`/v1/assignments/${await offerTo(mina, europa)}/accept`);
    expect((await mission(await sam.post(`/v1/missions/${europa}/launch`, {}))).status).toBe('active');
  });
});
