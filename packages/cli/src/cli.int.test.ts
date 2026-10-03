import { statSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { loginResponseSchema, meResponseSchema } from '@mission-control/contract';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEMO_PASSWORD as PASSWORD } from '../../api/src/db/seed-data.ts';
import { logIn, readConfig, writeConfig } from './profiles.ts';
import { mctl, scratch, useRunningApi } from './test/api.ts';

const api = useRunningApi();

const SAM_LOGIN = ['login', '--org', 'artemis', '--email', 'sam@artemis.example', '--password-stdin'];
const DANA_LOGIN = ['login', '--org', 'artemis', '--email', 'dana@artemis.example', '--password-stdin'];

/** Each test has a config file of its own, and the API under test. */
let configFile: string;
let env: Record<string, string>;
beforeEach(() => {
  configFile = join(scratch(), 'config.json');
  env = { MCTL_CONFIG: configFile, MCTL_API: api.url() };
});

const run = (args: string[], options: Parameters<typeof mctl>[2] = {}) => mctl(args, env, options);
const logInAs = (login: string[], profile: string) => run([...login, '--profile', profile], { stdin: `${PASSWORD}\n` });

describe('mctl login', () => {
  it('logs in with the password from standard input, keeps the login as the current profile, and says who it acts as', async () => {
    const ran = await logInAs(SAM_LOGIN, 'lead');
    expect(ran.code).toBe(0);
    expect(ran.stderr).toBe('as Sam Okafor · mission lead · Artemis\n');
    expect(ran.stdout).toMatch(/^Logged in to Artemis as Sam Okafor\. Saved as profile "lead", the current one\.\nThe login expires at \d{4}-\d\d-\d\d \d\d:\d\d UTC\.\nNext: mctl whoami\n$/);
    const { current, profiles } = readConfig(configFile);
    expect(current).toBe('lead');
    expect(profiles.lead).toMatchObject({ api: api.url(), org: 'artemis', email: 'sam@artemis.example', name: 'Sam Okafor', role: 'mission_lead', organisation: 'Artemis' });
    expect(profiles.lead?.token).toEqual(expect.any(String));
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
  });

  it('keeps the first login current, names a profile "default" unless told, and takes MCTL_PROFILE as the name', async () => {
    await logInAs(SAM_LOGIN, 'lead');
    const second = await run(DANA_LOGIN, { stdin: PASSWORD });
    expect(second.stdout).toContain('Saved as profile "default".');
    expect(second.stdout).toContain('Next: mctl profile use default');
    await run(DANA_LOGIN, { stdin: PASSWORD, env: { MCTL_PROFILE: 'director' } });
    expect(Object.keys(readConfig(configFile).profiles).sort()).toEqual(['default', 'director', 'lead']);
    expect(readConfig(configFile).current).toBe('lead');
  });

  it('asks for the password with a hidden prompt on a terminal', async () => {
    const terminal = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => terminal });
    const ran = run(['login', '--org', 'artemis', '--email', 'sam@artemis.example'], { stdin: terminal });
    setTimeout(() => terminal.write(`${PASSWORD}\r`), 10);
    const { code, stderr } = await ran;
    expect(code).toBe(0);
    expect(stderr).toBe('Password: \nas Sam Okafor · mission lead · Artemis\n');
  });

  it('has no --password flag, and without a terminal needs --password-stdin', async () => {
    const flagged = await run(['login', '--org', 'artemis', '--email', 'sam@artemis.example', '--password', PASSWORD]);
    expect(flagged).toMatchObject({ code: 2, stderr: "error: unknown option '--password'\n" });
    const piped = await run(['login', '--org', 'artemis', '--email', 'sam@artemis.example']);
    expect(piped).toEqual({ code: 2, stdout: '', stderr: 'Error: There is no terminal to ask for the password.\n  Pipe it in with --password-stdin.\n' });
    expect(await run(SAM_LOGIN, { stdin: '\n' })).toMatchObject({ code: 2, stderr: 'Error: No password was given on standard input.\n' });
    // A terminal would echo the password as it was typed.
    const terminal = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => terminal });
    expect(await run(SAM_LOGIN, { stdin: terminal })).toEqual({
      code: 2,
      stdout: '',
      stderr: 'Error: --password-stdin reads the password from a pipe, not a terminal.\n  Leave it out to be asked for the password.\n',
    });
  });

  it('prints the API\'s refusal with its hint, exits 3, and keeps nothing', async () => {
    const ran = await run(SAM_LOGIN, { stdin: 'wrong' });
    expect(ran).toEqual({ code: 3, stdout: '', stderr: 'Error: Invalid organisation, email or password.\n  Check all three and try again.\n' });
    expect(readConfig(configFile).profiles).toEqual({});
  });

  it('prints the API\'s answer as it came with --json, and nothing else on standard output', async () => {
    const ran = await run([...SAM_LOGIN, '--json'], { stdin: PASSWORD });
    expect(loginResponseSchema.parse(JSON.parse(ran.stdout)).user.name).toBe('Sam Okafor');
    expect(ran.stderr).toBe('as Sam Okafor · mission lead · Artemis\n');
  });

  it('keeps the API address it was given, with --api over MCTL_API', async () => {
    await run([...SAM_LOGIN, '--api', `${api.url()}/`], { stdin: PASSWORD, env: { MCTL_API: 'http://localhost:1' } });
    expect(readConfig(configFile).profiles.default?.api).toBe(api.url());
  });
});

describe('acting as a profile', () => {
  beforeEach(async () => {
    await logInAs(SAM_LOGIN, 'lead');
    await logInAs(DANA_LOGIN, 'director');
  });

  it('whoami says who commands act as, after the acting-as line on the error stream', async () => {
    const ran = await run(['whoami']);
    expect(ran.code).toBe(0);
    expect(ran.stderr).toBe('as Sam Okafor · mission lead · Artemis\n');
    expect(ran.stdout).toMatch(/^Sam Okafor <sam@artemis\.example>\nSam Okafor · mission lead · Artemis\nProfile "lead" at http:\/\/localhost:\d+; the login expires at .+ UTC\.\n$/);
    const json = await run(['whoami', '--json']);
    expect(meResponseSchema.parse(JSON.parse(json.stdout))).toEqual({
      user: { email: 'sam@artemis.example', name: 'Sam Okafor', role: 'mission_lead' },
      organisation: { slug: 'artemis', name: 'Artemis' },
    });
  });

  it('acts as --profile, then MCTL_PROFILE, then the current profile, for one command', async () => {
    expect((await run(['whoami', '--profile', 'director'], { env: { MCTL_PROFILE: 'lead' } })).stderr).toBe('as Dana Okoye · director · Artemis\n');
    expect((await run(['whoami'], { env: { MCTL_PROFILE: 'director' } })).stderr).toBe('as Dana Okoye · director · Artemis\n');
    expect(readConfig(configFile).current).toBe('lead');
  });

  it('lists every profile, marking the current one, and never prints a token', async () => {
    const ran = await run(['profile', 'list']);
    expect(ran.stdout).toMatch(/^ {2}director {2}Dana Okoye · director · Artemis {2}dana@artemis\.example {2}expires .+ UTC\n\* lead {6}Sam Okafor · mission lead · Artemis {2}sam@artemis\.example {2}expires .+ UTC\n$/);
    const json = z.array(z.object({ name: z.string(), current: z.boolean() }).loose()).parse(JSON.parse((await run(['profile', 'list', '--json'])).stdout));
    expect(json.map(({ name, current }) => [name, current])).toEqual([['director', false], ['lead', true]]);
    const { profiles } = readConfig(configFile);
    for (const profile of Object.values(profiles)) expect((await run(['profile', 'list', '--json'])).stdout).not.toContain(profile.token);
  });

  it('switches the current profile, and refuses one that does not exist', async () => {
    const used = await run(['profile', 'use', 'director']);
    expect(used).toEqual({ code: 0, stdout: 'Profile "director" is now current.\nNext: mctl whoami\n', stderr: 'as Dana Okoye · director · Artemis\n' });
    expect((await run(['whoami'])).stderr).toBe('as Dana Okoye · director · Artemis\n');
    expect(await run(['profile', 'use', 'ada'])).toEqual({ code: 2, stdout: '', stderr: 'Error: There is no profile "ada".\n  Profiles: director, lead.\n' });
  });

  it('logs out of the current profile, or of every one, and then says how to log back in', async () => {
    expect((await run(['logout'])).stdout).toBe(`Logged out of profile "lead".\nNext: mctl login --org artemis --email sam@artemis.example --profile lead --api ${api.url()}\n`);
    expect(await run(['whoami'])).toEqual({
      code: 3,
      stdout: '',
      stderr: `Error: Profile "lead" is logged out.\n  Log in again: mctl login --org artemis --email sam@artemis.example --profile lead --api ${api.url()}\n`,
    });
    expect((await run(['whoami', '--profile', 'director'])).code).toBe(0);
    expect((await run(['logout', '--all'])).stdout).toBe('Logged out of 2 profiles.\n');
    expect((await run(['logout', '--all'], { env: { MCTL_CONFIG: join(scratch(), 'none.json') } })).stdout).toBe('Logged out of 0 profiles.\n');
    expect((await run(['whoami', '--profile', 'director'])).code).toBe(3);
    expect((await run(['profile', 'list'])).stdout).toContain('logged out');
  });

  it('exits 3 on an expired login, printing the exact command to log back in', async () => {
    const config = readConfig(configFile);
    const lead = config.profiles.lead;
    if (!lead) throw new Error('No lead profile');
    writeConfig(configFile, logIn(config, 'lead', { ...lead, expires_at: '2026-01-01T00:00:00.000Z' }));
    expect(await run(['whoami'])).toEqual({
      code: 3,
      stdout: '',
      stderr: `Error: Your login for profile "lead" expired at 2026-01-01 00:00 UTC.\n  Log in again: mctl login --org artemis --email sam@artemis.example --profile lead --api ${api.url()}\n`,
    });
    expect((await run(['status'])).stdout).toContain('Login    expired 2026-01-01 00:00 UTC');
  });

  it('exits 3 when the API no longer accepts the token, with the API\'s message', async () => {
    const config = readConfig(configFile);
    const lead = config.profiles.lead;
    if (!lead) throw new Error('No lead profile');
    writeConfig(configFile, logIn(config, 'lead', { ...lead, token: 'not-a-token' }));
    expect(await run(['whoami'])).toEqual({
      code: 3,
      stdout: '',
      stderr:
        'as Sam Okafor · mission lead · Artemis\nError: The API no longer accepts the login of profile "lead".\n' +
        `  Log in again: mctl login --org artemis --email sam@artemis.example --profile lead --api ${api.url()}\n`,
    });
  });

  it('says when the API a profile uses cannot be reached', async () => {
    const config = readConfig(configFile);
    const lead = config.profiles.lead;
    if (!lead) throw new Error('No lead profile');
    writeConfig(configFile, logIn(config, 'lead', { ...lead, api: 'http://localhost:1' }));
    expect(await run(['whoami'])).toMatchObject({ code: 1, stderr: expect.stringContaining('Error: Cannot reach the API at http://localhost:1.') });
  });

  it('is told plainly when nobody is logged in', async () => {
    expect(await run(['whoami'], { env: { MCTL_CONFIG: join(scratch(), 'none.json') } })).toEqual({
      code: 3,
      stdout: '',
      stderr: 'Error: You are not logged in.\n  Log in with `mctl login --org <slug> --email <email>`.\n',
    });
    expect((await run(['whoami', '--profile', 'nobody'])).stderr).toBe('Error: There is no profile "nobody".\n  Log in with `mctl login --org <slug> --email <email>`.\n');
    const empty = { env: { MCTL_CONFIG: join(scratch(), 'none.json') } };
    expect(await run(['logout'], empty)).toMatchObject({ code: 3, stderr: expect.stringContaining('You are not logged in.') });
    expect(await run(['logout', '--profile', 'nobody'])).toMatchObject({ code: 3, stderr: expect.stringContaining('There is no profile "nobody".') });
    expect(await run(['profile', 'list'], empty)).toEqual({ code: 0, stdout: 'No profiles yet. Log in with `mctl login --org <slug> --email <email>`.\n', stderr: '' });
  });
});

describe('mctl status', () => {
  it('reports the API, whether it answers, the profile acted as and when its login expires', async () => {
    await logInAs(SAM_LOGIN, 'lead');
    const ran = await run(['status']);
    expect(ran.code).toBe(0);
    expect(ran.stdout).toMatch(
      new RegExp(`^API {6}${api.url()} {2}reachable\\nProfile {2}lead: Sam Okafor · mission lead · Artemis\\nLogin {4}expires .+ UTC\\n$`),
    );
    expect(JSON.parse((await run(['status', '--json'])).stdout)).toMatchObject({ api: api.url(), reachable: true, profile: 'lead' });
  });

  it('needs no login, and says how to log in', async () => {
    const ran = await run(['status']);
    expect(ran).toEqual({
      code: 0,
      stdout: `API      ${api.url()}  reachable\nProfile  none. Log in with \`mctl login --org <slug> --email <email>\`.\n`,
      stderr: '',
    });
  });
});

describe('an API that cannot be reached', () => {
  it('is said plainly, naming the command that starts it, and exits 1', async () => {
    const unreachable = { MCTL_API: 'http://localhost:1' };
    expect(await run(SAM_LOGIN, { stdin: PASSWORD, env: unreachable })).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Error: Cannot reach the API at http://localhost:1.\n  Start it with `pnpm api`, in a terminal of its own, or check the address with `mctl status`.\n',
    });
    const status = await run(['status'], { env: unreachable });
    expect(status.code).toBe(1);
    expect(status.stdout).toContain('API      http://localhost:1  not reachable: start it with `pnpm api`');
  });
});

describe('colour', () => {
  it('is used only when writing to a terminal', async () => {
    const coloured = await run(SAM_LOGIN, { stdin: PASSWORD, terminal: true });
    expect(coloured.stderr).toBe('\u001b[2mas Sam Okafor · mission lead · Artemis\u001b[22m\n');
    expect(coloured.stdout).toContain('\u001b[2mNext: mctl whoami\u001b[22m');
    const failed = await run(['whoami', '--profile', 'nobody'], { terminal: true });
    expect(failed.stderr.startsWith('\u001b[31mError:\u001b[39m ')).toBe(true);
  });
});

describe('usage', () => {
  it('shows help with exit 0, and exits 2 on a command or option it does not know', async () => {
    expect(await run(['--help'])).toMatchObject({ code: 0, stdout: expect.stringContaining('Usage: mctl') });
    expect(await run(['launch-everything'])).toMatchObject({ code: 2, stderr: "error: unknown command 'launch-everything'\n" });
    expect(await run(['login', '--email', 'sam@artemis.example'])).toMatchObject({ code: 2, stderr: "error: required option '--org <slug>' not specified\n" });
  });
});
