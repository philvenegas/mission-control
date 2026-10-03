// `pnpm demo:login`: logs in as each seeded demo user, one profile each, with `lead` current
// (DESIGN.md section 8). A repository script, not a CLI feature: it runs `mctl login
// --password-stdin` for each, then `mctl profile use lead`. The API address comes from MCTL_API, or
// the default.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEMO_PASSWORD, demoEmail } from '../packages/api/src/db/seed-data.ts';

const mctl = fileURLToPath(new URL('../bin/mctl', import.meta.url));

/** Each demo profile, as DESIGN.md section 8 names it, and whose login it is. */
const PROFILES = [
  { profile: 'lead', org: 'artemis', user: 'Sam' },
  { profile: 'director', org: 'artemis', user: 'Dana' },
  { profile: 'ada', org: 'artemis', user: 'Ada' },
  { profile: 'quin', org: 'artemis', user: 'Quin' },
  { profile: 'mina', org: 'artemis', user: 'Mina' },
  { profile: 'helios', org: 'helios', user: 'Farid' },
];

try {
  for (const { profile, org, user } of PROFILES) {
    const args = ['login', '--org', org, '--email', demoEmail(user, org), '--profile', profile, '--password-stdin'];
    execFileSync(mctl, args, { input: `${DEMO_PASSWORD}\n`, stdio: ['pipe', 'inherit', 'inherit'] });
  }
  // A config that already had a current profile keeps it on login; the demo starts as lead.
  execFileSync(mctl, ['profile', 'use', 'lead'], { stdio: 'inherit' });
} catch (error) {
  // mctl has printed why; exit as it did.
  process.exit(typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 1);
}
