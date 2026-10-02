import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  type AssignmentStatus,
  MISSION_STATUSES,
  type MissionEventType,
  type MissionStatus,
  type Role,
} from '@mission-control/contract';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password.ts';
import { requireEnv } from '../env.ts';
import { connect, type Database } from './connection.ts';
import { toDaterange } from './period.ts';
import * as schema from './schema.ts';
import { type MissionSeed, type OrgSeed, SEED_BASE_DATE, SEED_ORGS } from './seed-data.ts';

export const DEMO_PASSWORD = 'mission-control-demo';

const DAY = 24 * 60 * 60 * 1000;

/** The date a number of days from the base date. */
export function seedDate(day: number, baseDate = SEED_BASE_DATE): string {
  return new Date(Date.parse(baseDate) + day * DAY).toISOString().slice(0, 10);
}

const seedPeriod = (fromDay: number, toDay: number) => toDaterange({ from: seedDate(fromDay), to: seedDate(toDay) });
const seedTime = (day: number, hour: number) => new Date(Date.parse(SEED_BASE_DATE) + day * DAY + hour * 60 * 60 * 1000);
const firstName = (name: string) => name.split(' ')[0]!;
const reached = (mission: MissionSeed, status: MissionStatus) =>
  MISSION_STATUSES.indexOf(mission.status) >= MISSION_STATUSES.indexOf(status);

/** The status a mission's assignments have, given the mission's own (DESIGN.md section 4). */
const ASSIGNMENT_STATUS: Record<MissionSeed['status'], AssignmentStatus> = {
  draft: 'proposed',
  submitted: 'held',
  approved: 'offered',
  active: 'accepted',
  completed: 'accepted',
};

function lookup<V>(map: Map<string, V>, key: string, what: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Seed data names ${what} "${key}", which is not defined`);
  return value;
}

async function seedOrg(db: Database, org: OrgSeed, passwordHash: string) {
  const orgId = randomUUID();
  await db.insert(schema.organisations).values({ id: orgId, name: org.name, slug: org.slug, settings: org.settings });
  const email = (name: string) => `${firstName(name).toLowerCase()}@${org.slug}.example`;

  const skillIds = new Map<string, string>();
  for (const [name, category] of Object.entries(org.skills)) {
    const id = randomUUID();
    await db.insert(schema.skills).values({ id, orgId, name, category });
    skillIds.set(name, id);
  }

  const userIds = new Map<string, string>();
  const addUser = async (name: string, role: Role) => {
    const id = randomUUID();
    await db.insert(schema.users).values({ id, orgId, name, role, email: email(name), passwordHash });
    userIds.set(firstName(name), id);
    return id;
  };
  for (const user of org.users) await addUser(user.name, user.role);

  const crewMemberIds = new Map<string, string>();
  let crewMemberRef = 0;
  let availabilityBlockRef = 0;
  for (const crewMember of org.crew) {
    const crewMemberId = randomUUID();
    const userId = crewMember.login ? await addUser(crewMember.name, 'crew_member') : null;
    await db
      .insert(schema.crewMembers)
      .values({ id: crewMemberId, orgId, ref: ++crewMemberRef, name: crewMember.name, userId });
    crewMemberIds.set(firstName(crewMember.name), crewMemberId);
    for (const [skill, held] of Object.entries(crewMember.skills)) {
      const { level, certifiedUntilDay } = typeof held === 'number' ? { level: held, certifiedUntilDay: null } : held;
      await db.insert(schema.crewSkills).values({
        orgId,
        crewMemberId,
        skillId: lookup(skillIds, skill, 'skill'),
        level,
        certifiedUntil: certifiedUntilDay === null ? null : seedDate(certifiedUntilDay),
      });
    }
    for (const block of crewMember.blocks ?? []) {
      await db.insert(schema.availabilityBlocks).values({
        orgId,
        crewMemberId,
        ref: ++availabilityBlockRef,
        period: seedPeriod(block.fromDay, block.toDay),
        reason: block.reason,
      });
    }
  }

  let missionRef = 0;
  let assignmentRef = 0;
  for (const mission of org.missions) {
    const missionId = randomUUID();
    const ownerId = lookup(userIds, mission.owner, 'user');
    const submitted = reached(mission, 'submitted');
    const period = seedPeriod(mission.fromDay, mission.toDay);
    await db.insert(schema.missions).values({
      id: missionId,
      orgId,
      ref: ++missionRef,
      name: mission.name,
      description: mission.description,
      period,
      status: mission.status,
      ownerId,
      submittedBy: submitted ? ownerId : null,
      submissionNo: submitted ? 1 : 0,
    });

    for (const requirement of mission.requirements) {
      const requirementId = randomUUID();
      const crew = requirement.crew ?? [];
      const headcount = requirement.headcount ?? 1;
      if (crew.length > headcount) {
        throw new Error(`Seed data gives ${mission.name} ${crew.length} crew for ${headcount} ${requirement.skill} slots`);
      }
      await db.insert(schema.missionRequirements).values({
        id: requirementId,
        orgId,
        missionId,
        skillId: lookup(skillIds, requirement.skill, 'skill'),
        minLevel: requirement.minLevel,
        headcount,
      });
      for (const name of crew) {
        await db.insert(schema.assignments).values({
          orgId,
          ref: ++assignmentRef,
          missionId,
          requirementId,
          crewMemberId: lookup(crewMemberIds, name, 'crew member'),
          period,
          status: ASSIGNMENT_STATUS[mission.status],
          createdBy: ownerId,
        });
      }
    }

    // History, at plausible times: submitted a month ahead of the mission (and always before the
    // base date), approved the next day, launched as the period starts and completed as it ends.
    const approvers = mission.approvedBy ?? [];
    const approved = reached(mission, 'approved');
    if (approved !== (approvers.length >= org.settings.approvals_required) || (!submitted && approvers.length > 0)) {
      throw new Error(
        `Seed data makes ${mission.name} ${mission.status} with ${approvers.length} of ${org.settings.approvals_required} approvals`,
      );
    }
    const event = (
      day: number,
      hour: number,
      actorId: string,
      type: MissionEventType,
      fromStatus: MissionStatus,
      toStatus: MissionStatus,
    ) =>
      db
        .insert(schema.missionEvents)
        .values({ orgId, missionId, actorId, type, fromStatus, toStatus, createdAt: seedTime(day, hour) });
    const submitDay = Math.min(mission.fromDay - 30, -7);
    if (submitted) await event(submitDay, 9, ownerId, 'submit', 'draft', 'submitted');
    for (const [index, name] of approvers.entries()) {
      const approverId = lookup(userIds, name, 'user');
      const createdAt = seedTime(submitDay + 1, 9 + index);
      await db
        .insert(schema.missionApprovals)
        .values({ orgId, missionId, submissionNo: 1, approverId, decision: 'approve', createdAt });
      // Every approval but the one that meets the policy leaves the mission submitted.
      const meetsPolicy = approved && index === approvers.length - 1;
      await event(submitDay + 1, 9 + index, approverId, 'approve', 'submitted', meetsPolicy ? 'approved' : 'submitted');
    }
    if (reached(mission, 'active')) await event(Math.min(mission.fromDay, -1), 9, ownerId, 'launch', 'approved', 'active');
    if (reached(mission, 'completed')) await event(Math.min(mission.toDay, -1), 17, ownerId, 'complete', 'active', 'completed');
  }

  await db
    .update(schema.organisations)
    .set({
      lastMissionRef: missionRef,
      lastCrewMemberRef: crewMemberRef,
      lastAssignmentRef: assignmentRef,
      lastAvailabilityBlockRef: availabilityBlockRef,
    })
    .where(eq(schema.organisations.id, orgId));
  return { users: userIds.size, crew: crewMemberRef, missions: missionRef, assignments: assignmentRef };
}

/** Wipes every organisation and rebuilds the demo data, or changes nothing if the data is unsound. Run as the owner. */
export async function seed(db: Database, orgs: OrgSeed[] = SEED_ORGS): Promise<string[]> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The seed wipes all data and refuses to run when NODE_ENV is production.');
  }
  const passwordHash = hashPassword(DEMO_PASSWORD);
  return db.transaction(async (tx) => {
    await tx.execute('TRUNCATE organisations CASCADE');
    const summary: string[] = [];
    for (const org of orgs) {
      const counts = await seedOrg(tx, org, passwordHash);
      summary.push(
        `${org.name} (${org.slug}): ${counts.users} users, ${counts.crew} crew, ${counts.missions} missions, ${counts.assignments} assignments`,
      );
    }
    return summary;
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
