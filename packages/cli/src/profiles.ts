import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROLES } from '@mission-control/contract';
import { z } from 'zod';
import { CliError } from './errors.ts';

// Where logins are kept (DESIGN.md section 8, "Login and profiles"): one file, readable only by
// the user, holding a named profile per login and which one is current.

const profileSchema = z.object({
  /** The API's address. */
  api: z.string(),
  /** The organisation's slug and the email, which log back in. */
  org: z.string(),
  email: z.string(),
  /** Who the login acts as, for the "acting as" line. */
  name: z.string(),
  role: z.enum(ROLES),
  organisation: z.string(),
  /** Null once logged out. */
  token: z.string().nullable(),
  expires_at: z.string().nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

const configSchema = z.object({ current: z.string().nullable(), profiles: z.record(z.string(), profileSchema) });
export type Config = z.infer<typeof configSchema>;

export const EMPTY_CONFIG: Config = { current: null, profiles: {} };

/** The config file: `MCTL_CONFIG`, or `~/.config/mctl/config.json`. */
export const configPath = (env: Record<string, string | undefined>, home: string) =>
  env.MCTL_CONFIG || join(home, '.config', 'mctl', 'config.json');

/** The logins kept in the file; none when it does not exist yet. */
export function readConfig(path: string): Config {
  if (!existsSync(path)) return EMPTY_CONFIG;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    parsed = undefined;
  }
  const config = configSchema.safeParse(parsed);
  if (!config.success) throw new CliError('general', `${path} is not a valid mctl config file.`, 'Fix it, or delete it and log in again.');
  return config.data;
}

/**
 * Writes the logins, readable only by the user: the file is 0600 and its folder 0700. The new file
 * is written whole beside the old and renamed over it, so a token is never in a file others can
 * read, and a crash part-way leaves the old logins intact.
 */
export function writeConfig(path: string, config: Config) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fresh = `${path}.${process.pid}.tmp`;
  writeFileSync(fresh, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(fresh, path);
}

/** Keeps a login under a profile name. The first login becomes current. */
export const logIn = (config: Config, name: string, profile: Profile): Config => ({
  current: config.current ?? name,
  profiles: { ...config.profiles, [name]: profile },
});

/** The named profile, which must exist. */
export function requireProfile(config: Config, name: string): Profile {
  const profile = config.profiles[name];
  if (!profile) {
    const names = Object.keys(config.profiles).sort();
    throw new CliError('usage', `There is no profile "${name}".`, names.length > 0 ? `Profiles: ${names.join(', ')}.` : 'Log in first with `mctl login`.');
  }
  return profile;
}

export function useProfile(config: Config, name: string): Config {
  requireProfile(config, name);
  return { ...config, current: name };
}

/** Forgets the tokens of the named profiles. Their organisation and email stay, to log back in. */
export function logOut(config: Config, names: string[]): Config {
  const profiles = { ...config.profiles };
  for (const name of names) profiles[name] = { ...requireProfile(config, name), token: null, expires_at: null };
  return { ...config, profiles };
}

/** The profile a command acts as: `--profile`, then `MCTL_PROFILE`, then the current one. */
export const resolveProfileName = (config: Config, flag: string | undefined, env: Record<string, string | undefined>) =>
  flag ?? env.MCTL_PROFILE ?? config.current;
