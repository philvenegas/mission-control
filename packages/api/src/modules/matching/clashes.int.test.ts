import { type AssignmentStatus, matchRunSchema, parseRef, type Mission, missionEventSchema, missionSchema, type Period } from '@mission-control/contract';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Route } from '../../http/route.ts';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../../test/app.ts';
import { type ArrangedCrew, arrangeLogin, arrangeMission, weekOf2031 } from '../../test/arrange.ts';
import { waitsForRowLock } from '../../test/locks.ts';
import { crewOf, errorOf as error, missionOf as mission } from '../../test/missions.ts';

/**
 * Makes a crew member's proposal on a mission a hold, as only a race between two requests could:
 * the API's own checks refuse it first, and `test/arrange.ts` writes as the owner, outside the
 * request pipeline whose answer to the database's refusal is under test.
 */
const TAKE_HOLD: Route = {
  method: 'POST',
  path: '/v1/test/take-hold/:ref',
  permission: 'missions:read',
  handler: async (c) => {
    const { tx, orgId } = c.var.tenant;
    await tx.execute(sql`UPDATE assignments SET status = ${'held' satisfies AssignmentStatus} WHERE org_id = ${orgId} AND ref = ${Number(c.req.param('ref'))}`);
    return c.body(null, 204);
  },
};

const { app, owner } = useSeededApp([TAKE_HOLD]);

let dana: Caller; // director
let marcus: Caller; // director
let sam: Caller; // mission lead
let priya: Caller; // mission lead
let ada: Caller; // crew member: pilot 5, medic 4

beforeAll(async () => {
  [dana, marcus, sam, priya, ada] = await Promise.all([
    loginAs(app, 'artemis', 'dana@artemis.example'),
    loginAs(app, 'artemis', 'marcus@artemis.example'),
    loginAs(app, 'artemis', 'sam@artemis.example'),
    loginAs(app, 'artemis', 'priya@artemis.example'),
    loginAs(app, 'artemis', 'ada@artemis.example'),
  ]);
});

const ADA = 'CRW-1';
const PRIYA = { name: 'Priya Nair', email: 'priya@artemis.example' };

/** A new draft by the caller, needing one pilot (or another skill) at the level given. */
async function draft(caller: Caller, name: string, period: Period, minLevel = 3, headcount = 1) {
  const { ref } = await mission(await caller.post('/v1/missions', { name, ...period }));
  await caller.put(`/v1/missions/${ref}/requirements/pilot`, { min_level: minLevel, headcount });
  return ref;
}

const propose = (caller: Caller, missionRef: string, crewMember = ADA, skill = 'pilot') =>
  caller.post(`/v1/missions/${missionRef}/assignments`, { crew_member: crewMember, skill });

/** Each problem on a mission's crew, as `name: clash with MSN-n`, or `name: ` and the constraint that fails. */
const problemsIn = (shown: Mission) =>
  shown.requirements.flatMap(({ crew }) =>
    crew.flatMap(({ crew_member, problems }) =>
      problems.map((problem) => `${crew_member.name}: ${problem.kind === 'clash' ? `clash with ${problem.mission.ref}` : problem.failure.constraint}`),
    ),
  );
const problemsOf = async (missionRef: string) => problemsIn(await mission(await dana.get(`/v1/missions/${missionRef}`)));

const submit = (caller: Caller, missionRef: string) => caller.post(`/v1/missions/${missionRef}/submit`, {});

/** The reference of the assignment that puts a crew member on a mission. */
async function assignmentOf(missionRef: string, crewMember = ADA) {
  const shown = await mission(await dana.get(`/v1/missions/${missionRef}`));
  const found = shown.requirements.flatMap(({ crew }) => crew).find((crew) => crew.crew_member.ref === crewMember);
  if (!found) throw new Error(`${crewMember} is not on ${missionRef}`);
  return found.assignment;
}

let week = 0;
/** A period of its own, clear of every other scenario's. */
const nextPeriod = () => weekOf2031(week++);

function arrangeWithAda(status: 'submitted' | 'approved', period: Period, crew: ArrangedCrew[]) {
  return arrangeMission(owner, { org: 'artemis', name: `Arranged ${period.from}`, period, status, owner: 'sam@artemis.example', skill: 'pilot', crew });
}

// DESIGN.md section 10, "Clash scenarios". Sam and Priya are mission leads; Ada is a crew member.
describe('clash scenarios', () => {
  it('1. Sam\'s and Priya\'s drafts overlap and both propose Ada: both show the clash, naming the other; neither can be submitted; Sam\'s has a history event', async () => {
    const period = nextPeriod();
    const sams = await draft(sam, 'Callisto Relay', period);
    await propose(sam, sams);
    const priyas = await draft(priya, 'Ganymede Survey', period);
    // The response to the proposal says it made a clash.
    const proposed = await mission(await propose(priya, priyas));
    expect(proposed.requirements[0]?.crew[0]?.problems).toEqual([
      { kind: 'clash', mission: { ref: sams, name: 'Callisto Relay', status: 'draft', owner: 'Sam Okafor' } },
    ]);
    expect(await problemsOf(sams)).toEqual([`Ada Reyes: clash with ${priyas}`]);
    expect(await problemsOf(priyas)).toEqual([`Ada Reyes: clash with ${sams}`]);
    const listed = await bodyOf(await sam.get('/v1/missions'), z.array(missionSchema));
    expect(listed.filter(({ ref }) => ref === sams || ref === priyas).map(problemsIn)).toEqual([
      [`Ada Reyes: clash with ${priyas}`],
      [`Ada Reyes: clash with ${sams}`],
    ]);
    expect(await error(await submit(sam, sams))).toEqual({
      status: 409,
      code: 'GUARD_FAILED',
      message: `${sams} cannot be submitted: Ada Reyes CRW-1 is also proposed on ${priyas} Ganymede Survey (draft, Priya Nair).`,
      hint: 'Each problem must be resolved first: release the crew member, or change what blocks them.',
    });
    expect((await submit(priya, priyas)).status).toBe(409);
    const history = await bodyOf(await sam.get(`/v1/missions/${sams}/events`), z.array(missionEventSchema));
    expect(history.at(-1)).toMatchObject({
      type: 'clash',
      from_status: null,
      to_status: null,
      actor: PRIYA,
      note: `Ada Reyes CRW-1 is now also proposed on ${priyas} Ganymede Survey.`,
    });
  });

  it('2. The same with three drafts: all three show the clash and are blocked', async () => {
    const period = nextPeriod();
    const drafts = [await draft(sam, 'Three A', period), await draft(priya, 'Three B', period), await draft(dana, 'Three C', period)];
    for (const [index, ref] of drafts.entries()) await propose([sam, priya, dana][index] ?? dana, ref);
    for (const ref of drafts) {
      const others = drafts.filter((other) => other !== ref);
      expect((await problemsOf(ref)).sort()).toEqual(others.map((other) => `Ada Reyes: clash with ${other}`).sort());
      expect(await error(await submit(dana, ref))).toMatchObject({ status: 409, code: 'GUARD_FAILED' });
    }
  });

  it('3. The periods do not overlap: no clash; both can be submitted', async () => {
    const sams = await draft(sam, 'Apart A', nextPeriod());
    const priyas = await draft(priya, 'Apart B', nextPeriod());
    await propose(sam, sams);
    await propose(priya, priyas);
    expect([await problemsOf(sams), await problemsOf(priyas)]).toEqual([[], []]);
    expect([(await submit(sam, sams)).status, (await submit(priya, priyas)).status]).toEqual([200, 200]);
  });

  it('4. Priya removes Ada: the clash clears on both; Sam can submit', async () => {
    const period = nextPeriod();
    const sams = await draft(sam, 'Removed A', period);
    const priyas = await draft(priya, 'Removed B', period);
    await propose(sam, sams);
    await propose(priya, priyas);
    await priya.delete(`/v1/assignments/${await assignmentOf(priyas)}`);
    expect([await problemsOf(sams), await problemsOf(priyas)]).toEqual([[], []]);
    expect((await submit(sam, sams)).status).toBe(200);
  });

  it('5. A director removes Ada from Sam\'s draft: the clash clears on both', async () => {
    const period = nextPeriod();
    const sams = await draft(sam, 'Director A', period);
    const priyas = await draft(priya, 'Director B', period);
    await propose(sam, sams);
    await propose(priya, priyas);
    expect((await dana.delete(`/v1/assignments/${await assignmentOf(sams)}`)).status).toBe(200);
    expect([await problemsOf(sams), await problemsOf(priyas)]).toEqual([[], []]);
  });

  it('6. Sam cancels his draft: his proposals are released; the clash clears on Priya\'s', async () => {
    const period = nextPeriod();
    const sams = await draft(sam, 'Cancelled A', period);
    const priyas = await draft(priya, 'Cancelled B', period);
    await propose(sam, sams);
    await propose(priya, priyas);
    const proposal = await assignmentOf(sams);
    await sam.post(`/v1/missions/${sams}/cancel`, { note: 'Not needed.' });
    expect(await crewOf(sam, sams)).toEqual([]);
    const [released] = await owner`SELECT status FROM assignments WHERE ref = ${parseRef('assignment', proposal)}
      AND org_id = (SELECT id FROM organisations WHERE slug = 'artemis')`;
    expect(released).toEqual({ status: 'released' });
    expect(await problemsOf(priyas)).toEqual([]);
  });

  it('7. Priya changes her period so it no longer overlaps, then back: the clash clears, then returns', async () => {
    const period = nextPeriod();
    const sams = await draft(sam, 'Moved A', period);
    const priyas = await draft(priya, 'Moved B', period);
    await propose(sam, sams);
    await propose(priya, priyas);
    await priya.patch(`/v1/missions/${priyas}`, nextPeriod());
    expect([await problemsOf(sams), await problemsOf(priyas)]).toEqual([[], []]);
    await priya.patch(`/v1/missions/${priyas}`, period);
    expect([await problemsOf(sams), await problemsOf(priyas)]).toEqual([[`Ada Reyes: clash with ${priyas}`], [`Ada Reyes: clash with ${sams}`]]);
  });

  it('8. Matcher for Priya when a clash-free full crew exists: Ada is not chosen; no clash is made', async () => {
    const period = nextPeriod();
    await propose(sam, await draft(sam, 'Planned A', period));
    const priyas = await draft(priya, 'Planned B', period);
    const run = await bodyOf(await priya.post(`/v1/missions/${priyas}/match`), matchRunSchema);
    expect(run.slots[0]?.chosen?.crew_member.ref).toMatch(/^CRW-\d+$/);
    expect(run.slots[0]?.chosen?.crew_member.ref).not.toBe(ADA);
    expect(run.summary).toMatchObject({ filled: 1, clashes: 0 });
    await priya.post(`/v1/match-runs/${run.ref}/apply`, {});
    expect(await problemsOf(priyas)).toEqual([]);
  });

  it('9. Matcher for Priya when without Ada a slot would be unfilled: Ada is chosen and flagged as a clash', async () => {
    const period = nextPeriod();
    const sams = await draft(sam, 'Needed A', period);
    await propose(sam, sams);
    // Ada is the only pilot at level 5.
    const priyas = await draft(priya, 'Needed B', period, 5);
    const run = await bodyOf(await priya.post(`/v1/missions/${priyas}/match`), matchRunSchema);
    expect(run.slots[0]?.chosen).toMatchObject({
      crew_member: { ref: ADA, name: 'Ada Reyes' },
      clashes: [{ ref: sams, name: 'Needed A', status: 'draft', owner: 'Sam Okafor' }],
    });
    expect(run.summary.clashes).toBe(1);
  });

  it('10 and 11. Sam\'s mission is submitted, so Ada is held: Priya cannot have her; once it is rejected, the hold is dropped and proposing her is a clash again', async () => {
    const period = nextPeriod();
    const sams = await draft(sam, 'Held A', period);
    await propose(sam, sams);
    await submit(sam, sams);
    const priyas = await draft(priya, 'Held B', period);
    const run = await bodyOf(await priya.post(`/v1/missions/${priyas}/match`), matchRunSchema);
    expect(run.ruled_out).toContainEqual({
      crew_member: { ref: ADA, name: 'Ada Reyes' },
      skill: 'pilot',
      failures: [
        {
          constraint: 'free',
          assignment: { ref: await assignmentOf(sams), mission: { ref: sams, name: 'Held A', status: 'submitted', owner: 'Sam Okafor' }, ...period, status: 'held' },
        },
      ],
    });
    expect(await error(await propose(priya, priyas))).toMatchObject({
      status: 409,
      code: 'HARD_CONSTRAINT_FAILED',
      message: `Ada Reyes CRW-1 cannot be assigned as pilot on ${priyas}: Ada Reyes CRW-1 is held on ${sams} Held A (submitted, Sam Okafor) over the same period.`,
    });

    await dana.post(`/v1/missions/${sams}/reject`, { note: 'Rethink the crew.' });
    expect(await crewOf(sam, sams)).toEqual(['pilot: Ada Reyes proposed']);
    expect((await propose(priya, priyas)).status).toBe(201);
    expect([await problemsOf(sams), await problemsOf(priyas)]).toEqual([[`Ada Reyes: clash with ${priyas}`], [`Ada Reyes: clash with ${sams}`]]);
  });

  it('12. An approved mission refills a declined slot with Ada, who is proposed on Priya\'s draft: Ada is offered; Priya\'s draft shows a problem and cannot be submitted', async () => {
    const period = nextPeriod();
    const priyas = await draft(priya, 'Refilled B', period);
    await propose(priya, priyas);
    const approved = await arrangeWithAda('approved', period, [{ crewMember: 'CRW-2', status: 'declined' }]);
    expect((await propose(sam, approved)).status).toBe(201);
    expect(await crewOf(sam, approved)).toEqual(['pilot: Ben Osei declined', 'pilot: Ada Reyes offered']);
    expect(await problemsOf(priyas)).toEqual(['Ada Reyes: free']);
    expect(await error(await submit(priya, priyas))).toMatchObject({
      status: 409,
      message: `${priyas} cannot be submitted: Ada Reyes CRW-1 is offered on ${approved} Arranged ${period.from} (approved, Sam Okafor) over the same period.`,
    });
  });

  it('13. Ada adds an availability block over a proposal: accepted; the draft shows a problem and cannot be submitted', async () => {
    const period = nextPeriod();
    const priyas = await draft(priya, 'Blocked B', period);
    await propose(priya, priyas);
    expect((await ada.post('/v1/crew/me/availability', { ...period, reason: 'Family' })).status).toBe(201);
    expect(await problemsOf(priyas)).toEqual(['Ada Reyes: availability']);
    expect((await submit(priya, priyas)).status).toBe(409);
  });

  it('14. Ada adds an availability block over a held, offered or accepted assignment: refused, naming the mission only for offered and accepted', async () => {
    const [held, offered, accepted] = [nextPeriod(), nextPeriod(), nextPeriod()];
    await arrangeWithAda('submitted', held, [{ crewMember: ADA, status: 'held' }]);
    const offeredOn = await arrangeWithAda('approved', offered, [{ crewMember: ADA, status: 'offered' }]);
    const acceptedOn = await arrangeWithAda('approved', accepted, [{ crewMember: ADA, status: 'accepted' }]);
    expect(await error(await ada.post('/v1/crew/me/availability', held))).toEqual({
      status: 409,
      code: 'CREW_HELD',
      message: 'Ada Reyes CRW-1 is being planned for a mission in that period.',
      hint: 'Speak to their mission lead.',
    });
    expect(await error(await ada.post('/v1/crew/me/availability', offered))).toMatchObject({
      code: 'CREW_HELD',
      message: `Ada Reyes CRW-1 is offered on ${offeredOn} Arranged ${offered.from}, ${offered.from} to ${offered.to}.`,
    });
    expect(await error(await ada.post('/v1/crew/me/availability', accepted))).toMatchObject({
      message: `Ada Reyes CRW-1 is accepted on ${acceptedOn} Arranged ${accepted.from}, ${accepted.from} to ${accepted.to}.`,
    });
  });

  it('15. Two requests take a hold on Ada at the same moment: exactly one succeeds, the other gets 409', async () => {
    const period = nextPeriod();
    const first = await arrangeWithAda('approved', period, []);
    const second = await arrangeWithAda('approved', period, []);
    const answers = await Promise.all([propose(sam, first), propose(dana, second)]);
    expect(answers.map(({ status }) => status).sort()).toEqual([201, 409]);
    // Refused by the API's own check if the other hold was already committed, else by the database.
    const [refusal] = await Promise.all(answers.filter(({ status }) => status === 409).map(error));
    expect(['HARD_CONSTRAINT_FAILED', 'CREW_HELD']).toContain(refusal?.code);
    expect([...(await crewOf(sam, first)), ...(await crewOf(sam, second))]).toEqual(['pilot: Ada Reyes offered']);
  });

  it('16. A slot is unfilled and the organisation is strict: submit is refused', async () => {
    const sams = await draft(sam, 'Short-handed', nextPeriod(), 3, 2);
    await propose(sam, sams);
    expect(await error(await submit(sam, sams))).toEqual({
      status: 409,
      code: 'GUARD_FAILED',
      message: `${sams} cannot be submitted: pilot has 1 of 2 slots filled.`,
      hint: 'Artemis does not allow a mission to be submitted with open slots.',
    });
  });

  it('17. A slot is unfilled and the organisation allows it: submit and approval succeed; launch is refused until the slot is filled and accepted', async () => {
    const [farid, ines, tomas] = await Promise.all([
      loginAs(app, 'helios', 'farid@helios.example'),
      loginAs(app, 'helios', 'ines@helios.example'),
      loginAs(app, 'helios', 'tomas@helios.example'),
    ]);
    await arrangeLogin(owner, 'helios', 'CRW-1', 'anouk@helios.example');
    await arrangeLogin(owner, 'helios', 'CRW-2', 'bao@helios.example');
    const { ref } = await mission(await farid.post('/v1/missions', { name: 'Sunspot Watch', ...nextPeriod() }));
    await farid.put(`/v1/missions/${ref}/requirements/flight%20operations`, { min_level: 3, headcount: 2 });
    await propose(farid, ref, 'CRW-1', 'flight operations');
    expect((await submit(farid, ref)).status).toBe(200);
    await ines.post(`/v1/missions/${ref}/approve`, {});
    expect((await mission(await tomas.post(`/v1/missions/${ref}/approve`, {}))).status).toBe('approved');
    expect(await error(await farid.post(`/v1/missions/${ref}/launch`, {}))).toMatchObject({
      code: 'GUARD_FAILED',
      message: `${ref} cannot be launched until every slot is accepted: flight operations 0 of 2.`,
    });
    await propose(farid, ref, 'CRW-2', 'flight operations');
    // Filled, but not yet accepted.
    expect((await farid.post(`/v1/missions/${ref}/launch`, {})).status).toBe(409);
    for (const email of ['anouk@helios.example', 'bao@helios.example']) {
      const crewMember = await loginAs(app, 'helios', email);
      const [offer] = await bodyOf(await crewMember.get('/v1/assignments'), z.array(z.object({ ref: z.string() })));
      await crewMember.post(`/v1/assignments/${offer?.ref}/accept`);
    }
    expect((await mission(await farid.post(`/v1/missions/${ref}/launch`, {}))).status).toBe('active');
  });
});

describe('the proposal check on a mission read', () => {
  it('names each hard constraint a proposed crew member now fails, and submit lists every one', async () => {
    // Kira Novak, medic 3, and Noor Haddad, medic 3 certified until 10 March 2027, proposed for February.
    const { ref } = await mission(await sam.post('/v1/missions', { name: 'Winter Supply', from: '2027-02-15', to: '2027-02-25' }));
    await sam.put(`/v1/missions/${ref}/requirements/medic`, { min_level: 3, headcount: 2 });
    await propose(sam, ref, 'CRW-6', 'medic');
    await propose(sam, ref, 'CRW-4', 'medic');
    expect(await problemsOf(ref)).toEqual([]);
    await dana.patch('/v1/crew/CRW-6', { status: 'inactive' });
    await dana.put('/v1/crew/CRW-4/skills/medic', { level: 2, certified_until: '2027-02-20' });
    try {
      expect(await problemsOf(ref)).toEqual(['Kira Novak: active', 'Noor Haddad: skill', 'Noor Haddad: certification']);
      expect(await error(await submit(sam, ref))).toMatchObject({
        message:
          `${ref} cannot be submitted: Kira Novak CRW-6 is inactive; Noor Haddad CRW-4 is medic level 2, below the 3 needed; ` +
          "Noor Haddad CRW-4's medic certification expires on 2027-02-20, before the mission's last day, 2027-02-24.",
      });
    } finally {
      await dana.patch('/v1/crew/CRW-6', { status: 'active' });
      await dana.put('/v1/crew/CRW-4/skills/medic', { level: 3, certified_until: '2027-03-10' });
    }
    expect((await submit(sam, ref)).status).toBe(200);
    // Held crew have no problems to show: the proposal check is for drafts.
    expect(await problemsOf(ref)).toEqual([]);
  });

  it('makes a submit and an availability block for its crew wait for each other, so both cannot pass the check', async () => {
    const period = nextPeriod();
    const sams = await draft(sam, 'Waited', period);
    await propose(sam, sams);
    expect(await waitsForRowLock(owner, { org: 'artemis', kind: 'crew_member', ref: ADA }, () => submit(sam, sams))).toMatchObject({ waited: true, status: 200 });
    expect(await waitsForRowLock(owner, { org: 'artemis', kind: 'crew_member', ref: ADA }, () => ada.post('/v1/crew/me/availability', period))).toMatchObject({ waited: true, status: 409 });
    expect(await waitsForRowLock(owner, { org: 'artemis', kind: 'crew_member', ref: ADA }, () => dana.patch(`/v1/crew/${ADA}`, { status: 'active' }))).toMatchObject({ waited: true, status: 200 });
  });

  it('turns a second hold on a crew member over the same period into 409, whatever the application checked', async () => {
    const period = nextPeriod();
    const draftRef = await draft(marcus, 'Race B', period);
    await propose(marcus, draftRef);
    await arrangeWithAda('submitted', period, [{ crewMember: ADA, status: 'held' }]);
    const proposal = await assignmentOf(draftRef);
    expect(await error(await dana.post(`/v1/test/take-hold/${parseRef('assignment', proposal)}`))).toEqual({
      status: 409,
      code: 'CREW_HELD',
      message: 'A crew member is already held for an overlapping period.',
      hint: 'Someone else took the hold first. Read the mission again and choose another crew member.',
    });
    expect(await crewOf(marcus, draftRef)).toEqual(['pilot: Ada Reyes proposed']);
  });
});
