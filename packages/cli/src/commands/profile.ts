import { type Context, describeLogin, formatTime, loadConfig, printActingAs, printAnswer, printNext, saveConfig } from '../context.ts';
import { paint } from '../output.ts';
import { requireProfile, resolveProfileName, useProfile } from '../profiles.ts';

/** Every profile, marking the one commands act as. Tokens are never printed. */
export function listProfiles(context: Context): number {
  const config = loadConfig(context);
  const acting = resolveProfileName(config, context.profileFlag, context.io.env);
  const entries = Object.entries(config.profiles).sort(([a], [b]) => (a < b ? -1 : 1));
  const actingProfile = entries.find(([name]) => name === acting)?.[1];
  if (actingProfile) printActingAs(context, actingProfile);
  const dim = paint(context.io.stdout, context.io.env);
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
      ? ['No profiles yet. Log in with `mctl login --org <slug> --email <email>`.']
      : entries.map(([name, profile]) => {
          const login = profile.expires_at === null ? dim('dim', 'logged out') : `expires ${formatTime(profile.expires_at)}`;
          return `${name === config.current ? '*' : ' '} ${name.padEnd(width)}  ${describeLogin(profile)}  ${profile.email}  ${login}`;
        }),
  );
  return 0;
}

/** Makes a profile the current one. */
export function useProfileCommand(context: Context, name: string): number {
  const config = useProfile(loadConfig(context), name);
  saveConfig(context, config);
  printActingAs(context, requireProfile(config, name));
  printAnswer(context, { current: name }, [`Profile "${name}" is now current.`]);
  printNext(context, 'mctl whoami');
  return 0;
}
