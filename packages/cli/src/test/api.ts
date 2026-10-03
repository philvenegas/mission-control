import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect } from 'vitest';
import type { z } from 'zod';
// Loads .env, as the API does.
import { requireEnv } from '../../../api/src/env.ts';
import type { Io } from '../context.ts';
import { run } from '../run.ts';

// The CLI's tests run it against the real API, as a separate process on the test database: the CLI
// only ever talks to the API over HTTP, so that is how it is tested.

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TSX = join(ROOT, 'node_modules/.bin/tsx');

/** A port nothing is listening on. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer().listen(0, () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('No port'))));
    });
  });

/** Seeds the test database, then starts the API on it, for the tests of one file. */
export function useRunningApi() {
  let api: ChildProcess | undefined;
  let url = '';
  beforeAll(async () => {
    await promisify(execFile)(TSX, [join(ROOT, 'packages/api/src/db/seed.ts')], {
      env: { ...process.env, DATABASE_OWNER_URL: requireEnv('TEST_DATABASE_OWNER_URL') },
    });
    const port = await freePort();
    const started = spawn(TSX, [join(ROOT, 'packages/api/src/server.ts')], {
      env: { ...process.env, DATABASE_URL: requireEnv('TEST_DATABASE_URL'), PORT: String(port), TOKEN_TTL: '1h' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    api = started;
    await new Promise<void>((resolve, reject) => {
      started.stdout.on('data', (chunk) => String(chunk).includes('listening') && resolve());
      started.on('exit', (code) => reject(new Error(`The API exited with ${code} before it was listening`)));
    });
    url = `http://localhost:${port}`;
  }, 30_000);
  afterAll(() => {
    api?.kill();
  });
  return { url: () => url };
}

/** What a command wrote, and how it exited. */
export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MctlOptions {
  /** Standard input: text piped in, or a stream such as a fake terminal. */
  stdin?: string | Io['stdin'];
  env?: Record<string, string | undefined>;
  /** Whether the output streams are a terminal, which turns on colour. */
  terminal?: boolean;
}

/** A fresh, empty folder for one test's config file. */
export const scratch = () => mkdtempSync(join(tmpdir(), 'mctl-'));

/** Runs `mctl` in this process, as the shell would, with its own config file and API address. */
export async function mctl(args: string[], env: Record<string, string | undefined>, options: MctlOptions = {}): Promise<Ran> {
  let stdout = '';
  let stderr = '';
  const stdin = typeof options.stdin === 'object' ? options.stdin : Readable.from([options.stdin ?? '']);
  const code = await run(args, {
    stdout: { write: (text) => void (stdout += text), isTTY: options.terminal },
    stderr: { write: (text) => void (stderr += text), isTTY: options.terminal },
    stdin,
    env: { ...env, ...options.env },
    home: scratch(),
  });
  return { code, stdout, stderr };
}

/** The --json answer of a command that succeeded, read with its contract schema. */
export async function json<Schema extends z.ZodType>(ran: Promise<Ran>, schema: Schema): Promise<z.infer<Schema>> {
  const { code, stdout } = await ran;
  expect(code).toBe(0);
  return schema.parse(JSON.parse(stdout));
}
