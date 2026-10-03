import { crewAssignmentSchema, crewMemberSchema, matchRunSchema, missionSchema } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SEED_ORGS } from '../../api/src/db/seed-data.ts';
import { json, useRunningApi } from './test/api.ts';
import { logInEveryone } from './test/profiles.ts';

// The three acts of DESIGN.md section 8, in order, as a mission lead, a director and crew run them.
// Each test carries on from the one before.

const api = useRunningApi();
const HELIOS = SEED_ORGS.find(({ slug }) => slug === 'helios');
if (!HELIOS) throw new Error('The seed has no Helios Labs.');
let as: Awaited<ReturnType<typeof logInEveryone>>;
beforeAll(async () => {
  as = await logInEveryone(api.url());
});

/** Each slot of a mission, with its crew member, their status and any reason they declined. */
async function crewOf(missionRef: string) {
  const mission = await json(as('sam', ['mission', 'show', missionRef, '--json']), missionSchema);
  return {
    status: mission.status,
    crew: mission.requirements.flatMap(({ skill, crew }) =>
      crew.map(({ crew_member: crewMember, status, decline_reason: reason }) => `${skill}: ${crewMember.name} ${status}${reason ? ` (${reason})` : ''}`),
    ),
  };
}

/** The assignment a crew member is offered, by mission. */
async function offerTo(person: 'ada' | 'quin' | 'mina', missionRef: string) {
  const offers = await json(as(person, ['assignment', 'list', '--json']), z.array(crewAssignmentSchema));
  const offer = offers.find(({ mission, status }) => mission.ref === missionRef && status === 'offered');
  if (!offer) throw new Error(`${person} has no offer on ${missionRef}`);
  return offer.ref;
}

describe('act 1: plan to launch', () => {
  it('creates a mission and says what it needs, naming the next command each time', async () => {
    expect(await as('sam', ['mission', 'create', '--name', 'Europa Survey', '--from', '2027-03-01', '--to', '2027-03-20'])).toEqual({
      code: 0,
      stdout: 'Created MSN-8 Europa Survey, 1–20 Mar 2027, as a draft.\nNext: mctl mission require MSN-8 --skill <skill> --level <level>\n',
      stderr: 'as Sam Okafor · mission lead · Artemis\n',
    });
    expect((await as('sam', ['mission', 'require', 'MSN-8', '--skill', 'pilot', '--level', '3'])).stdout).toBe(
      'MSN-8 needs 1 crew member with pilot at level 3 or above.\nNext: mctl match run MSN-8\n',
    );
    const mission = await json(as('sam', ['mission', 'require', 'MSN-8', '--skill', 'medic', '--level', '3', '--json']), missionSchema);
    expect(mission.requirements.map(({ skill, min_level: level }) => `${skill} ${level}`)).toEqual(['medic 3', 'pilot 3']);
  });

  it('runs the matcher: Ada as pilot and Quin as medic, with the reasons and the footer; nothing changes yet', async () => {
    const ran = await as('sam', ['match', 'run', 'MSN-8']);
    expect(ran.code).toBe(0);
    expect(ran.stdout).toMatch(/^MSN-8 {2}Europa Survey {2}1–20 Mar 2027\n✓ 2 of 2 slots filled\n/);
    expect(ran.stdout).toMatch(/\nmedic {2}level 3 or above\n {2}→ Quin Abara CRW-7 {3}score \d+\n {4}level 3 \(27 of 45\) · \d+ of 180 days assigned/);
    expect(ran.stdout).toMatch(/\npilot {2}level 3 or above\n {2}→ Ada Reyes CRW-1 {3}score \d+\n {4}level 5 \(36 of 45\)/);
    expect(ran.stdout).toContain('Excluded with the skill:\n  CRW-4 Noor Haddad — medic certification expires 10 Mar, before the mission ends\n');
    expect(ran.stdout).toMatch(/\nSaved as RUN-1\. Nothing has changed yet\.\n {2}Apply it: {6}mctl match apply RUN-1\n {2}Pick another: {2}mctl assignment add MSN-8 --crew CRW-\d+ --skill (medic|pilot)\n$/);
    const mission = await json(as('sam', ['mission', 'show', 'MSN-8', '--json']), missionSchema);
    expect(mission.requirements.flatMap(({ crew }) => crew)).toEqual([]);
    // Shown again later, the run prints the same; its answer chooses Ada as pilot and Quin as medic.
    expect((await as('sam', ['match', 'show', 'RUN-1'])).stdout).toBe(ran.stdout);
    const run = await json(as('sam', ['match', 'show', 'RUN-1', '--json']), matchRunSchema);
    expect(run.slots.map(({ slot, chosen }) => `${slot.skill}: ${chosen?.crew_member.name}`)).toEqual(['medic: Quin Abara', 'pilot: Ada Reyes']);
    expect(run.applied_at).toBeNull();
  });

  it('applies the run, submits, and is refused approval as a mission lead before a director approves', async () => {
    const applied = await as('sam', ['match', 'apply', 'RUN-1']);
    expect(applied.stdout).toMatch(/^Applied RUN-1\. MSN-8 has 2 of 2 slots filled\.\n {2}medic: Quin Abara CRW-7, proposed \(ASG-\d+\)\n {2}pilot: Ada Reyes CRW-1, proposed \(ASG-\d+\)\nNext: mctl mission submit MSN-8\n$/);
    expect(await as('sam', ['mission', 'submit', 'MSN-8'])).toMatchObject({
      code: 0,
      stdout: 'Submitted MSN-8 for approval; its crew are held.\nNext (a director): mctl mission approve MSN-8\n',
    });
    expect(await as('sam', ['mission', 'approve', 'MSN-8', '--json'])).toEqual({
      code: 4,
      stdout: '',
      stderr: 'as Sam Okafor · mission lead · Artemis\nError: Your role does not allow this.\n',
    });
    expect(await crewOf('MSN-8')).toEqual({ status: 'submitted', crew: ['medic: Quin Abara held', 'pilot: Ada Reyes held'] });
    expect(await as('dana', ['mission', 'approve', 'MSN-8'])).toEqual({
      code: 0,
      stdout: 'Approved MSN-8. Its crew are offered their places.\nNext: mctl mission show MSN-8\n',
      stderr: 'as Dana Okoye · director · Artemis\n',
    });
  });

  it('lets the medic see the offer and decline it, saying why; the reopened slot is refilled with Mina', async () => {
    const quins = await as('quin', ['assignment', 'list']);
    const offer = await offerTo('quin', 'MSN-8');
    expect(quins.stdout).toBe(`${offer}  MSN-8 Europa Survey  1–20 Mar 2027  medic  offered\nNext: mctl assignment accept ${offer}\n`);
    expect((await as('quin', ['assignment', 'decline', offer, '--reason', 'Medical leave'])).stdout).toBe(
      `Declined ${offer}: medic on MSN-8 Europa Survey.\nNext: mctl assignment list\n`,
    );
    const refilled = await as('sam', ['match', 'run', 'MSN-8', '--apply']);
    expect(refilled.code).toBe(0);
    expect(refilled.stdout).toMatch(/^MSN-8 {2}Europa Survey {2}1–20 Mar 2027\n✓ 2 of 2 slots filled\n\nmedic {2}level 3 or above\n {2}→ Mina Farouk CRW-3 /);
    expect(refilled.stdout).toContain('  CRW-7 Quin Abara — declined MSN-8\n');
    expect(refilled.stdout).toMatch(/\n\nApplied RUN-2\. MSN-8 has 2 of 2 slots filled\.\n {2}medic: Mina Farouk CRW-3, offered \(ASG-\d+\)\n$/);
    expect(await crewOf('MSN-8')).toEqual({
      status: 'approved',
      crew: ['medic: Quin Abara declined (Medical leave)', 'medic: Mina Farouk offered', 'pilot: Ada Reyes offered'],
    });
  });

  it('launches once both accept, and shows who did what, and when', async () => {
    expect(await as('sam', ['mission', 'launch', 'MSN-8'])).toMatchObject({ code: 6, stderr: expect.stringContaining('until every slot is accepted') });
    for (const person of ['ada', 'mina'] as const) {
      const offer = await offerTo(person, 'MSN-8');
      expect((await as(person, ['assignment', 'accept', offer])).stdout).toBe(`Accepted ${offer}: ${person === 'ada' ? 'pilot' : 'medic'} on MSN-8 Europa Survey, 1–20 Mar 2027.\nNext: mctl mission show MSN-8\n`);
    }
    expect((await as('sam', ['mission', 'show', 'MSN-8'])).stdout).toMatch(/\nNext: mctl mission launch MSN-8\n$/);
    expect((await as('sam', ['mission', 'launch', 'MSN-8'])).stdout).toBe('Launched MSN-8; it is active.\nNext: mctl mission complete MSN-8\n');
    const history = (await as('sam', ['mission', 'history', 'MSN-8'])).stdout.split('\n');
    expect(history.map((line) => line.replace(/^\S+ \S+ UTC {2}/, '').replace(/ +/g, ' '))).toEqual([
      'submit draft → submitted Sam Okafor',
      'approve submitted → approved Dana Okoye',
      'launch approved → active Sam Okafor',
      '',
    ]);
  });

  it('shows a crew member only their own slot of the mission', async () => {
    expect((await as('ada', ['mission', 'show', 'MSN-8'])).stdout).toMatch(/^MSN-8 {2}Europa Survey {2}1–20 Mar 2027 {2}pilot {2}accepted {2}ASG-\d+\n$/);
    expect((await as('ada', ['mission', 'list'])).stdout).toContain('MSN-8  Europa Survey');
  });
});

describe('act 2: a clash', () => {
  it('marks the clash on both drafts, names it in the refusal to submit, and clears once the pilot is let go', async () => {
    const shown = await as('sam', ['mission', 'show', 'MSN-4']);
    expect(shown.stdout).toMatch(/ {2}(ASG-\d+) {2}Ada Reyes CRW-1 .*✗ clash: also proposed on MSN-5 Vesta Mapping \(draft, owner Priya Nair\)\n/);
    const [, clashing] = /(ASG-\d+) {2}Ada Reyes/.exec(shown.stdout) ?? [];
    expect(shown.stdout).toMatch(new RegExp(`\nNext: mctl assignment remove ${clashing}\n$`));
    const list = (await as('sam', ['mission', 'list'])).stdout.split('\n');
    expect(list.find((line) => line.startsWith('MSN-4'))).toContain('✗ clash: Ada Reyes also on MSN-5 (Priya Nair)');
    expect(list.find((line) => line.startsWith('MSN-5'))).toContain('✗ clash: Ada Reyes also on MSN-4 (Sam Okafor)');

    expect(await as('sam', ['mission', 'submit', 'MSN-4', '--json'])).toMatchObject({
      code: 6,
      stdout: '',
      stderr: expect.stringContaining('Ada Reyes CRW-1 is also proposed on MSN-5 Vesta Mapping'),
    });
    expect(await crewOf('MSN-4')).toEqual({ status: 'draft', crew: ['engineer: Noor Haddad proposed', 'pilot: Ada Reyes proposed'] });
    expect((await as('sam', ['assignment', 'remove', `${clashing}`, '--yes'])).stdout).toBe(`Released ${clashing} from MSN-4.\nNext: mctl match run MSN-4\n`);
    const refilled = await as('sam', ['match', 'run', 'MSN-4', '--apply']);
    expect(refilled.stdout).toMatch(/\n {2}pilot: Ben Osei CRW-2, proposed \(ASG-\d+\)\nNext: mctl mission submit MSN-4\n$/);
    expect((await json(as('sam', ['mission', 'submit', 'MSN-4', '--json']), missionSchema)).status).toBe('submitted');
    expect(await crewOf('MSN-4')).toEqual({ status: 'submitted', crew: ['engineer: Noor Haddad held', 'pilot: Ben Osei held'] });
    // Ada is let go from Ceres Resupply only; Vesta Mapping keeps her, now with no clash.
    const vesta = await json(as('sam', ['mission', 'show', 'MSN-5', '--json']), missionSchema);
    expect(vesta.requirements.flatMap(({ crew }) => crew.map(({ crew_member: crewMember, problems }) => [crewMember.name, problems]))).toContainEqual(['Ada Reyes', []]);
  });
});

describe('act 3: another organisation sees nothing', () => {
  it('finds no MSN-8, and lists only its own missions and crew', async () => {
    expect(await as('farid', ['mission', 'show', 'MSN-8'])).toEqual({ code: 5, stdout: '', stderr: 'as Farid Rahimi · mission lead · Helios Labs\nError: MSN-8 was not found.\n' });
    expect(await as('farid', ['mission', 'show', 'MSN-8', '--json'])).toMatchObject({ code: 5, stdout: '' });
    expect((await as('farid', ['mission', 'list'])).stdout.split('\n').map((line) => line.split('  ')[1])).toEqual(['Solar Corona Probe', 'Mercury Flyby', undefined]);
    const missions = await json(as('farid', ['mission', 'list', '--json']), z.array(missionSchema));
    expect(missions.map(({ name, owner }) => `${name}, ${owner.name}`)).toEqual(['Solar Corona Probe, Farid Rahimi', 'Mercury Flyby, Farid Rahimi']);
    const crew = await json(as('farid', ['crew', 'list', '--json']), z.array(crewMemberSchema));
    expect(crew.flatMap(({ skills }) => skills.map(({ skill }) => skill))).toContain('field medicine');
    expect(crew.map(({ name }) => name)).toEqual(HELIOS.crew.map(({ name }) => name));
  });

  it('cannot see another organisation\'s match run', async () => {
    expect(await as('farid', ['match', 'show', 'RUN-1'])).toMatchObject({ code: 5 });
    // The run is Artemis's, and its owner still sees it.
    expect((await json(as('sam', ['match', 'show', 'RUN-1', '--json']), matchRunSchema)).mission).toBe('MSN-8');
  });
});
