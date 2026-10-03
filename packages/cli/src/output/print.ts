import type { Role } from '@mission-control/contract';
import type { Context, Io } from '../context.ts';
import type { CliError } from '../errors.ts';
import type { Profile } from '../profiles.ts';
import { paint } from './style.ts';

// Everything a command writes: its answer on standard output, and who it acted as and what went
// wrong on the error stream, so `--json` and pipes stay clean.

const ROLE_NAMES: Record<Role, string> = { director: 'director', mission_lead: 'mission lead', crew_member: 'crew member' };

/** Who a profile acts as, in words: "Sam Okafor · mission lead · Artemis". */
export const describeLogin = (profile: Pick<Profile, 'name' | 'role' | 'organisation'>) =>
  `${profile.name} · ${ROLE_NAMES[profile.role]} · ${profile.organisation}`;

/** A moment as a person reads it, in UTC: "2026-10-10 12:00 UTC". */
export const formatTime = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The dim line a command prints first, saying who it acts as. */
export function printActingAs(context: Context, profile: Profile) {
  context.io.stderr.write(`${paint(context.io.stderr, context.io.env)('dim', `as ${describeLogin(profile)}`)}\n`);
}

/** A command's answer: as the API sent it with `--json`, else lines for a person. */
export function printAnswer(context: Context, raw: unknown, lines: string[]) {
  context.io.stdout.write(context.json ? `${JSON.stringify(raw, null, 2)}\n` : lines.map((line) => `${line}\n`).join(''));
}

/** The likely next command, for a person; nothing with `--json`. */
export function printNext(context: Context, command: string) {
  if (!context.json) context.io.stdout.write(`${paint(context.io.stdout, context.io.env)('dim', `Next: ${command}`)}\n`);
}

export function printError(io: Io, error: CliError) {
  const style = paint(io.stderr, io.env);
  io.stderr.write(`${style('red', 'Error:')} ${error.message}\n${error.hint ? `  ${error.hint}\n` : ''}`);
}
