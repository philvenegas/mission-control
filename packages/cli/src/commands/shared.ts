import type { Mission } from '@mission-control/contract';
import { InvalidArgumentError } from 'commander';
import type { Context } from '../context.ts';
import { CliError } from '../errors.ts';
import { nextForMission } from '../output/mission.ts';
import { printActingAs, printNext } from '../output/print.ts';
import { paint } from '../output/style.ts';
import { confirm } from '../prompt.ts';
import { requireSession, type Session } from '../session.ts';

// What the commands that call the API share.

/** Turns a command into a Commander action, given the context when it runs. */
export type Perform = <Args extends unknown[]>(command: (context: Context, ...args: Args) => Promise<number>) => (...args: Args) => Promise<void>;

/** The logged-in profile a command acts as, after saying who that is. */
export function startSession(context: Context): Session {
  const session = requireSession(context);
  printActingAs(context, session.profile);
  return session;
}

/** `--yes`: go ahead without asking first. */
export interface YesOption {
  yes?: boolean;
}

/** After a change to a mission: the command its state now calls for, if any. */
export function printNextFor(context: Context, mission: Mission) {
  const next = nextForMission(mission);
  if (next) printNext(context, next);
}

/** Styles text for standard output. */
export const styleOf = (context: Context) => paint(context.io.stdout, context.io.env);

/** An API path, each part encoded: a skill's name may hold a space. */
export const apiPath = (...parts: string[]) => `/v1/${parts.map(encodeURIComponent).join('/')}`;

/** A whole number given on the command line, such as a level or a headcount. */
export function wholeNumber(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new InvalidArgumentError('Give a whole number.');
  return number;
}

/**
 * Asks before a destructive change, unless `--yes` was given (DESIGN.md section 8). With no terminal
 * to ask on, it refuses rather than guess.
 */
export async function askFirst(context: Context, yes: boolean | undefined, command: string, question: string) {
  if (yes) return;
  const cannotAsk = new CliError('usage', `${command} asks before it changes anything, and there is no terminal to ask on.`, 'Add --yes to go ahead without being asked.');
  await confirm(context.io.stdin, context.io.stderr, question, cannotAsk);
}
