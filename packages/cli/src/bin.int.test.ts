import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ROOT, scratch, useRunningApi } from './test/api.ts';

// The CLI as a person runs it: `bin/mctl` and `pnpm demo:login`, as processes.

const api = useRunningApi();
const exec = promisify(execFile);

const shell = (command: string, args: string[], env: Record<string, string>) =>
  exec(command, args, { cwd: ROOT, env: { ...process.env, ...env } }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
  );

describe('bin/mctl', () => {
  it('runs the CLI from the repository, with its exit code', async () => {
    const env = { MCTL_CONFIG: join(scratch(), 'config.json'), MCTL_API: api.url() };
    expect(await shell('bin/mctl', ['status'], env)).toMatchObject({ code: 0, stdout: expect.stringContaining('reachable') });
    expect(await shell('bin/mctl', ['whoami'], env)).toMatchObject({ code: 3, stderr: expect.stringContaining('You are not logged in.') });
  });
});

describe('pnpm demo:login', () => {
  it('logs in as the six demo users, one profile each, with lead current', async () => {
    const env = { MCTL_CONFIG: join(scratch(), 'config.json'), MCTL_API: api.url() };
    const ran = await shell('pnpm', ['--silent', 'demo:login'], env);
    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('current profile: lead');
    const listed = await shell('bin/mctl', ['profile', 'list', '--json'], env);
    const profiles = z.array(z.object({ name: z.string(), current: z.boolean(), email: z.string() })).parse(JSON.parse(listed.stdout));
    expect(profiles.map(({ name, current, email }) => [name, current, email])).toEqual([
      ['ada', false, 'ada@artemis.example'],
      ['director', false, 'dana@artemis.example'],
      ['helios', false, 'farid@helios.example'],
      ['lead', true, 'sam@artemis.example'],
      ['mina', false, 'mina@artemis.example'],
      ['quin', false, 'quin@artemis.example'],
    ]);
  }, 30_000);
});
