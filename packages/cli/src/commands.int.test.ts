import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { availabilityBlockSchema, crewAssignmentSchema, crewMemberSchema, matchRunSchema, missionSchema } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEMO_PASSWORD } from '../../api/src/db/seed-data.ts';
import { json, mctl, scratch, useRunningApi } from './test/api.ts';
import { logInEveryone, type Person } from './test/profiles.ts';

// The commands beyond the walk-through's path: asking before a destructive change, a clash on
// applying a run, approval progress, the records a mission is staffed from, and --json everywhere.

const api = useRunningApi();
let as: Awaited<ReturnType<typeof logInEveryone>>;
beforeAll(async () => {
  as = await logInEveryone(api.url());
});

/** A terminal with `answer` already typed, which it gives when it is read. */
function terminalAnswering(answer: string) {
  const terminal = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => terminal });
  terminal.write(answer);
  return terminal;
}

/** A new draft owned by Sam, needing one pilot at `level`; its reference. */
async function draftNeedingPilot(name: string, from: string, to: string, level = 3) {
  const { ref } = await json(as('sam', ['mission', 'create', '--name', name, '--from', from, '--to', to, '--json']), missionSchema);
  await as('sam', ['mission', 'require', ref, '--skill', 'pilot', '--level', String(level)]);
  return ref;
}

const crewOf = async (ref: string) => (await json(as('sam', ['mission', 'show', ref, '--json']), missionSchema)).requirements.flatMap(({ crew }) => crew);

describe('a destructive command', () => {
  it('asks first on a terminal, goes ahead on yes and changes nothing otherwise', async () => {
    const ref = await draftNeedingPilot('Hygiea Survey', '2027-08-02', '2027-08-12');
    await as('sam', ['assignment', 'add', ref, '--crew', 'CRW-2', '--skill', 'pilot']);
    const [proposed] = await crewOf(ref);
    if (!proposed) throw new Error('Ben is proposed');

    const refused = await as('sam', ['assignment', 'remove', proposed.assignment], { stdin: terminalAnswering('n\n') });
    expect(refused).toEqual({
      code: 1,
      stdout: '',
      stderr: `as Sam Okafor · mission lead · Artemis\nRelease ${proposed.assignment}? Its crew member leaves the slot. [y/N] Error: Nothing was changed.\n`,
    });
    expect(await crewOf(ref)).toHaveLength(1);

    const released = await as('sam', ['assignment', 'remove', proposed.assignment], { stdin: terminalAnswering('y\n') });
    expect(released).toMatchObject({ code: 0, stdout: `Released ${proposed.assignment} from ${ref}.\nNext: mctl match run ${ref}\n` });
    expect(await crewOf(ref)).toEqual([]);
  });

  it('refuses without a terminal to ask on unless --yes is given, and changes nothing', async () => {
    const ref = await draftNeedingPilot('Psyche Survey', '2027-09-01', '2027-09-10');
    await as('sam', ['assignment', 'add', ref, '--crew', 'CRW-2', '--skill', 'pilot']);
    const [proposed] = await crewOf(ref);
    if (!proposed) throw new Error('Ben is proposed');
    const refusal = (command: string) => ({
      code: 2,
      stdout: '',
      stderr: expect.stringContaining(`Error: ${command} asks before it changes anything, and there is no terminal to ask on.\n  Add --yes to go ahead without being asked.\n`),
    });
    expect(await as('sam', ['assignment', 'remove', proposed.assignment])).toEqual(refusal('mctl assignment remove'));
    expect(await as('sam', ['assignment', 'clear', ref])).toEqual(refusal('mctl assignment clear'));
    expect(await as('sam', ['mission', 'cancel', ref, '--note', 'Dropped'])).toEqual(refusal('mctl mission cancel'));
    expect(await as('ada', ['availability', 'remove', 'AVL-1'])).toEqual(refusal('mctl availability remove'));
    expect(await crewOf(ref)).toHaveLength(1);

    expect((await as('sam', ['assignment', 'clear', ref, '--yes'])).stdout).toBe(`Released the proposed crew of ${ref}.\nNext: mctl match run ${ref}\n`);
    expect(await crewOf(ref)).toEqual([]);
    expect(await as('sam', ['mission', 'cancel', ref, '--note', 'Dropped', '--yes'])).toMatchObject({
      code: 0,
      stdout: `Cancelled ${ref}; its crew are released.\nNext: mctl mission history ${ref}\n`,
    });
  });
});

describe('applying a run that makes a clash', () => {
  // Only Ada flies pilot at level 5, and two drafts propose her over these days: Sam's Ceres
  // Resupply and Priya's Vesta Mapping.
  it('is refused without a terminal, naming the clash and how to apply it anyway', async () => {
    const ref = await draftNeedingPilot('Pallas Flyby', '2027-05-12', '2027-05-20', 5);
    const { ref: runRef } = await json(as('sam', ['match', 'run', ref, '--json']), matchRunSchema);
    const shown = await as('sam', ['match', 'show', runRef]);
    expect(shown.stdout).toContain(
      '    ⚠ clash: also proposed on MSN-4 Ceres Resupply (draft, owner Sam Okafor) and MSN-5 Vesta Mapping (draft, owner Priya Nair). Neither mission can be submitted until one lets Ada Reyes go.\n',
    );
    const refused = await as('sam', ['match', 'apply', runRef]);
    expect(refused).toMatchObject({ code: 6, stdout: '' });
    expect(refused.stderr).toMatch(
      new RegExp(`^as Sam Okafor · mission lead · Artemis\\nError: ${runRef} proposes Ada Reyes CRW-1, who is also proposed on MSN-4 Ceres Resupply .*\\n {2}Neither mission can be submitted until one lets them go\\. Add --yes to apply it anyway\\.\\n$`),
    );
    expect(await crewOf(ref)).toEqual([]);

    const asked = await as('sam', ['match', 'apply', runRef], { stdin: terminalAnswering('yes\n') });
    expect(asked.stderr).toContain(`MSN-5 Vesta Mapping (draft, Priya Nair). Apply it anyway? [y/N] `);
    expect(asked.stdout).toMatch(new RegExp(`^Applied ${runRef}\\. ${ref} has 1 of 1 slot filled\\.\\n {2}pilot: Ada Reyes CRW-1, proposed \\(ASG-\\d+\\) {2}✗ clash: also proposed on MSN-4`));
    expect(asked.stdout).toMatch(/\nNext: mctl assignment remove ASG-\d+\n$/);
  });

  it('is applied straight away with --yes, and --apply --json gives both answers', async () => {
    const ref = await draftNeedingPilot('Juno Flyby', '2027-05-14', '2027-05-18', 5);
    const both = await json(
      as('sam', ['match', 'run', ref, '--apply', '--yes', '--json']),
      z.object({ match_run: matchRunSchema, mission: missionSchema }).strict(),
    );
    expect(both.match_run.summary.clashes).toBe(1);
    expect(both.mission.requirements.flatMap(({ crew }) => crew.map(({ crew_member: crewMember }) => crewMember.name))).toEqual(['Ada Reyes']);
  });

  it('passes on any other refusal as it came', async () => {
    expect(await as('sam', ['match', 'apply', 'RUN-99'])).toMatchObject({ code: 5, stderr: expect.stringContaining('RUN-99 was not found.') });
  });
});

describe('approval by more than one director', () => {
  it('reports progress while more approvals are needed, and lists who has approved', async () => {
    expect(await as('farid', ['mission', 'submit', 'MSN-2'])).toMatchObject({ code: 0 });
    expect(await as('ines', ['mission', 'approve', 'MSN-2', '--note', 'Looks sound'])).toMatchObject({
      code: 0,
      stdout: 'Approved (1 of 2). MSN-2 stays submitted until one more director approves.\nNext (another director): mctl mission approve MSN-2\n',
    });
    expect((await as('farid', ['mission', 'show', 'MSN-2'])).stdout).toContain('submitted · owner Farid Rahimi · submitted by Farid Rahimi\nApprovals: 1 of 2 — Ines Varga\n');
  });
});

describe('the rest of a mission\'s lifecycle', () => {
  it('rejects with a reason, completes an active mission, and drops a requirement', async () => {
    const ref = await draftNeedingPilot('Eros Flyby', '2027-10-04', '2027-10-14');
    await as('sam', ['match', 'run', ref, '--apply']);
    await as('sam', ['mission', 'submit', ref]);
    expect(await as('dana', ['mission', 'reject', ref])).toMatchObject({ code: 2, stderr: expect.stringContaining("required option '--note <text>' not specified") });
    expect((await as('dana', ['mission', 'reject', ref, '--note', 'Not this quarter'])).stdout).toBe(
      `Rejected ${ref}; it is back in draft, and its crew are no longer held.\nNext: mctl mission show ${ref}\n`,
    );
    expect((await as('sam', ['mission', 'history', ref])).stdout).toContain('“Not this quarter”');

    expect((await as('sam', ['mission', 'complete', 'MSN-1'])).stdout).toBe('Completed MSN-1.\nNext: mctl mission history MSN-1\n');
    expect((await as('sam', ['mission', 'show', 'MSN-1'])).stdout).toMatch(/\nNext: mctl mission history MSN-1\n$/);

    const fresh = await json(as('sam', ['mission', 'create', '--name', 'Ida Flyby', '--from', '2027-11-01', '--to', '2027-11-08', '--description', 'A short one.', '--json']), missionSchema);
    expect((await as('sam', ['mission', 'history', fresh.ref])).stdout).toBe(`${fresh.ref} has no history yet.\n`);
    await as('sam', ['mission', 'require', fresh.ref, '--skill', 'pilot', '--level', '3', '--count', '2']);
    expect((await as('sam', ['mission', 'unrequire', fresh.ref, '--skill', 'pilot'])).stdout).toBe(`${fresh.ref} no longer needs pilot.\nNext: mctl mission show ${fresh.ref}\n`);
    expect((await as('sam', ['mission', 'show', fresh.ref])).stdout).toBe(
      `${fresh.ref}  Ida Flyby  1–8 Nov 2027\ndraft · owner Sam Okafor\nA short one.\n\nNo requirements yet.\nNext: mctl mission require ${fresh.ref} --skill <skill> --level <level>\n`,
    );
  });

  it('refuses a level that is not a whole number before asking the API', async () => {
    expect(await as('sam', ['mission', 'require', 'MSN-6', '--skill', 'pilot', '--level', 'three'])).toMatchObject({
      code: 2,
      stderr: expect.stringContaining('Give a whole number.'),
    });
  });

  it('says what assigning by hand did, and any problem it made', async () => {
    const ref = await draftNeedingPilot('Vesta Return', '2027-05-20', '2027-05-28', 5);
    expect((await as('sam', ['assignment', 'add', ref, '--crew', 'crw-1', '--skill', 'pilot'])).stdout).toMatch(
      new RegExp(
        `^Assigned Ada Reyes CRW-1 to ${ref} as pilot: ASG-\\d+, proposed\\.\\n {2}✗ clash: also proposed on MSN-4 Ceres Resupply \\(draft, owner Sam Okafor\\)\\n {2}✗ clash: also proposed on MSN-5 Vesta Mapping \\(draft, owner Priya Nair\\)\\n`,
      ),
    );
  });
});

describe('a crew member\'s assignments', () => {
  it('says when there are none', async () => {
    expect((await as('quin', ['assignment', 'list'])).stdout).toBe('You have no offered or accepted assignments.\n');
    expect((await as('quin', ['mission', 'list'])).stdout).toBe('No missions you are offered or accepted on.\n');
  });
});

describe('crew, availability, skills and the organisation', () => {
  it('lists and shows crew with their skills and logins, and adds one with a skill', async () => {
    const list = (await as('sam', ['crew', 'list'])).stdout.split('\n');
    expect(list[0]).toMatch(/^CRW-1 +Ada Reyes +active {2}medic 4; pilot 5$/);
    expect((await as('sam', ['crew', 'show', 'CRW-4'])).stdout).toBe('CRW-4  Noor Haddad  active\nLogin: none\nSkills:\n  engineer 5\n  medic 3, until 10 Mar 2027\n');
    expect((await as('ada', ['crew', 'show', 'me'])).stdout).toContain('Login: ada@artemis.example\n');

    const added = await as('dana', ['crew', 'add', '--name', 'Kai Moss']);
    const [, kai] = /as (CRW-\d+)\./.exec(added.stdout) ?? [];
    expect(added.stdout).toBe(`Added Kai Moss as ${kai}.\nNext: mctl crew skill set ${kai} --skill <skill> --level <level>\n`);
    expect((await as('dana', ['crew', 'show', `${kai}`])).stdout).toBe(`${kai}  Kai Moss  active\nLogin: none\nNo skills yet.\n`);
    expect((await as('dana', ['crew', 'skill', 'set', `${kai}`, '--skill', 'pilot', '--level', '3', '--certified-until', '2028-01-01'])).stdout).toBe(
      `Kai Moss ${kai} holds pilot 3, until 1 Jan 2028.\nNext: mctl crew show ${kai}\n`,
    );
    expect((await as('dana', ['crew', 'list'])).stdout).toContain(`Kai Moss`);
  });

  it('adds, lists and removes an availability block', async () => {
    const added = await as('ada', ['availability', 'add', 'me', '--from', '2027-11-05', '--to', '2027-11-12', '--reason', 'Training']);
    const [, block] = /^Added (AVL-\d+):/.exec(added.stdout) ?? [];
    expect(added.stdout).toBe(`Added ${block}: CRW-1 is unavailable 5–12 Nov 2027.\nNext: mctl availability list me\n`);
    expect((await as('sam', ['availability', 'list', 'CRW-1'])).stdout).toContain(`${block}  5–12 Nov 2027  Training\n`);
    expect((await as('ada', ['availability', 'remove', `${block}`, '--yes'])).stdout).toBe(`Removed ${block}.\n`);
    expect((await as('sam', ['availability', 'list', 'CRW-2'])).stdout).toBe('CRW-2 has no availability blocks, so is available throughout.\n');
  });

  it('lists the skills by category, and shows the organisation\'s settings to a director only', async () => {
    expect((await as('sam', ['skill', 'list'])).stdout).toContain('flight: navigator, pilot\n');
    expect((await as('farid', ['skill', 'list'])).stdout).toContain('field medicine');
    expect((await as('dana', ['org', 'show'])).stdout).toBe(
      'Artemis (artemis)\nApprovals required: 1\nSubmitting with unfilled slots: not allowed\nMatch weights: proficiency 0.45, workload 0.35, rest 0.2\n',
    );
    expect((await as('ines', ['org', 'show'])).stdout).toContain('Approvals required: 2\nSubmitting with unfilled slots: allowed\nMatch weights: proficiency 0.6, workload 0.25, rest 0.15\n');
    expect(await as('sam', ['org', 'show'])).toMatchObject({ code: 4 });
  });
});

/** Every command `mctl` has, as the words that name it: from its own help, so a new command is found. */
async function allCommands(path: string[] = []): Promise<string[][]> {
  const { stdout } = await mctl([...path, '--help'], {});
  const names = [...(stdout.split('Commands:\n')[1] ?? '').matchAll(/^ {2}(\S+)/gm)].map(([, name = '']) => name).filter((name) => name !== 'help');
  if (names.length === 0) return [path];
  return (await Promise.all(names.map((name) => allCommands([...path, name])))).flat();
}

describe('--json', () => {
  it('prints only JSON on standard output, for every command', async () => {
    const offerTo = async (person: Person, missionRef: string) =>
      (await json(as(person, ['assignment', 'list', '--json']), z.array(crewAssignmentSchema))).find(({ mission }) => mission.ref === missionRef)?.ref ?? '';
    const { ref } = await json(as('sam', ['mission', 'create', '--name', 'Ceto Survey', '--from', '2027-12-01', '--to', '2027-12-10', '--json']), missionSchema);
    const kai = (await json(as('dana', ['crew', 'add', '--name', 'Lior Ben', '--json']), crewMemberSchema)).ref;
    const lastRun = async () => (await json(as('sam', ['match', 'run', ref, '--json']), matchRunSchema)).ref;
    const firstCrew = async () => (await crewOf(ref))[0]?.assignment ?? '';
    const firstBlock = async () => (await json(as('dana', ['availability', 'list', kai, '--json']), z.array(availabilityBlockSchema)))[0]?.ref ?? '';
    // Each command, as the person who would run it, in an order that leaves each one something to do.
    const steps: [Person, string, () => Promise<string[]>][] = [
      ['sam', 'mission list', async () => []],
      ['sam', 'mission require', async () => [ref, '--skill', 'medic', '--level', '3']],
      ['sam', 'mission require', async () => [ref, '--skill', 'pilot', '--level', '3']],
      ['sam', 'mission unrequire', async () => [ref, '--skill', 'pilot']],
      ['sam', 'match run', async () => [ref]],
      ['sam', 'match show', async () => [await lastRun()]],
      ['sam', 'match apply', async () => [await lastRun()]],
      ['sam', 'mission show', async () => [ref]],
      ['sam', 'assignment clear', async () => [ref, '--yes']],
      ['sam', 'assignment add', async () => [ref, '--crew', 'CRW-1', '--skill', 'medic']],
      ['sam', 'assignment remove', async () => [await firstCrew(), '--yes']],
      ['sam', 'assignment add', async () => [ref, '--crew', 'CRW-7', '--skill', 'medic']],
      ['sam', 'mission submit', async () => [ref]],
      ['dana', 'mission approve', async () => [ref]],
      ['quin', 'assignment list', async () => []],
      ['quin', 'assignment decline', async () => [await offerTo('quin', ref)]],
      ['sam', 'assignment add', async () => [ref, '--crew', 'CRW-3', '--skill', 'medic']],
      ['mina', 'assignment accept', async () => [await offerTo('mina', ref)]],
      ['sam', 'mission launch', async () => [ref]],
      ['sam', 'mission complete', async () => [ref]],
      ['sam', 'mission history', async () => [ref]],
      ['sam', 'mission create', async () => ['--name', 'Rhea Survey', '--from', '2027-12-01', '--to', '2027-12-05']],
      ['dana', 'mission reject', async () => ['MSN-3', '--note', 'Not now']],
      ['dana', 'mission cancel', async () => ['MSN-3', '--note', 'Dropped', '--yes']],
      ['sam', 'crew list', async () => []],
      ['sam', 'crew show', async () => ['CRW-1']],
      ['dana', 'crew add', async () => ['--name', 'Noa Lund']],
      ['dana', 'crew skill set', async () => [kai, '--skill', 'comms', '--level', '2']],
      ['dana', 'availability add', async () => [kai, '--from', '2028-01-01', '--to', '2028-01-05']],
      ['dana', 'availability list', async () => [kai]],
      ['dana', 'availability remove', async () => [await firstBlock(), '--yes']],
      ['sam', 'skill list', async () => []],
      ['dana', 'org show', async () => []],
      ['sam', 'whoami', async () => []],
      ['sam', 'status', async () => []],
      ['sam', 'profile list', async () => []],
      ['sam', 'profile use', async () => ['sam']],
      ['priya', 'logout', async () => []],
    ];
    for (const [person, command, argsOf] of steps) {
      const args = [...command.split(' '), ...(await argsOf())];
      const ran = await as(person, [...args, '--json']);
      expect({ args, code: ran.code, stderr: ran.stderr }).toEqual({ args, code: 0, stderr: expect.not.stringContaining('Error') });
      expect(() => JSON.parse(ran.stdout)).not.toThrow();
    }
    const login = await mctl(['login', '--org', 'artemis', '--email', 'sam@artemis.example', '--password-stdin', '--json'], { MCTL_CONFIG: join(scratch(), 'config.json'), MCTL_API: api.url() }, { stdin: DEMO_PASSWORD });
    expect(login.code).toBe(0);
    expect(() => JSON.parse(login.stdout)).not.toThrow();

    const covered = new Set(['login', ...steps.map(([, command]) => command)]);
    expect([...covered].sort()).toEqual((await allCommands()).map((words) => words.join(' ')).sort());
  });
});
