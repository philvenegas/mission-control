import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError } from './errors.ts';
import {
  configPath,
  EMPTY_CONFIG,
  logIn,
  logOut,
  type Profile,
  readConfig,
  resolveProfileName,
  useProfile,
  writeConfig,
} from './profiles.ts';

const SAM: Profile = {
  api: 'http://localhost:3000',
  org: 'artemis',
  email: 'sam@artemis.example',
  name: 'Sam Okafor',
  role: 'mission_lead',
  organisation: 'Artemis',
  token: 'token-for-sam',
  expires_at: '2026-10-10T12:00:00.000Z',
};
const DANA: Profile = { ...SAM, email: 'dana@artemis.example', name: 'Dana Okoye', role: 'director', token: 'token-for-dana' };

const scratch = () => mkdtempSync(join(tmpdir(), 'mctl-'));

describe('where logins are kept', () => {
  it('is ~/.config/mctl/config.json unless MCTL_CONFIG names another file', () => {
    expect(configPath({}, '/home/sam')).toBe('/home/sam/.config/mctl/config.json');
    expect(configPath({ MCTL_CONFIG: '/tmp/mine.json' }, '/home/sam')).toBe('/tmp/mine.json');
  });

  it('is a file only the user can read, in a folder only they can open', () => {
    const path = join(scratch(), 'nested', 'config.json');
    writeConfig(path, logIn(EMPTY_CONFIG, 'lead', SAM));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, '..')).mode & 0o777).toBe(0o700);
    expect(readConfig(path)).toEqual({ current: 'lead', profiles: { lead: SAM } });
  });

  it('tightens a file that was readable by others when it is next written', () => {
    const path = join(scratch(), 'config.json');
    writeFileSync(path, JSON.stringify(EMPTY_CONFIG), { mode: 0o644 });
    writeConfig(path, logIn(readConfig(path), 'lead', SAM));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('reads a missing file as no logins, and refuses one it cannot read, naming it', () => {
    expect(readConfig(join(scratch(), 'none.json'))).toEqual(EMPTY_CONFIG);
    const path = join(scratch(), 'config.json');
    writeFileSync(path, '{"current": 3}');
    expect(() => readConfig(path)).toThrow(new CliError('general', `${path} is not a valid mctl config file.`, 'Fix it, or delete it and log in again.'));
    writeFileSync(path, 'not json');
    expect(() => readConfig(path)).toThrow(CliError);
  });
});

describe('profiles', () => {
  it('makes the first login current, and keeps the current one on later logins', () => {
    const first = logIn(EMPTY_CONFIG, 'lead', SAM);
    expect(first.current).toBe('lead');
    const second = logIn(first, 'director', DANA);
    expect(second).toEqual({ current: 'lead', profiles: { lead: SAM, director: DANA } });
    // Logging in again under the same name replaces that profile.
    expect(logIn(second, 'lead', { ...SAM, token: 'fresh' }).profiles.lead?.token).toBe('fresh');
  });

  it('switches the current profile only to one that exists', () => {
    const config = logIn(logIn(EMPTY_CONFIG, 'lead', SAM), 'director', DANA);
    expect(useProfile(config, 'director').current).toBe('director');
    expect(() => useProfile(config, 'ada')).toThrow(new CliError('usage', 'There is no profile "ada".', 'Profiles: director, lead.'));
    expect(() => useProfile(EMPTY_CONFIG, 'ada')).toThrow(new CliError('usage', 'There is no profile "ada".', 'Log in first with `mctl login`.'));
  });

  it('logs out by forgetting the token, keeping the organisation and email for logging in again', () => {
    const config = logIn(logIn(EMPTY_CONFIG, 'lead', SAM), 'director', DANA);
    const out = logOut(config, ['lead']);
    expect(out.profiles.lead).toEqual({ ...SAM, token: null, expires_at: null });
    expect(out.profiles.director).toEqual(DANA);
    expect(logOut(config, ['lead', 'director']).profiles).toEqual({
      lead: { ...SAM, token: null, expires_at: null },
      director: { ...DANA, token: null, expires_at: null },
    });
    expect(() => logOut(config, ['ada'])).toThrow(CliError);
  });

  it('chooses --profile, then MCTL_PROFILE, then the current profile', () => {
    const config = logIn(logIn(EMPTY_CONFIG, 'lead', SAM), 'director', DANA);
    expect(resolveProfileName(config, 'director', { MCTL_PROFILE: 'lead' })).toBe('director');
    expect(resolveProfileName(config, undefined, { MCTL_PROFILE: 'director' })).toBe('director');
    expect(resolveProfileName(config, undefined, {})).toBe('lead');
    expect(resolveProfileName(EMPTY_CONFIG, undefined, {})).toBeNull();
  });
});
