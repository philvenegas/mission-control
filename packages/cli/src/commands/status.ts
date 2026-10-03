import { healthResponseSchema } from '@mission-control/contract';
import { apiAddress, callApi, UnreachableApi } from '../api.ts';
import { type Context, loadConfig } from '../context.ts';
import { CliError } from '../errors.ts';
import { describeLogin, formatTime, printActingAs, printAnswer } from '../output/print.ts';
import { paint } from '../output/style.ts';
import { actingProfile, LOG_IN } from '../session.ts';

/**
 * `mctl status`: where the API is, whether it answers, which profile commands act as and when its
 * login expires (DESIGN.md section 9). Needs no login. Exits 1 when the API is not there to use.
 */
export async function status(context: Context): Promise<number> {
  const acting = actingProfile(context, loadConfig(context));
  const name = acting?.name ?? null;
  const profile = acting?.profile;
  const api = profile?.api ?? apiAddress(undefined, context.io.env);
  if (profile) printActingAs(context, profile);
  const problem = await healthProblem(api);
  const style = paint(context.io.stdout, context.io.env);
  const expiresAt = profile?.expires_at ?? null;
  const expired = expiresAt !== null && Date.parse(expiresAt) <= Date.now();
  printAnswer(context, { api, reachable: problem === null, profile: profile ? name : null, expires_at: expiresAt }, [
    `API      ${api}  ${problem === null ? style('green', 'reachable') : style('red', problem)}`,
    `Profile  ${profile ? `${name}: ${describeLogin(profile)}` : `none. ${LOG_IN}`}`,
    ...(profile ? [`Login    ${expiresAt === null ? 'logged out' : `${expired ? style('yellow', 'expired') : 'expires'} ${formatTime(expiresAt)}`}`] : []),
  ]);
  return problem === null ? 0 : 1;
}

/** What is wrong with the API at an address, or null when it answers as it should. */
async function healthProblem(api: string): Promise<string | null> {
  try {
    await callApi(api, { method: 'GET', path: '/v1/health' }, healthResponseSchema);
    return null;
  } catch (error) {
    if (error instanceof UnreachableApi) return 'not reachable: start it with `pnpm api`';
    if (error instanceof CliError) return `answers, but not as expected: ${error.message}`;
    throw error;
  }
}
