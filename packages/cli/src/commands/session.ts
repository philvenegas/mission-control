import { loginResponseSchema, meResponseSchema } from '@mission-control/contract';
import { apiAddress, callApi } from '../api.ts';
import {
  callAsSession,
  type Context,
  describeLogin,
  formatTime,
  loadConfig,
  loginCommand,
  printActingAs,
  printAnswer,
  printNext,
  requireSession,
  saveConfig,
} from '../context.ts';
import { CliError } from '../errors.ts';
import { isTerminal, readHiddenLine } from '../output.ts';
import { logIn, logOut, requireProfile, resolveProfileName } from '../profiles.ts';

/** The name a login is kept under when neither `--profile` nor `MCTL_PROFILE` gives one. */
const DEFAULT_PROFILE = 'default';

export interface LoginOptions {
  org: string;
  email: string;
  api?: string;
  passwordStdin?: boolean;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += String(chunk);
  return text;
}

/**
 * The password: the first line of standard input with `--password-stdin`, else asked for with a
 * hidden prompt. There is no flag for it, so a password never lands in shell history.
 */
async function readPassword({ io }: Context, fromStdin: boolean): Promise<string> {
  const { stdin } = io;
  if (fromStdin) {
    const [password = ''] = (await readAll(stdin)).split(/\r?\n/);
    if (!password) throw new CliError('usage', 'No password was given on standard input.');
    return password;
  }
  if (!isTerminal(stdin)) throw new CliError('usage', 'There is no terminal to ask for the password.', 'Pipe it in with --password-stdin.');
  return readHiddenLine(stdin, io.stderr, 'Password: ');
}

export async function login(context: Context, options: LoginOptions): Promise<number> {
  const api = apiAddress(options.api, context.io.env);
  const password = await readPassword(context, options.passwordStdin === true);
  const answer = await callApi(api, { method: 'POST', path: '/v1/auth/login', body: { org: options.org, email: options.email, password } }, loginResponseSchema);
  const { user, organisation, token, expires_at: expiresAt } = answer.data;
  const config = loadConfig(context);
  const name = context.profileFlag ?? context.io.env.MCTL_PROFILE ?? DEFAULT_PROFILE;
  const profile = { api, org: organisation.slug, email: user.email, name: user.name, role: user.role, organisation: organisation.name, token, expires_at: expiresAt };
  const saved = logIn(config, name, profile);
  saveConfig(context, saved);
  printActingAs(context, profile);
  printAnswer(context, answer.raw, [
    `Logged in to ${organisation.name} as ${user.name}. Saved as profile "${name}"${saved.current === name ? ', the current one' : ''}.`,
    `The login expires at ${formatTime(expiresAt)}.`,
  ]);
  printNext(context, saved.current === name ? 'mctl whoami' : `mctl profile use ${name}`);
  return 0;
}

export async function whoami(context: Context): Promise<number> {
  const session = requireSession(context);
  const { name, profile } = session;
  printActingAs(context, profile);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: '/v1/me' }, meResponseSchema);
  printAnswer(context, raw, [
    `${data.user.name} <${data.user.email}>`,
    `${describeLogin({ ...profile, name: data.user.name, role: data.user.role, organisation: data.organisation.name })}`,
    `Profile "${name}" at ${profile.api}; the login expires at ${formatTime(profile.expires_at)}.`,
  ]);
  return 0;
}

export function logout(context: Context, options: { all?: boolean }): number {
  const config = loadConfig(context);
  if (options.all) {
    const names = Object.keys(config.profiles);
    saveConfig(context, logOut(config, names));
    printAnswer(context, { logged_out: names }, [`Logged out of ${names.length} profile${names.length === 1 ? '' : 's'}.`]);
    return 0;
  }
  // Not a session: an expired login can be logged out too.
  const name = resolveProfileName(config, context.profileFlag, context.io.env);
  if (name === null) throw new CliError('unauthenticated', 'You are not logged in.', 'Log in with `mctl login --org <slug> --email <email>`.');
  const profile = requireProfile(config, name);
  printActingAs(context, profile);
  saveConfig(context, logOut(config, [name]));
  printAnswer(context, { logged_out: [name] }, [`Logged out of profile "${name}".`]);
  printNext(context, loginCommand(name, profile));
  return 0;
}
