import { MISSION_STATUSES, type MissionStatus, TRANSITIONS as CONTRACT_TRANSITIONS } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Caller, loginAs, useSeededApp } from '../../test/app.ts';

const { app, owner } = useSeededApp();

/**
 * The lifecycle as DESIGN.md section 4 states it, written out here rather than read from the
 * transition table, so the test can disagree with the table.
 */
const FROM: Record<BuiltTransition, MissionStatus[]> = {
  submit: ['draft'],
  approve: ['submitted'],
  reject: ['submitted'],
  launch: ['approved'],
  complete: ['active'],
  cancel: ['draft', 'submitted', 'approved', 'active'],
};
const TO: Record<BuiltTransition, MissionStatus> = {
  submit: 'submitted',
  approve: 'approved',
  reject: 'draft',
  launch: 'active',
  complete: 'completed',
  cancel: 'cancelled',
};
type BuiltTransition = 'submit' | 'approve' | 'reject' | 'launch' | 'complete' | 'cancel';
const TRANSITIONS: BuiltTransition[] = ['submit', 'approve', 'reject', 'launch', 'complete', 'cancel'];

/** Who acts: a director, the mission's owner, another mission lead, a crew member. */
type Actor = 'director' | 'owner' | 'other mission lead' | 'crew member';
const ACTORS: Actor[] = ['director', 'owner', 'other mission lead', 'crew member'];

/** Who may make each transition, from the statuses it allows (DESIGN.md section 4, "Who"). */
function mayAct(actor: Actor, transition: BuiltTransition, status: MissionStatus): boolean {
  if (actor === 'director') return true;
  if (actor === 'owner') return ['submit', 'launch', 'complete'].includes(transition) || (transition === 'cancel' && status !== 'active');
  return false;
}

/** A role that may never make the transition is refused before the mission is looked at. */
const roleNeverMay = (actor: Actor, transition: BuiltTransition) =>
  actor === 'crew member' || (actor !== 'director' && (transition === 'approve' || transition === 'reject'));

function expectedAnswer(actor: Actor, transition: BuiltTransition, status: MissionStatus): 200 | 403 | 409 {
  if (roleNeverMay(actor, transition)) return 403;
  if (!FROM[transition].includes(status)) return 409;
  return mayAct(actor, transition, status) ? 200 : 403;
}

const CASES = MISSION_STATUSES.flatMap((status) =>
  TRANSITIONS.flatMap((transition) => ACTORS.map((actor) => ({ status, transition, actor, expected: expectedAnswer(actor, transition, status) }))),
);

const FIRST_REF = 1000;
let callers: Record<Actor, Caller>;

beforeAll(async () => {
  const [director, missionOwner, otherLead, crewMember] = await Promise.all([
    loginAs(app, 'artemis', 'dana@artemis.example'),
    loginAs(app, 'artemis', 'sam@artemis.example'),
    loginAs(app, 'artemis', 'priya@artemis.example'),
    loginAs(app, 'artemis', 'ada@artemis.example'),
  ]);
  callers = { director, owner: missionOwner, 'other mission lead': otherLead, 'crew member': crewMember };
  // One mission per case, owned by Sam, in its own two days of 2030 so no two hold the same crew
  // at once. Each meets every guard: a requirement, a future start, and on an approved mission its
  // slot accepted (by Ben), so only the status and the role decide the answer.
  for (const [index, { status }] of CASES.entries()) {
    const ref = FIRST_REF + index;
    const day = new Date(Date.UTC(2030, 0, 1) + index * 2 * 86_400_000).toISOString().slice(0, 10);
    await owner`
      WITH org AS (SELECT id FROM organisations WHERE slug = 'artemis'),
      sam AS (SELECT id FROM users WHERE email = 'sam@artemis.example'),
      mission AS (
        INSERT INTO missions (org_id, ref, name, period, status, owner_id, submitted_by, submission_no)
        SELECT org.id, ${ref}, ${`Table ${ref}`}, daterange(${day}::date, ${day}::date + 1), ${status}, sam.id,
               CASE WHEN ${status} = 'draft' THEN NULL ELSE sam.id END, CASE WHEN ${status} = 'draft' THEN 0 ELSE 1 END
        FROM org, sam RETURNING id, org_id, period, owner_id),
      requirement AS (
        INSERT INTO mission_requirements (org_id, mission_id, skill_id, min_level)
        SELECT mission.org_id, mission.id, skills.id, 1 FROM mission JOIN skills ON skills.org_id = mission.org_id AND skills.name = 'pilot'
        RETURNING id, mission_id)
      INSERT INTO assignments (org_id, ref, mission_id, requirement_id, crew_member_id, period, status, created_by)
      SELECT mission.org_id, ${ref}, mission.id, requirement.id, crew_members.id, mission.period, 'accepted', mission.owner_id
      FROM mission JOIN requirement ON requirement.mission_id = mission.id
      JOIN crew_members ON crew_members.org_id = mission.org_id AND crew_members.name = 'Ben Osei'
      WHERE ${status} = 'approved'`;
  }
});

async function missionState(ref: number) {
  const [row] = await owner`
    SELECT m.status, (SELECT count(*)::int FROM mission_events e WHERE e.mission_id = m.id) AS events,
           (SELECT e.type || ' ' || e.from_status || ' ' || e.to_status FROM mission_events e WHERE e.mission_id = m.id) AS event
    FROM missions m JOIN organisations o ON o.id = m.org_id WHERE o.slug = 'artemis' AND m.ref = ${ref}`;
  return row;
}

describe('every transition, from every status, by every role', () => {
  it.each(CASES.map((testCase, index) => ({ ...testCase, ref: FIRST_REF + index })))(
    '$actor makes $transition on a $status mission: $expected',
    async ({ status, transition, actor, expected, ref }) => {
      const response = await callers[actor].post(`/v1/missions/MSN-${ref}/${transition}`, { note: 'Table test.' });
      expect(response.status).toBe(expected);
      if (expected === 200) {
        expect(await missionState(ref)).toEqual({ status: TO[transition], events: 1, event: `${transition} ${status} ${TO[transition]}` });
      } else {
        expect(await missionState(ref)).toEqual({ status, events: 0, event: null });
      }
    },
  );

  it('covers every transition but withdraw, which is designed and not built', () => {
    expect(TRANSITIONS).toEqual(CONTRACT_TRANSITIONS.filter((transition) => transition !== 'withdraw'));
  });
});
