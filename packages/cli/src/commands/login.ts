import { loginResponseSchema, meResponseSchema } from '@mission-control/contract';
import { apiAddress, callApi } from '../api.ts';
import { type Context, loadConfig, saveConfig } from '../context.ts';
import { CliError } from '../errors.ts';
import { describeLogin, formatTime, printActingAs, printAnswer, printNext } from '../output/print.ts';
import { logIn, logOut } from '../profiles.ts';
import { isTerminal, readHiddenLine } from '../prompt.ts';
import { callAsSession, logInCommand, requireActingProfile, requireSession } from '../session.ts';

// The login: `mctl login`, `mctl whoami` and `mctl logout`.

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
 * The password: the first line of a pipe with `--password-stdin`, else asked for with a hidden
 * prompt. There is no flag for it, so a password never lands in shell history.
 */
async function readPassword({ io }: Context, fromStdin: boolean): Promise<string> {
  const { stdin } = io;
  if (fromStdin) {
    // A terminal would echo the password as it was typed.
    if (stdin.isTTY) throw new CliError('usage', '--password-stdin reads the password from a pipe, not a terminal.', 'Leave it out to be asked for the password.');
    const [password = ''] = (await readAll(stdin)).split(/\r?\n/);
    if (!password) throw new CliError('usage', 'No password was given on standard input.');
    return password;
  }
  if (!isTerminal(stdin)) throw new CliError('usage', 'There is no terminal to ask for the password.', 'Pipe it in with --password-stdin.');
  return readHiddenLine(stdin, io.stderr, 'Password: ');
}

/** `mctl login`: logs in and keeps the login as a profile. The first login becomes current. */
export async function login(context: Context, options: LoginOptions): Promise<number> {
  const api = apiAddress(options.api, context.io.env);
  const password = await readPassword(context, options.passwordStdin === true);
  const answer = await callApi(api, { method: 'POST', path: '/v1/auth/login', body: { org: options.org, email: options.email, password } }, loginResponseSchema);
  const { user, organisation, token, expires_at: expiresAt } = answer.data;
  const name = context.profileFlag ?? context.io.env.MCTL_PROFILE ?? DEFAULT_PROFILE;
  const profile = { api, org: organisation.slug, email: user.email, name: user.name, role: user.role, organisation: organisation.name, token, expires_at: expiresAt };
  const saved = logIn(loadConfig(context), name, profile);
  saveConfig(context, saved);
  printActingAs(context, profile);
  printAnswer(context, answer.raw, [
    `Logged in to ${organisation.name} as ${user.name}. Saved as profile "${name}"${saved.current === name ? ', the current one' : ''}.`,
    `The login expires at ${formatTime(expiresAt)}.`,
  ]);
  printNext(context, saved.current === name ? 'mctl whoami' : `mctl profile use ${name}`);
  return 0;
}

/** `mctl whoami`: who commands act as, as the API sees the login. */
export async function whoami(context: Context): Promise<number> {
  const session = requireSession(context);
  printActingAs(context, session.profile);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: '/v1/me' }, meResponseSchema);
  printAnswer(context, raw, [
    `${data.user.name} <${data.user.email}>`,
    describeLogin({ name: data.user.name, role: data.user.role, organisation: data.organisation.name }),
    `Profile "${session.name}" at ${session.profile.api}; the login expires at ${formatTime(session.profile.expires_at)}.`,
  ]);
  return 0;
}

/**
 * `mctl logout`: forgets the token of the profile acted as, or of every profile. Nothing is lost
 * that logging in again cannot restore, so it asks no confirmation. An expired login can be logged
 * out too.
 */
export function logout(context: Context, options: { all?: boolean }): number {
  const config = loadConfig(context);
  if (options.all) {
    const names = Object.keys(config.profiles);
    saveConfig(context, logOut(config, names));
    printAnswer(context, { logged_out: names }, [`Logged out of ${names.length} profile${names.length === 1 ? '' : 's'}.`]);
    return 0;
  }
  const { name, profile } = requireActingProfile(context, config);
  printActingAs(context, profile);
  saveConfig(context, logOut(config, [name]));
  printAnswer(context, { logged_out: [name] }, [`Logged out of profile "${name}".`]);
  printNext(context, logInCommand(name, profile));
  return 0;
}
