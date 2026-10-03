import { homedir } from 'node:os';
import { run } from './run.ts';

// `mctl`, as `bin/mctl` runs it.
process.exitCode = await run(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, env: process.env, home: homedir() });
