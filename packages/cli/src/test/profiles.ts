import { join } from 'node:path';
import { DEMO_PASSWORD } from '../../../api/src/db/seed-data.ts';
import { mctl, type MctlOptions, scratch } from './api.ts';

// Seeded users, logged in once as profiles in one config file, so a test can act as any of them.

const ARTEMIS = ['sam', 'priya', 'dana', 'ada', 'quin', 'mina'] as const;
const HELIOS = ['farid', 'ines'] as const;
export type Person = (typeof ARTEMIS)[number] | (typeof HELIOS)[number];

/**
 * Logs in every seeded user a test acts as, each under a profile of their first name, and gives a
 * way to run `mctl` as one of them against the API at `url`.
 */
export async function logInEveryone(url: string) {
  const env = { MCTL_CONFIG: join(scratch(), 'config.json'), MCTL_API: url };
  const logIn = (org: string, person: Person) =>
    mctl(['login', '--org', org, '--email', `${person}@${org}.example`, '--profile', person, '--password-stdin'], env, { stdin: DEMO_PASSWORD });
  for (const person of ARTEMIS) await logIn('artemis', person);
  for (const person of HELIOS) await logIn('helios', person);
  return (person: Person, args: string[], options: MctlOptions = {}) => mctl([...args, '--profile', person], env, options);
}
