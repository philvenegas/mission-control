import { availabilityBlockSchema, DEFAULT_MATCH_WEIGHTS, type MatchRun, matchRunSchema, missionSchema } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../../test/app.ts';
import { arrangeMission, weekOf2031 } from '../../test/arrange.ts';
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

const matchRun = async (response: Response) => bodyOf(response, matchRunSchema);

/** Who each slot of a run went to, as `skill number: name`, or unfilled. */
const choices = (run: MatchRun) => run.slots.map(({ slot, chosen }) => `${slot.skill} ${slot.number}: ${chosen ? chosen.crew_member.name : 'unfilled'}`);

/** The crew member a one-slot run chose. */
function chosenCrewMember(run: MatchRun) {
  const chosen = run.slots[0]?.chosen?.crew_member;
  if (!chosen) throw new Error(`${run.ref} chose nobody`);
  return chosen;
}

let arranged = 0;
/** A mission of Artemis's on its own week of 2031, owned by Sam, needing one skill. */
function arrangeFor(status: 'draft' | 'approved', skill: string, minLevel = 1, headcount = 1) {
  const week = arranged++;
  return arrangeMission(owner, { org: 'artemis', name: `Matched ${week}`, period: weekOf2031(week), status, owner: 'sam@artemis.example', skill, minLevel, headcount });
}

describe('running the matcher', () => {
  it('saves a match run with its proposal, its explanation and the weights in force, and changes nothing else', async () => {
    const before = await bodyOf(await dana.get('/v1/missions'), z.array(missionSchema));
    const response = await sam.post('/v1/missions/MSN-7/match');
    expect(response.status).toBe(201);
    const run = await matchRun(response);
    expect(run).toMatchObject({
      ref: expect.stringMatching(/^RUN-\d+$/),
      mission: 'MSN-7',
      created_by: SAM,
      applied_at: null,
      weights: DEFAULT_MATCH_WEIGHTS,
      summary: { slots: 2, already_filled: 0, open: 2, filled: 2, clashes: 0 },
    });
    // Io Flyby: filling one slot at a time would make Ada the pilot and leave the medic slot empty.
    expect(choices(run)).toEqual(['medic 1: Ada Reyes', 'pilot 1: Ben Osei']);
    // Every mission, its crew included, is as it was.
    expect(await bodyOf(await dana.get('/v1/missions'), z.array(missionSchema))).toEqual(before);
  });

  it('numbers runs per organisation, and gives each its own', async () => {
    const first = await matchRun(await sam.post('/v1/missions/MSN-7/match'));
    const second = await matchRun(await sam.post('/v1/missions/MSN-7/match'));
    const number = (ref: string) => Number(ref.slice('RUN-'.length));
    expect(number(second.ref)).toBe(number(first.ref) + 1);
  });

  it('runs for the mission\'s owner and directors only', async () => {
    expect(await error(await priya.post('/v1/missions/MSN-7/match'))).toMatchObject({
      status: 403,
      message: "Only MSN-7's owner or a director can change its crew.",
    });
    expect((await ada.post('/v1/missions/MSN-7/match')).status).toBe(403);
    expect((await dana.post('/v1/missions/MSN-7/match')).status).toBe(201);
    expect(await error(await dana.post('/v1/missions/MSN-99/match'))).toMatchObject({ status: 404 });
  });

  it('runs only on a draft, or an approved mission refilling a slot', async () => {
    for (const [ref, status] of [['MSN-3', 'submitted'], ['MSN-1', 'active'], ['MSN-2', 'completed']]) {
      expect(await error(await dana.post(`/v1/missions/${ref}/match`))).toMatchObject({
        status: 409,
        code: 'NOT_STAFFABLE',
        message: `${ref} is ${status}, so its crew cannot change.`,
      });
    }
  });
});

describe('reading a match run', () => {
  it('shows the run to the mission\'s owner and directors, and to nobody else', async () => {
    const run = await matchRun(await sam.post('/v1/missions/MSN-7/match'));
    expect(await matchRun(await sam.get(`/v1/match-runs/${run.ref}`))).toEqual(run);
    expect(await matchRun(await dana.get(`/v1/match-runs/${run.ref}`))).toEqual(run);
    // Another mission lead does not see it: it answers as a run that does not exist.
    expect(await error(await priya.get(`/v1/match-runs/${run.ref}`))).toEqual({ status: 404, code: 'NOT_FOUND', message: `${run.ref} was not found.` });
    expect(await error(await priya.get('/v1/match-runs/RUN-999'))).toEqual({ status: 404, code: 'NOT_FOUND', message: 'RUN-999 was not found.' });
    expect((await ada.get(`/v1/match-runs/${run.ref}`)).status).toBe(403);
  });
});

describe('applying a match run', () => {
  it('proposes the chosen crew on a draft, recording the run and each score, and applies once', async () => {
    const draft = await arrangeFor('draft', 'pilot', 4);
    const run = await matchRun(await sam.post(`/v1/missions/${draft}/match`));
    const applied = await mission(await sam.post(`/v1/match-runs/${run.ref}/apply`, {}));
    const [pilot] = applied.requirements;
    expect(pilot?.crew).toEqual([
      {
        assignment: expect.stringMatching(/^ASG-\d+$/),
        crew_member: { ref: 'CRW-1', name: 'Ada Reyes' },
        status: 'proposed',
        score: run.slots[0]?.chosen?.score.total,
        match_run: run.ref,
        assigned_by: SAM,
        decline_reason: null,
        problems: [],
      },
    ]);
    expect((await matchRun(await sam.get(`/v1/match-runs/${run.ref}`))).applied_at).not.toBeNull();
    expect(await error(await sam.post(`/v1/match-runs/${run.ref}/apply`, {}))).toMatchObject({
      status: 409,
      code: 'RUN_ALREADY_APPLIED',
      message: `${run.ref} has already been applied.`,
    });
  });

  it('offers the chosen crew their places on an approved mission', async () => {
    const approved = await arrangeFor('approved', 'pilot', 4);
    const run = await matchRun(await sam.post(`/v1/missions/${approved}/match`));
    await sam.post(`/v1/match-runs/${run.ref}/apply`, {});
    expect(await crewOf(sam, approved)).toEqual(['pilot: Ada Reyes offered']);
  });

  it('creates assignments for the slots a partly filled run did fill', async () => {
    // Titan Relay needs two geologists at level 4; only Rosa qualifies.
    const run = await matchRun(await sam.post('/v1/missions/MSN-6/match'));
    expect(choices(run)).toEqual(['geologist 1: Rosa Imani', 'geologist 2: unfilled']);
    await sam.post(`/v1/match-runs/${run.ref}/apply`, {});
    expect(await crewOf(sam, 'MSN-6')).toEqual(['geologist: Rosa Imani proposed']);
    // The next run solves only the slot still open.
    expect((await matchRun(await sam.post('/v1/missions/MSN-6/match'))).summary).toMatchObject({ slots: 2, already_filled: 1, open: 1, filled: 0 });
  });

  it('applies nothing when anyone chosen no longer passes the hard constraints, and says who and why', async () => {
    const draft = await arrangeFor('draft', 'pilot', 4);
    const { from, to } = await mission(await sam.get(`/v1/missions/${draft}`));
    const run = await matchRun(await sam.post(`/v1/missions/${draft}/match`));
    const chosen = chosenCrewMember(run);
    const blocked = await dana.post(`/v1/crew/${chosen.ref}/availability`, { from, to, reason: 'Training' });
    const { ref: block } = await bodyOf(blocked, availabilityBlockSchema);
    expect(await error(await sam.post(`/v1/match-runs/${run.ref}/apply`, {}))).toMatchObject({
      status: 409,
      code: 'RUN_OUT_OF_DATE',
      message: `${run.ref} cannot be applied, so none of it was: ${chosen.name} ${chosen.ref} has availability block ${block}, ${from} to ${to}.`,
      hint: `Run the matcher again for ${draft}.`,
    });
    expect(await crewOf(sam, draft)).toEqual([]);
    expect((await matchRun(await sam.get(`/v1/match-runs/${run.ref}`))).applied_at).toBeNull();
    // Once the block is gone the same run applies.
    await dana.delete(`/v1/availability/${block}`);
    expect((await sam.post(`/v1/match-runs/${run.ref}/apply`, {})).status).toBe(200);
  });

  it('applies nothing when a slot the run filled has been filled since', async () => {
    const draft = await arrangeFor('draft', 'pilot', 4);
    const run = await matchRun(await sam.post(`/v1/missions/${draft}/match`));
    const [chosen, alternate] = [chosenCrewMember(run), run.slots[0]?.alternates[0]?.crew_member];
    expect((await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: alternate?.ref, skill: 'pilot' })).status).toBe(201);
    expect(await error(await sam.post(`/v1/match-runs/${run.ref}/apply`, {}))).toMatchObject({
      code: 'RUN_OUT_OF_DATE',
      message: `${run.ref} cannot be applied, so none of it was: ${draft} has no open pilot slot left for ${chosen.name} ${chosen.ref}.`,
    });
  });

  it('applies nothing when the mission no longer needs a skill the run filled', async () => {
    const draft = await arrangeFor('draft', 'pilot', 4);
    const run = await matchRun(await sam.post(`/v1/missions/${draft}/match`));
    expect((await sam.delete(`/v1/missions/${draft}/requirements/pilot`)).status).toBe(200);
    expect(await error(await sam.post(`/v1/match-runs/${run.ref}/apply`, {}))).toMatchObject({
      code: 'RUN_OUT_OF_DATE',
      message: `${run.ref} cannot be applied, so none of it was: ${draft} no longer needs a pilot.`,
    });
  });

  it('needs a yes to apply a run that chose someone despite a clash, naming the other missions', async () => {
    // Ada is the only pilot at level 5, and Ceres Resupply and Vesta Mapping both propose her in May.
    const { ref: draft } = await mission(await sam.post('/v1/missions', { name: 'Pallas Flyby', from: '2027-05-12', to: '2027-05-20' }));
    await sam.put(`/v1/missions/${draft}/requirements/pilot`, { min_level: 5 });
    const run = await matchRun(await sam.post(`/v1/missions/${draft}/match`));
    expect(run.slots[0]?.chosen).toMatchObject({
      crew_member: { name: 'Ada Reyes' },
      clashes: [
        { ref: 'MSN-4', name: 'Ceres Resupply', status: 'draft', owner: 'Sam Okafor' },
        { ref: 'MSN-5', name: 'Vesta Mapping', status: 'draft', owner: 'Priya Nair' },
      ],
    });
    expect(await error(await sam.post(`/v1/match-runs/${run.ref}/apply`, {}))).toMatchObject({
      status: 409,
      code: 'CLASH_NOT_ALLOWED',
      message: `${run.ref} proposes Ada Reyes CRW-1, who is also proposed on MSN-4 Ceres Resupply (draft, Sam Okafor) and MSN-5 Vesta Mapping (draft, Priya Nair).`,
    });
    expect(await crewOf(sam, draft)).toEqual([]);
    await sam.post(`/v1/match-runs/${run.ref}/apply`, { allow_clashes: true });
    expect(await crewOf(sam, draft)).toEqual(['pilot: Ada Reyes proposed']);
  });

  it('applies a run once when two requests apply it at the same moment', async () => {
    const draft = await arrangeFor('draft', 'pilot', 4);
    const run = await matchRun(await sam.post(`/v1/missions/${draft}/match`));
    const answers = await Promise.all([sam.post(`/v1/match-runs/${run.ref}/apply`, {}), dana.post(`/v1/match-runs/${run.ref}/apply`, {})]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(await crewOf(sam, draft)).toHaveLength(1);
  });

  it('is for the mission\'s owner and directors only', async () => {
    const run = await matchRun(await sam.post('/v1/missions/MSN-7/match'));
    expect((await priya.post(`/v1/match-runs/${run.ref}/apply`, {})).status).toBe(404);
    expect((await ada.post(`/v1/match-runs/${run.ref}/apply`, {})).status).toBe(403);
    expect(await crewOf(sam, 'MSN-7')).toEqual([]);
  });

  it('refuses once the mission can no longer change its crew', async () => {
    const draft = await arrangeFor('draft', 'pilot', 4);
    const run = await matchRun(await sam.post(`/v1/missions/${draft}/match`));
    // Filled by hand, so the draft can be submitted.
    await sam.post(`/v1/missions/${draft}/assignments`, { crew_member: 'CRW-2', skill: 'pilot' });
    expect((await sam.post(`/v1/missions/${draft}/submit`, {})).status).toBe(200);
    expect(await error(await sam.post(`/v1/match-runs/${run.ref}/apply`, {}))).toMatchObject({ status: 409, code: 'NOT_STAFFABLE' });
  });
});
