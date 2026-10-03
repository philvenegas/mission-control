import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEMO_PASSWORD } from '../../api/src/db/seed-data.ts';
import { requireEnv } from '../../api/src/env.ts';
import type { Io } from './context.ts';
import { run } from './run.ts';
import { ROOT, scratch, useRunningApi } from './test/api.ts';
import { readWalkthrough, type WalkthroughStep } from './test/readme.ts';

// The README's walk-through, run exactly as written, twice: `pnpm demo:reset` and `pnpm demo:login`
// first, then each command, which must exit and print as the README shows. The second pass proves
// the reset returns the walk-through to a clean state.

const api = useRunningApi();
const acts = readWalkthrough(readFileSync(join(ROOT, 'README.md'), 'utf8'));
const exec = promisify(execFile);

/** The address the README's commands use, which the test's API stands in for. */
const DEFAULT_API = 'http://localhost:3000';
/** A time a command prints, such as when a login expires, which differs between runs. */
const TIME = /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\b/g;

/** Output as the README shows it: times stood in for, the default address, no trailing spaces. */
const asShown = (output: string, apiUrl: string) =>
  output.replaceAll(apiUrl, DEFAULT_API).replace(TIME, '<time>').split('\n').map((line) => line.trimEnd()).join('\n').trimEnd();

/**
 * Runs one command as a person at a terminal would see it: both streams in the order written. A
 * login without `--password-stdin` asks for the password; the terminal types the demo password.
 */
async function runAsShown(step: WalkthroughStep, env: { MCTL_CONFIG: string; MCTL_API: string }) {
  let written = '';
  const asksForPassword = step.args[0] === 'login' && !step.args.includes('--password-stdin');
  const terminal = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => terminal });
  const write = (text: string) => {
    written += text;
    if (asksForPassword && text === 'Password: ') terminal.write(`${DEMO_PASSWORD}\r`);
  };
  const io: Io = { stdout: { write }, stderr: { write }, stdin: asksForPassword ? terminal : Readable.from(['']), env, home: scratch() };
  const exitCode = await run(step.args, io);
  return { command: step.command, exitCode, output: asShown(written, env.MCTL_API) };
}

/** Runs a repository script as the README says to, against the test database and API. */
const script = (name: string, env: Record<string, string>) => exec('pnpm', ['--silent', name], { cwd: ROOT, env: { ...process.env, ...env } });

describe('the README walk-through', () => {
  // DESIGN.md section 8 gives the walk-through three acts.
  it('has the three acts', () => {
    expect(acts).toHaveLength(3);
  });

  for (const pass of ['first', 'second']) {
    it(`runs exactly as written, printing what the README shows (${pass} pass, after pnpm demo:reset)`, async () => {
      const env = { MCTL_CONFIG: join(scratch(), 'config.json'), MCTL_API: api.url() };
      await script('demo:reset', { DATABASE_OWNER_URL: requireEnv('TEST_DATABASE_OWNER_URL') });
      await script('demo:login', env);
      for (const step of acts.flat()) {
        expect(await runAsShown(step, env)).toEqual({ command: step.command, exitCode: step.exitCode, output: asShown(step.output, api.url()) });
      }
    }, 60_000);
  }
});
