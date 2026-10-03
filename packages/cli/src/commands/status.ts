import { healthResponseSchema } from '@mission-control/contract';
import { apiAddress, callApi } from '../api.ts';
import { type Context, describeLogin, formatTime, loadConfig, printActingAs, printAnswer } from '../context.ts';
import { paint } from '../output.ts';
import { resolveProfileName } from '../profiles.ts';

/**
 * Where the API is, whether it answers, which profile commands act as and when its login expires
 * (DESIGN.md section 9). Needs no login. Exits 1 when the API cannot be reached.
 */
export async function status(context: Context): Promise<number> {
  const config = loadConfig(context);
  const name = resolveProfileName(config, context.profileFlag, context.io.env);
  const profile = name === null ? undefined : config.profiles[name];
  const api = profile?.api ?? apiAddress(undefined, context.io.env);
  if (profile) printActingAs(context, profile);
  // Any failure to get a healthy answer means the API is not there to use.
  const reachable = await callApi(api, { method: 'GET', path: '/v1/health' }, healthResponseSchema).then(
    () => true,
    () => false,
  );
  const style = paint(context.io.stdout, context.io.env);
  const expiresAt = profile?.expires_at ?? null;
  const expired = expiresAt !== null && Date.parse(expiresAt) <= Date.now();
  printAnswer(context, { api, reachable, profile: profile ? name : null, expires_at: expiresAt }, [
    `API      ${api}  ${reachable ? style('green', 'reachable') : style('red', 'not reachable: start it with `pnpm api`')}`,
    `Profile  ${profile ? `${name}: ${describeLogin(profile)}` : 'none: log in with `mctl login --org <slug> --email <email>`'}`,
    ...(profile
      ? [`Login    ${expiresAt === null ? 'logged out' : `${expired ? style('yellow', 'expired') : 'expires'} ${formatTime(expiresAt)}`}`]
      : []),
  ]);
  return reachable ? 0 : 1;
}
