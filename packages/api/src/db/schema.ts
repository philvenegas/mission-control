import {
  APPROVAL_DECISIONS,
  type ApprovalDecision,
  ASSIGNMENT_STATUSES,
  type AssignmentStatus,
  CREW_STATUSES,
  type CrewStatus,
  DEFAULT_ORG_SETTINGS,
  type MatchWeights,
  MAX_LEVEL,
  MIN_LEVEL,
  MISSION_EVENT_TYPES,
  MISSION_STATUSES,
  type MissionEventType,
  type MissionStatus,
  type OrgSettings,
  type Period,
  ROLES,
  type Role,
} from '@mission-control/contract';
import { type Column, sql } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { fromDaterange, toDaterange } from './period.ts';

/** A period, stored as a Postgres daterange: start inclusive, end exclusive. */
export const daterange = customType<{ data: Period; driverData: string }>({
  dataType: () => 'daterange',
  toDriver: toDaterange,
  fromDriver: fromDaterange,
});

const id = () => uuid('id').primaryKey().defaultRandom();
const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organisations.id);
/** A check that a column holds one of the contract's values, so the two cannot drift apart. */
const oneOf = (column: Column, values: readonly string[]) =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
const validLevel = (column: Column) => sql`${column} BETWEEN ${sql.raw(String(MIN_LEVEL))} AND ${sql.raw(String(MAX_LEVEL))}`;
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
/**
 * Row-level security: a row can be read or written only while `app.org_id`, which each request sets
 * for its own transaction, names the row's organisation. With no setting, or the empty one a
 * connection keeps after such a transaction, nothing matches. The owner bypasses it, for the seed
 * and the login lookup; the API role cannot. A new table also needs a line forcing it, in a custom
 * migration like `0004_force_row_level_security.sql`; `row-level-security.int.test.ts` fails until it has one.
 */
const tenantPolicy = (organisation: Column) => {
  const ownOrganisation = sql`${organisation} = nullif(current_setting('app.org_id', true), '')::uuid`;
  return pgPolicy('tenant_isolation', { for: 'all', using: ownOrganisation, withCheck: ownOrganisation });
};

// Every tenant table has `org_id` and a unique `(org_id, id)`, and every foreign key between
// tenant tables is composite on `(org_id, id)`: a row can never reference another organisation's row.

export const organisations = pgTable('organisations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  settings: jsonb('settings').$type<OrgSettings>().notNull().default(DEFAULT_ORG_SETTINGS),
  // The last reference number given out, per kind. Taken inside the creating transaction.
  lastMissionRef: integer('last_mission_ref').notNull().default(0),
  lastCrewMemberRef: integer('last_crew_member_ref').notNull().default(0),
  lastAssignmentRef: integer('last_assignment_ref').notNull().default(0),
  lastMatchRunRef: integer('last_match_run_ref').notNull().default(0),
  lastAvailabilityBlockRef: integer('last_availability_block_ref').notNull().default(0),
  createdAt: createdAt(),
}, (table) => [tenantPolicy(table.id)]);

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
  (table) => [
    unique('users_org_id_id').on(table.orgId, table.id),
    unique('users_org_id_email').on(table.orgId, table.email),
    check('users_role', oneOf(table.role, ROLES)),
    tenantPolicy(table.orgId),
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
  (table) => [
    unique('crew_members_org_id_id').on(table.orgId, table.id),
    unique('crew_members_org_id_ref').on(table.orgId, table.ref),
    foreignKey({ name: 'crew_members_user_fk', columns: [table.orgId, table.userId], foreignColumns: [users.orgId, users.id] }),
    check('crew_members_status', oneOf(table.status, CREW_STATUSES)),
    tenantPolicy(table.orgId),
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
  (table) => [unique('skills_org_id_id').on(table.orgId, table.id), unique('skills_org_id_name').on(table.orgId, table.name), tenantPolicy(table.orgId)],
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
  (table) => [
    primaryKey({ name: 'crew_skills_pk', columns: [table.crewMemberId, table.skillId] }),
    foreignKey({
      name: 'crew_skills_crew_member_fk',
      columns: [table.orgId, table.crewMemberId],
      foreignColumns: [crewMembers.orgId, crewMembers.id],
    }),
    foreignKey({ name: 'crew_skills_skill_fk', columns: [table.orgId, table.skillId], foreignColumns: [skills.orgId, skills.id] }),
    check('crew_skills_level', validLevel(table.level)),
    tenantPolicy(table.orgId),
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
  (table) => [
    unique('availability_blocks_org_id_id').on(table.orgId, table.id),
    unique('availability_blocks_org_id_ref').on(table.orgId, table.ref),
    foreignKey({
      name: 'availability_blocks_crew_member_fk',
      columns: [table.orgId, table.crewMemberId],
      foreignColumns: [crewMembers.orgId, crewMembers.id],
    }),
    check('availability_blocks_period', sql`NOT isempty(${table.period})`),
    tenantPolicy(table.orgId),
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
  (table) => [
    unique('missions_org_id_id').on(table.orgId, table.id),
    unique('missions_org_id_ref').on(table.orgId, table.ref),
    foreignKey({ name: 'missions_owner_fk', columns: [table.orgId, table.ownerId], foreignColumns: [users.orgId, users.id] }),
    foreignKey({
      name: 'missions_submitted_by_fk',
      columns: [table.orgId, table.submittedBy],
      foreignColumns: [users.orgId, users.id],
    }),
    // Lets an assignment's foreign key carry the period, so the two cannot differ.
    unique('missions_org_id_id_period').on(table.orgId, table.id, table.period),
    check('missions_status', oneOf(table.status, MISSION_STATUSES)),
    check('missions_period', sql`NOT isempty(${table.period})`),
    tenantPolicy(table.orgId),
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
  (table) => [
    unique('mission_requirements_org_id_id').on(table.orgId, table.id),
    // Lets an assignment's foreign key carry the mission, so its requirement is one of that mission's.
    unique('mission_requirements_org_id_mission_id_id').on(table.orgId, table.missionId, table.id),
    // At most one requirement per skill, so a requirement is addressed by its skill.
    unique('mission_requirements_mission_skill').on(table.missionId, table.skillId),
    foreignKey({
      name: 'mission_requirements_mission_fk',
      columns: [table.orgId, table.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({
      name: 'mission_requirements_skill_fk',
      columns: [table.orgId, table.skillId],
      foreignColumns: [skills.orgId, skills.id],
    }),
    check('mission_requirements_min_level', validLevel(table.minLevel)),
    check('mission_requirements_headcount', sql`${table.headcount} >= 1`),
    tenantPolicy(table.orgId),
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
  (table) => [
    unique('match_runs_org_id_id').on(table.orgId, table.id),
    unique('match_runs_org_id_ref').on(table.orgId, table.ref),
    foreignKey({
      name: 'match_runs_mission_fk',
      columns: [table.orgId, table.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({ name: 'match_runs_created_by_fk', columns: [table.orgId, table.createdBy], foreignColumns: [users.orgId, users.id] }),
    tenantPolicy(table.orgId),
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
    // The foreign key to the mission includes it and cascades, so it always equals the mission's period.
    period: daterange('period').notNull(),
    status: text('status').$type<AssignmentStatus>().notNull(),
    score: doublePrecision('score'),
    // Set when a match run produced the assignment; when null, `created_by` assigned it by hand.
    matchRunId: uuid('match_run_id'),
    createdBy: uuid('created_by').notNull(),
    declineReason: text('decline_reason'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('assignments_org_id_id').on(table.orgId, table.id),
    unique('assignments_org_id_ref').on(table.orgId, table.ref),
    foreignKey({
      name: 'assignments_mission_fk',
      columns: [table.orgId, table.missionId, table.period],
      foreignColumns: [missions.orgId, missions.id, missions.period],
    }).onUpdate('cascade'),
    foreignKey({
      name: 'assignments_requirement_fk',
      columns: [table.orgId, table.missionId, table.requirementId],
      foreignColumns: [missionRequirements.orgId, missionRequirements.missionId, missionRequirements.id],
    }),
    foreignKey({
      name: 'assignments_crew_member_fk',
      columns: [table.orgId, table.crewMemberId],
      foreignColumns: [crewMembers.orgId, crewMembers.id],
    }),
    foreignKey({
      name: 'assignments_match_run_fk',
      columns: [table.orgId, table.matchRunId],
      foreignColumns: [matchRuns.orgId, matchRuns.id],
    }),
    foreignKey({ name: 'assignments_created_by_fk', columns: [table.orgId, table.createdBy], foreignColumns: [users.orgId, users.id] }),
    check('assignments_status', oneOf(table.status, ASSIGNMENT_STATUSES)),
    // The booking rule, `no_double_booking`, is an exclusion constraint added by a hand-written migration.
    tenantPolicy(table.orgId),
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
  (table) => [
    unique('mission_approvals_org_id_id').on(table.orgId, table.id),
    unique('mission_approvals_once_per_submission').on(table.missionId, table.submissionNo, table.approverId),
    foreignKey({
      name: 'mission_approvals_mission_fk',
      columns: [table.orgId, table.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({
      name: 'mission_approvals_approver_fk',
      columns: [table.orgId, table.approverId],
      foreignColumns: [users.orgId, users.id],
    }),
    check('mission_approvals_decision', oneOf(table.decision, APPROVAL_DECISIONS)),
    tenantPolicy(table.orgId),
  ],
);

export const missionEvents = pgTable(
  'mission_events',
  {
    id: id(),
    orgId: orgId(),
    missionId: uuid('mission_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    type: text('type').$type<MissionEventType>().notNull(),
    fromStatus: text('from_status').$type<MissionStatus>(),
    toStatus: text('to_status').$type<MissionStatus>(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('mission_events_org_id_id').on(table.orgId, table.id),
    foreignKey({
      name: 'mission_events_mission_fk',
      columns: [table.orgId, table.missionId],
      foreignColumns: [missions.orgId, missions.id],
    }),
    foreignKey({ name: 'mission_events_actor_fk', columns: [table.orgId, table.actorId], foreignColumns: [users.orgId, users.id] }),
    check('mission_events_type', oneOf(table.type, MISSION_EVENT_TYPES)),
    tenantPolicy(table.orgId),
  ],
);
