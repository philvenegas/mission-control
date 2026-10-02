import type {
  ApprovalDecision,
  AssignmentStatus,
  CrewStatus,
  MatchWeights,
  MissionStatus,
  OrgSettings,
  Role,
} from '@mission-control/contract';
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** A period: start inclusive, end exclusive, written `[2027-03-01,2027-03-20)`. */
export const daterange = customType<{ data: string }>({ dataType: () => 'daterange' });

const id = () => uuid('id').primaryKey().defaultRandom();
const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organisations.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// Every tenant table has `org_id` and a unique `(org_id, id)`, and every foreign key between
// tenant tables is composite on `(org_id, id)`: a row can never reference another organisation's row.

export const organisations = pgTable('organisations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  settings: jsonb('settings').$type<OrgSettings>().notNull(),
  // The last reference number given out, per kind. Taken inside the creating transaction.
  lastMissionRef: integer('last_mission_ref').notNull().default(0),
  lastCrewMemberRef: integer('last_crew_member_ref').notNull().default(0),
  lastAssignmentRef: integer('last_assignment_ref').notNull().default(0),
  lastMatchRunRef: integer('last_match_run_ref').notNull().default(0),
  lastAvailabilityBlockRef: integer('last_availability_block_ref').notNull().default(0),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    orgId: orgId(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: text('role').$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('users_org_id_id').on(t.orgId, t.id),
    unique('users_org_id_email').on(t.orgId, t.email),
    check('users_role', sql`${t.role} IN ('director', 'mission_lead', 'crew_member')`),
  ],
);

export const crewMembers = pgTable(
  'crew_members',
  {
    id: id(),
    orgId: orgId(),
    ref: integer('ref').notNull(),
    userId: uuid('user_id').unique(),
    name: text('name').notNull(),
    status: text('status').$type<CrewStatus>().notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('crew_members_org_id_id').on(t.orgId, t.id),
    unique('crew_members_org_id_ref').on(t.orgId, t.ref),
    foreignKey({ name: 'crew_members_user_fk', columns: [t.orgId, t.userId], foreignColumns: [users.orgId, users.id] }),
    check('crew_members_status', sql`${t.status} IN ('active', 'inactive')`),
  ],
);

export const skills = pgTable(
  'skills',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    category: text('category').notNull(),
  },
  (t) => [unique('skills_org_id_id').on(t.orgId, t.id), unique('skills_org_id_name').on(t.orgId, t.name)],
);

export const crewSkills = pgTable(
  'crew_skills',
  {
    orgId: orgId(),
    crewMemberId: uuid('crew_member_id').notNull(),
    skillId: uuid('skill_id').notNull(),
    level: integer('level').notNull(),
    certifiedUntil: date('certified_until'),
  },
  (t) => [
    primaryKey({ name: 'crew_skills_pk', columns: [t.crewMemberId, t.skillId] }),
    foreignKey({
      name: 'crew_skills_crew_member_fk',
      columns: [t.orgId, t.crewMemberId],
      foreignColumns: [crewMembers.orgId, crewMembers.id],
    }),
    foreignKey({ name: 'crew_skills_skill_fk', columns: [t.orgId, t.skillId], foreignColumns: [skills.orgId, skills.id] }),
    check('crew_skills_level', sql`${t.level} BETWEEN 1 AND 5`),
  ],
);

export const availabilityBlocks = pgTable(
  'availability_blocks',
  {
    id: id(),
    orgId: orgId(),
    ref: integer('ref').notNull(),
    crewMemberId: uuid('crew_member_id').notNull(),
    period: daterange('period').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('availability_blocks_org_id_id').on(t.orgId, t.id),
    unique('availability_blocks_org_id_ref').on(t.orgId, t.ref),
    foreignKey({
      name: 'availability_blocks_crew_member_fk',
      columns: [t.orgId, t.crewMemberId],
      foreignColumns: [crewMembers.orgId, crewMembers.id],
    }),
    check('availability_blocks_period', sql`NOT isempty(${t.period})`),
  ],
);

export const missions = pgTable(
  'missions',
  {
    id: id(),
    orgId: orgId(),
    ref: integer('ref').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    period: daterange('period').notNull(),
    status: text('status').$type<MissionStatus>().notNull().default('draft'),
    ownerId: uuid('owner_id').notNull(),
    submittedBy: uuid('submitted_by'),
    submissionNo: integer('submission_no').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('missions_org_id_id').on(t.orgId, t.id),
    unique('missions_org_id_ref').on(t.orgId, t.ref),
    foreignKey({ name: 'missions_owner_fk', columns: [t.orgId, t.ownerId], foreignColumns: [users.orgId, users.id] }),
    foreignKey({
      name: 'missions_submitted_by_fk',
      columns: [t.orgId, t.submittedBy],
      foreignColumns: [users.orgId, users.id],
    }),
    check(
      'missions_status',
      sql`${t.status} IN ('draft', 'submitted', 'approved', 'active', 'completed', 'cancelled')`,
    ),
    check('missions_period', sql`NOT isempty(${t.period})`),
  ],
);

export const missionRequirements = pgTable(
  'mission_requirements',
  {
    id: id(),
    orgId: orgId(),
    missionId: uuid('mission_id').notNull(),
    skillId: uuid('skill_id').notNull(),
    minLevel: integer('min_level').notNull(),
    headcount: integer('headcount').notNull().default(1),
  },
  (t) => [
    unique('mission_requirements_org_id_id').on(t.orgId, t.id),
    // At most one requirement per skill, so a requirement is addressed by its skill.
    unique('mission_requirements_mission_skill').on(t.missionId, t.skillId),
    foreignKey({
      name: 'mission_requirements_mission_fk',
      columns: [t.orgId, t.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({
      name: 'mission_requirements_skill_fk',
      columns: [t.orgId, t.skillId],
      foreignColumns: [skills.orgId, skills.id],
    }),
    check('mission_requirements_min_level', sql`${t.minLevel} BETWEEN 1 AND 5`),
    check('mission_requirements_headcount', sql`${t.headcount} >= 1`),
  ],
);

export const matchRuns = pgTable(
  'match_runs',
  {
    id: id(),
    orgId: orgId(),
    ref: integer('ref').notNull(),
    missionId: uuid('mission_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    result: jsonb('result').notNull(),
    weights: jsonb('weights').$type<MatchWeights>().notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('match_runs_org_id_id').on(t.orgId, t.id),
    unique('match_runs_org_id_ref').on(t.orgId, t.ref),
    foreignKey({
      name: 'match_runs_mission_fk',
      columns: [t.orgId, t.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({ name: 'match_runs_created_by_fk', columns: [t.orgId, t.createdBy], foreignColumns: [users.orgId, users.id] }),
  ],
);

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    orgId: orgId(),
    ref: integer('ref').notNull(),
    missionId: uuid('mission_id').notNull(),
    requirementId: uuid('requirement_id').notNull(),
    crewMemberId: uuid('crew_member_id').notNull(),
    // Copied from the mission, so the booking rule can be a constraint on this table alone.
    period: daterange('period').notNull(),
    status: text('status').$type<AssignmentStatus>().notNull(),
    score: doublePrecision('score'),
    // Set when a match run produced the assignment; when null, `created_by` assigned it by hand.
    matchRunId: uuid('match_run_id'),
    createdBy: uuid('created_by').notNull(),
    declineReason: text('decline_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('assignments_org_id_id').on(t.orgId, t.id),
    unique('assignments_org_id_ref').on(t.orgId, t.ref),
    foreignKey({
      name: 'assignments_mission_fk',
      columns: [t.orgId, t.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({
      name: 'assignments_requirement_fk',
      columns: [t.orgId, t.requirementId],
      foreignColumns: [missionRequirements.orgId, missionRequirements.id],
    }),
    foreignKey({
      name: 'assignments_crew_member_fk',
      columns: [t.orgId, t.crewMemberId],
      foreignColumns: [crewMembers.orgId, crewMembers.id],
    }),
    foreignKey({
      name: 'assignments_match_run_fk',
      columns: [t.orgId, t.matchRunId],
      foreignColumns: [matchRuns.orgId, matchRuns.id],
    }),
    foreignKey({ name: 'assignments_created_by_fk', columns: [t.orgId, t.createdBy], foreignColumns: [users.orgId, users.id] }),
    check(
      'assignments_status',
      sql`${t.status} IN ('proposed', 'held', 'offered', 'accepted', 'declined', 'released')`,
    ),
    // The booking rule, `no_double_booking`, is an exclusion constraint added by a hand-written migration.
  ],
);

export const missionApprovals = pgTable(
  'mission_approvals',
  {
    id: id(),
    orgId: orgId(),
    missionId: uuid('mission_id').notNull(),
    submissionNo: integer('submission_no').notNull(),
    approverId: uuid('approver_id').notNull(),
    decision: text('decision').$type<ApprovalDecision>().notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('mission_approvals_org_id_id').on(t.orgId, t.id),
    unique('mission_approvals_once_per_submission').on(t.missionId, t.submissionNo, t.approverId),
    foreignKey({
      name: 'mission_approvals_mission_fk',
      columns: [t.orgId, t.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({
      name: 'mission_approvals_approver_fk',
      columns: [t.orgId, t.approverId],
      foreignColumns: [users.orgId, users.id],
    }),
    check('mission_approvals_decision', sql`${t.decision} IN ('approve', 'reject')`),
  ],
);

export const missionEvents = pgTable(
  'mission_events',
  {
    id: id(),
    orgId: orgId(),
    missionId: uuid('mission_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    type: text('type').notNull(),
    fromStatus: text('from_status').$type<MissionStatus>(),
    toStatus: text('to_status').$type<MissionStatus>(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('mission_events_org_id_id').on(t.orgId, t.id),
    foreignKey({
      name: 'mission_events_mission_fk',
      columns: [t.orgId, t.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({ name: 'mission_events_actor_fk', columns: [t.orgId, t.actorId], foreignColumns: [users.orgId, users.id] }),
  ],
);

export type User = typeof users.$inferSelect;
