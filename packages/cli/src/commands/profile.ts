import { type Context, loadConfig, saveConfig } from '../context.ts';
import { describeLogin, formatTime, printActingAs, printAnswer, printNext } from '../output/print.ts';
import { paint } from '../output/style.ts';
import { requireProfile, useProfile } from '../profiles.ts';
import { actingProfile, LOG_IN } from '../session.ts';

/** `mctl profile list`: every profile, marking the current one. Tokens are never printed. */
export function profileList(context: Context): number {
  const config = loadConfig(context);
  const acting = actingProfile(context, config)?.profile;
  if (acting) printActingAs(context, acting);
  const entries = Object.entries(config.profiles).sort(([first], [second]) => (first < second ? -1 : 1));
  const style = paint(context.io.stdout, context.io.env);
  const width = Math.max(0, ...entries.map(([name]) => name.length));
  printAnswer(
    context,
    entries.map(([name, profile]) => ({
      name,
      current: name === config.current,
      api: profile.api,
      org: profile.org,
      email: profile.email,
      user: profile.name,
      role: profile.role,
      organisation: profile.organisation,
      expires_at: profile.expires_at,
    })),
    entries.length === 0
      ? [`No profiles yet. ${LOG_IN}`]
      : entries.map(([name, profile]) => {
          const login = profile.expires_at === null ? style('dim', 'logged out') : `expires ${formatTime(profile.expires_at)}`;
          return `${name === config.current ? '*' : ' '} ${name.padEnd(width)}  ${describeLogin(profile)}  ${profile.email}  ${login}`;
        }),
  );
  return 0;
}

/** `mctl profile use`: makes a profile the current one. */
export function profileUse(context: Context, name: string): number {
  const config = useProfile(loadConfig(context), name);
  saveConfig(context, config);
  printActingAs(context, requireProfile(config, name));
  printAnswer(context, { current: name }, [`Profile "${name}" is now current.`]);
  printNext(context, 'mctl whoami');
  return 0;
}
