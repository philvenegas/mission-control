import type { z } from 'zod';
import { type ApiRequest, callApi, DEFAULT_API } from './api.ts';
import { type Context, loadConfig } from './context.ts';
import { CliError } from './errors.ts';
import { formatTime } from './output/print.ts';
import { type Config, type Profile, resolveProfileName } from './profiles.ts';

// The profile a command acts as, and whether it is logged in.

/** What to do with no login at all. */
export const LOG_IN = 'Log in with `mctl login --org <slug> --email <email>`.';

/** The exact command that logs a profile back in, its API address included unless it is the default. */
export const logInCommand = (name: string, profile: Pick<Profile, 'org' | 'email' | 'api'>) =>
  `mctl login --org ${profile.org} --email ${profile.email} --profile ${name}${profile.api === DEFAULT_API ? '' : ` --api ${profile.api}`}`;

const logInAgain = (name: string, profile: Profile) => `Log in again: ${logInCommand(name, profile)}`;

/** The profile a command acts as, if there is one: `--profile`, then `MCTL_PROFILE`, then the current one. */
export function actingProfile(context: Context, config: Config): { name: string; profile: Profile | undefined } | null {
  const name = resolveProfileName(config, context.profileFlag, context.io.env);
  return name === null ? null : { name, profile: config.profiles[name] };
}

/** The profile a command acts as, which must exist; it may be logged out. */
export function requireActingProfile(context: Context, config: Config): { name: string; profile: Profile } {
  const acting = actingProfile(context, config);
  if (!acting) throw new CliError('unauthenticated', 'You are not logged in.', LOG_IN);
  if (!acting.profile) throw new CliError('unauthenticated', `There is no profile "${acting.name}".`, LOG_IN);
  return { name: acting.name, profile: acting.profile };
}

/** A profile with a login: the token it acts with. */
export interface Session {
  name: string;
  profile: Profile & { token: string; expires_at: string };
}

/**
 * The profile the command acts as, logged in and unexpired. An expired login is caught here, before
 * the API is asked, so the answer can name the command that logs back in; the API remains the
 * authority, and a token it refuses is caught in `callAsSession`.
 */
export function requireSession(context: Context, config = loadConfig(context)): Session {
  const { name, profile } = requireActingProfile(context, config);
  const { token, expires_at: expiresAt } = profile;
  if (token === null || expiresAt === null) throw new CliError('unauthenticated', `Profile "${name}" is logged out.`, logInAgain(name, profile));
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new CliError('unauthenticated', `Your login for profile "${name}" expired at ${formatTime(expiresAt)}.`, logInAgain(name, profile));
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
      throw new CliError('unauthenticated', `The API no longer accepts the login of profile "${session.name}".`, logInAgain(session.name, session.profile));
    }
    throw error;
  }
}
