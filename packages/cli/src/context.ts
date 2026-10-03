import { type Role } from '@mission-control/contract';
import type { z } from 'zod';
import { type ApiRequest, callApi } from './api.ts';
import { CliError } from './errors.ts';
import { type Output, paint, type Terminal } from './output.ts';
import { type Config, type Profile, readConfig, resolveProfileName, writeConfig } from './profiles.ts';

// What every command is given, and what they share: the profile acted as, the "acting as" line,
// and printing.

/** The process's streams and settings, passed in so a test can stand in for them. */
export interface Io {
  stdout: Output;
  stderr: Output;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: Terminal['setRawMode'] };
  env: Record<string, string | undefined>;
  /** The user's home folder, where the config file lives by default. */
  home: string;
}

export interface Context {
  io: Io;
  /** Print the API's answer as it came, and nothing else, on standard output. */
  json: boolean;
  /** `--profile`, when given. */
  profileFlag: string | undefined;
  configFile: string;
}

/** A profile with a login: the token it acts with. */
export interface Session {
  name: string;
  profile: Profile & { token: string; expires_at: string };
}

const ROLE_NAMES: Record<Role, string> = { director: 'director', mission_lead: 'mission lead', crew_member: 'crew member' };

/** Who a profile acts as, in words: "Sam Okafor · mission lead · Artemis". */
export const describeLogin = (profile: Profile) => `${profile.name} · ${ROLE_NAMES[profile.role]} · ${profile.organisation}`;

/** A timestamp as a person reads it: "2026-10-10 12:00 UTC". */
export const formatTime = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** The exact command that logs a profile back in. */
export const loginCommand = (name: string, profile: Pick<Profile, 'org' | 'email'>) =>
  `mctl login --org ${profile.org} --email ${profile.email} --profile ${name}`;

export const loadConfig = (context: Context): Config => readConfig(context.configFile);
export const saveConfig = (context: Context, config: Config) => writeConfig(context.configFile, config);

/**
 * The profile the command acts as, logged in and unexpired. Refused, with the command that logs in
 * again, when there is none.
 */
export function requireSession(context: Context, config = loadConfig(context)): Session {
  const name = resolveProfileName(config, context.profileFlag, context.io.env);
  const profile = name === null ? undefined : config.profiles[name];
  if (name === null || !profile) {
    throw new CliError(
      'unauthenticated',
      name === null ? 'You are not logged in.' : `There is no profile "${name}".`,
      'Log in with `mctl login --org <slug> --email <email>`.',
    );
  }
  const { token, expires_at: expiresAt } = profile;
  if (token === null || expiresAt === null) {
    throw new CliError('unauthenticated', `Profile "${name}" is logged out.`, `Log in again: ${loginCommand(name, profile)}`);
  }
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new CliError('unauthenticated', `Your login for profile "${name}" expired at ${formatTime(expiresAt)}.`, `Log in again: ${loginCommand(name, profile)}`);
  }
  return { name, profile: { ...profile, token, expires_at: expiresAt } };
}

/**
 * Calls the API as the session's user. A token the API no longer accepts (its user removed, its
 * secret changed) is refused with the command that logs this profile back in.
 */
export async function callAsSession<Schema extends z.ZodType>(session: Session, request: Omit<ApiRequest, 'token'>, schema: Schema) {
  try {
    return await callApi(session.profile.api, { ...request, token: session.profile.token }, schema);
  } catch (error) {
    if (error instanceof CliError && error.failure === 'unauthenticated') {
      throw new CliError('unauthenticated', `The API no longer accepts the login of profile "${session.name}".`, `Log in again: ${loginCommand(session.name, session.profile)}`);
    }
    throw error;
  }
}

/** The dim line every command prints first, on the error stream so `--json` and pipes stay clean. */
export function printActingAs(context: Context, profile: Profile) {
  context.io.stderr.write(`${paint(context.io.stderr, context.io.env)('dim', `as ${describeLogin(profile)}`)}\n`);
}

/** A command's answer: the API's own with `--json`, else lines for a person. */
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
