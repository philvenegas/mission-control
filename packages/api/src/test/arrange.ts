import {
  type AssignmentStatus,
  formatRef,
  MIN_LEVEL,
  type MissionStatus,
  parseRef,
  type Period,
  type RefKind,
} from '@mission-control/contract';
import type { connectAsOwner } from './database.ts';

// Data a test needs that the API cannot yet create: a mission already in a given status, crew
// already proposed or accepted. Arranged directly in the test database as its owner. References are
// taken from the organisation's own counters, as the API takes them, so arranged records and ones
// the API creates later never share a reference.

type OwnerClient = ReturnType<typeof connectAsOwner>['client'];

const COUNTER_COLUMNS = { mission: 'last_mission_ref', assignment: 'last_assignment_ref' } as const satisfies Partial<Record<RefKind, string>>;

async function takeNextRef(sql: OwnerClient, org: string, kind: keyof typeof COUNTER_COLUMNS): Promise<number> {
  const column = sql(COUNTER_COLUMNS[kind]);
  const [row] = await sql`UPDATE organisations SET ${column} = ${column} + 1 WHERE slug = ${org} RETURNING ${column} AS ref`;
  if (!row) throw new Error(`There is no organisation "${org}" to arrange a ${kind} in`);
  return Number(row.ref);
}

/**
 * A one-day period, `index` days after `first`. A run of them never overlap, so arranged missions
 * that each hold the same crew member can coexist.
 */
export function dayAfter(first: string, index: number): Period {
  const day = (offset: number) => new Date(Date.parse(first) + offset * 86_400_000).toISOString().slice(0, 10);
  return { from: day(index), to: day(index + 1) };
}

/** Crew placed in a slot, by reference, with the status of their assignment. */
export interface ArrangedCrew {
  crewMember: string;
  status: AssignmentStatus;
}

export interface ArrangedMission {
  /** The organisation's slug. */
  org: string;
  name: string;
  period: Period;
  status: MissionStatus;
  /** The owner's email. Past draft, they are also the submitter of its first submission. */
  owner: string;
  /** The mission's one requirement. */
  skill: string;
  minLevel?: number;
  headcount?: number;
  crew?: ArrangedCrew[];
}

/** A mission in any status, with one requirement and, optionally, crew in its slots. Gives its reference. */
export async function arrangeMission(sql: OwnerClient, mission: ArrangedMission): Promise<string> {
  const ref = await takeNextRef(sql, mission.org, 'mission');
  const submitted = mission.status !== 'draft';
  await sql`
    WITH org AS (SELECT id FROM organisations WHERE slug = ${mission.org}),
    mission_owner AS (SELECT id FROM users WHERE org_id = (SELECT id FROM org) AND email = ${mission.owner}),
    mission AS (
      INSERT INTO missions (org_id, ref, name, period, status, owner_id, submitted_by, submission_no)
      SELECT org.id, ${ref}, ${mission.name}, daterange(${mission.period.from}::date, ${mission.period.to}::date), ${mission.status},
             mission_owner.id, CASE WHEN ${submitted} THEN mission_owner.id END, ${submitted ? 1 : 0}
      FROM org, mission_owner RETURNING id, org_id)
    INSERT INTO mission_requirements (org_id, mission_id, skill_id, min_level, headcount)
    SELECT mission.org_id, mission.id, skills.id, ${mission.minLevel ?? MIN_LEVEL}, ${mission.headcount ?? 1}
    FROM mission JOIN skills ON skills.org_id = mission.org_id AND skills.name = ${mission.skill}`;
  const missionRef = formatRef('mission', ref);
  await arrangeCrew(sql, mission.org, missionRef, mission.crew ?? []);
  return missionRef;
}

/** Crew in a mission's slots, for the requirement of the given skill, or its only requirement. */
export async function arrangeCrew(sql: OwnerClient, org: string, missionRef: string, crew: ArrangedCrew[], skill?: string) {
  for (const { crewMember, status } of crew) {
    const ref = await takeNextRef(sql, org, 'assignment');
    const inserted = await sql`
      INSERT INTO assignments (org_id, ref, mission_id, requirement_id, crew_member_id, period, status, created_by)
      SELECT m.org_id, ${ref}, m.id, r.id, c.id, m.period, ${status}, m.owner_id
      FROM missions m
      JOIN organisations o ON o.id = m.org_id
      JOIN mission_requirements r ON r.mission_id = m.id
      JOIN skills s ON s.id = r.skill_id
      JOIN crew_members c ON c.org_id = m.org_id AND c.ref = ${parseRef('crew_member', crewMember)}
      WHERE o.slug = ${org} AND m.ref = ${parseRef('mission', missionRef)} AND (${skill ?? null}::text IS NULL OR s.name = ${skill ?? null})
      RETURNING 1`;
    if (inserted.length !== 1) throw new Error(`Could not place ${crewMember} on ${missionRef}: ${inserted.length} slots matched`);
  }
}
