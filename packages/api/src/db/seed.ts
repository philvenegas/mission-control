import { pathToFileURL } from 'node:url';
import type { AssignmentStatus, MissionStatus } from '@mission-control/contract';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password.ts';
import { requireEnv } from '../env.ts';
import { connect, type Database } from './connection.ts';
import * as t from './schema.ts';
import { type OrgSeed, SEED_ORGS } from './seed-data.ts';

/** Every seeded date is an offset from this day. Move it forward once the 2027 dates pass. */
export const SEED_BASE_DATE = '2026-10-01';
/** The base date the dates in seed-data.ts are written against. */
const WRITTEN_AGAINST = '2026-10-01';

export const DEMO_PASSWORD = 'mission-control-demo';

const DAY = 24 * 60 * 60 * 1000;

/** A date from seed-data.ts, moved by however far SEED_BASE_DATE has moved. */
export function seedDate(written: string, baseDate = SEED_BASE_DATE): string {
  const shift = Date.parse(baseDate) - Date.parse(WRITTEN_AGAINST);
  return new Date(Date.parse(written) + shift).toISOString().slice(0, 10);
}

const period = (from: string, to: string) => `[${seedDate(from)},${seedDate(to)})`;
const firstName = (name: string) => name.split(' ')[0]!;

const ASSIGNMENT_STATUS: Partial<Record<MissionStatus, AssignmentStatus>> = {
  draft: 'proposed',
  submitted: 'held',
  approved: 'offered',
  active: 'accepted',
  completed: 'accepted',
};

/** The transitions a mission went through to reach its status. */
const HISTORY: Record<MissionStatus, [type: string, from: MissionStatus, to: MissionStatus][]> = {
  draft: [],
  submitted: [['submit', 'draft', 'submitted']],
  approved: [['submit', 'draft', 'submitted'], ['approve', 'submitted', 'approved']],
  active: [['submit', 'draft', 'submitted'], ['approve', 'submitted', 'approved'], ['launch', 'approved', 'active']],
  completed: [
    ['submit', 'draft', 'submitted'],
    ['approve', 'submitted', 'approved'],
    ['launch', 'approved', 'active'],
    ['complete', 'active', 'completed'],
  ],
  cancelled: [],
};

function lookup<V>(map: Map<string, V>, key: string, what: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Seed data names ${what} "${key}", which is not defined`);
  return value;
}

async function seedOrg(db: Database, org: OrgSeed, passwordHash: string) {
  const [{ id: orgId }] = (await db
    .insert(t.organisations)
    .values({ name: org.name, slug: org.slug, settings: org.settings })
    .returning({ id: t.organisations.id })) as [{ id: string }];
  const email = (name: string) => `${firstName(name).toLowerCase()}@${org.slug}.example`;

  const skillIds = new Map<string, string>();
  for (const [name, category] of Object.entries(org.skills)) {
    const [row] = await db.insert(t.skills).values({ orgId, name, category }).returning({ id: t.skills.id });
    skillIds.set(name, row!.id);
  }

  const userIds = new Map<string, string>();
  const addUser = async (name: string, role: t.User['role']) => {
    const [row] = await db
      .insert(t.users)
      .values({ orgId, name, role, email: email(name), passwordHash })
      .returning({ id: t.users.id });
    userIds.set(firstName(name), row!.id);
    return row!.id;
  };
  for (const user of org.users) await addUser(user.name, user.role);

  const crewIds = new Map<string, string>();
  let crewRef = 0;
  let blockRef = 0;
  for (const member of org.crew) {
    const userId = member.login ? await addUser(member.name, 'crew_member') : null;
    const [row] = await db
      .insert(t.crewMembers)
      .values({ orgId, ref: ++crewRef, name: member.name, userId })
      .returning({ id: t.crewMembers.id });
    const crewMemberId = row!.id;
    crewIds.set(firstName(member.name), crewMemberId);
    for (const [skill, held] of Object.entries(member.skills)) {
      const { level, certifiedUntil } = typeof held === 'number' ? { level: held, certifiedUntil: null } : held;
      await db.insert(t.crewSkills).values({
        orgId,
        crewMemberId,
        skillId: lookup(skillIds, skill, 'skill'),
        level,
        certifiedUntil: certifiedUntil && seedDate(certifiedUntil),
      });
    }
    for (const block of member.blocks ?? []) {
      await db.insert(t.availabilityBlocks).values({
        orgId,
        crewMemberId,
        ref: ++blockRef,
        period: period(block.from, block.to),
        reason: block.reason,
      });
    }
  }

  let missionRef = 0;
  let assignmentRef = 0;
  // History is stamped a minute apart, ending before the base date, so it reads in order.
  let stamp = Date.parse(seedDate(WRITTEN_AGAINST)) - 30 * DAY;
  const nextStamp = () => new Date((stamp += 60_000));
  for (const mission of org.missions) {
    const ownerId = lookup(userIds, mission.owner, 'user');
    const submitted = mission.status !== 'draft';
    const missionPeriod = period(mission.from, mission.to);
    const [row] = await db
      .insert(t.missions)
      .values({
        orgId,
        ref: ++missionRef,
        name: mission.name,
        description: mission.description,
        period: missionPeriod,
        status: mission.status,
        ownerId,
        submittedBy: submitted ? ownerId : null,
        submissionNo: submitted ? 1 : 0,
      })
      .returning({ id: t.missions.id });
    const missionId = row!.id;

    for (const requirement of mission.requirements) {
      const crew = requirement.crew ?? [];
      const headcount = requirement.headcount ?? 1;
      if (crew.length > headcount) throw new Error(`${mission.name} has more ${requirement.skill} crew than slots`);
      const [req] = await db
        .insert(t.missionRequirements)
        .values({
          orgId,
          missionId,
          skillId: lookup(skillIds, requirement.skill, 'skill'),
          minLevel: requirement.minLevel,
          headcount,
        })
        .returning({ id: t.missionRequirements.id });
      for (const name of crew) {
        await db.insert(t.assignments).values({
          orgId,
          ref: ++assignmentRef,
          missionId,
          requirementId: req!.id,
          crewMemberId: lookup(crewIds, name, 'crew member'),
          period: missionPeriod,
          status: ASSIGNMENT_STATUS[mission.status]!,
          createdBy: ownerId,
        });
      }
    }

    const approvers = [...(mission.approvedBy ?? [])];
    const event = (actorId: string, type: string, fromStatus: MissionStatus, toStatus: MissionStatus) =>
      db.insert(t.missionEvents).values({ orgId, missionId, actorId, type, fromStatus, toStatus, createdAt: nextStamp() });
    const approval = (approverId: string) =>
      db
        .insert(t.missionApprovals)
        .values({ orgId, missionId, submissionNo: 1, approverId, decision: 'approve', createdAt: nextStamp() });
    for (const [type, fromStatus, toStatus] of HISTORY[mission.status]) {
      if (type !== 'approve') {
        await event(ownerId, type, fromStatus, toStatus);
        continue;
      }
      // Every approval but the last leaves the mission submitted.
      const last = approvers.pop();
      for (const name of [...approvers.splice(0), last ?? '']) {
        const approverId = lookup(userIds, name, 'approver');
        await approval(approverId);
        await event(approverId, type, fromStatus, name === last ? toStatus : fromStatus);
      }
    }
    // Approvals given so far to a mission that is still submitted.
    for (const name of approvers) {
      const approverId = lookup(userIds, name, 'approver');
      await approval(approverId);
      await event(approverId, 'approve', 'submitted', 'submitted');
    }
  }

  await db.update(t.organisations).set({
    lastMissionRef: missionRef,
    lastCrewMemberRef: crewRef,
    lastAssignmentRef: assignmentRef,
    lastAvailabilityBlockRef: blockRef,
  }).where(eq(t.organisations.id, orgId));
  return { users: userIds.size, crew: crewRef, missions: missionRef, assignments: assignmentRef };
}

/** Wipes every organisation and rebuilds the demo data. Run as the owner. */
export async function seed(db: Database): Promise<string[]> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The seed wipes all data and refuses to run when NODE_ENV is production.');
  }
  const passwordHash = hashPassword(DEMO_PASSWORD);
  return db.transaction(async (tx) => {
    await tx.execute('TRUNCATE organisations CASCADE');
    const lines: string[] = [];
    for (const org of SEED_ORGS) {
      const n = await seedOrg(tx as unknown as Database, org, passwordHash);
      lines.push(
        `${org.name} (${org.slug}): ${n.users} users, ${n.crew} crew, ${n.missions} missions, ${n.assignments} assignments`,
      );
    }
    return lines;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { client, db } = connect(requireEnv('DATABASE_OWNER_URL'));
  try {
    for (const line of await seed(db)) console.log(`  seeded ${line}`);
    console.log(`  every seeded user has the password: ${DEMO_PASSWORD}`);
  } finally {
    await client.end();
  }
}
