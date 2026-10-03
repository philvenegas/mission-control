import { MISSION_STATUSES, type MissionStatus, parseRef, TRANSITIONS as CONTRACT_TRANSITIONS } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Caller, loginAs, useSeededApp } from '../../test/app.ts';
import { arrangeMission, dayAfter } from '../../test/arrange.ts';

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

let callers: Record<Actor, Caller>;
/** Each case's mission, by the case's index in CASES. */
const missionRefs: string[] = [];
const missionFor = (index: number) => {
  const missionRef = missionRefs[index];
  if (missionRef === undefined) throw new Error(`No mission was arranged for case ${index}`);
  return missionRef;
};

beforeAll(async () => {
  const [director, missionOwner, otherMissionLead, crewMember] = await Promise.all([
    loginAs(app, 'artemis', 'dana@artemis.example'),
    loginAs(app, 'artemis', 'sam@artemis.example'),
    loginAs(app, 'artemis', 'priya@artemis.example'),
    loginAs(app, 'artemis', 'ada@artemis.example'),
  ]);
  callers = { director, owner: missionOwner, 'other mission lead': otherMissionLead, 'crew member': crewMember };
  // One mission per case, owned by Sam, each on its own day of 2030. Each meets every guard: a
  // requirement, a future start, and its slot filled by Ben (CRW-2), proposed on a draft and
  // accepted on an approved mission, so only the status and the role decide the answer.
  for (const [index, { status }] of CASES.entries()) {
    missionRefs[index] = await arrangeMission(owner, {
      org: 'artemis',
      name: `Table case ${index}`,
      period: dayAfter('2030-01-01', index),
      status,
      owner: 'sam@artemis.example',
      skill: 'pilot',
      crew: status === 'draft' || status === 'approved' ? [{ crewMember: 'CRW-2', status: status === 'draft' ? 'proposed' : 'accepted' }] : [],
    });
  }
});

async function missionState(missionRef: string) {
  const [row] = await owner`
    SELECT m.status, (SELECT count(*)::int FROM mission_events e WHERE e.mission_id = m.id) AS events,
           (SELECT e.type || ' ' || e.from_status || ' ' || e.to_status FROM mission_events e WHERE e.mission_id = m.id) AS event
    FROM missions m JOIN organisations o ON o.id = m.org_id WHERE o.slug = 'artemis' AND m.ref = ${parseRef('mission', missionRef)}`;
  return row;
}

describe('every transition, from every status, by every role', () => {
  it.each(CASES.map((testCase, index) => ({ ...testCase, index })))(
    '$actor makes $transition on a $status mission: $expected',
    async ({ status, transition, actor, expected, index }) => {
      const ref = missionFor(index);
      const response = await callers[actor].post(`/v1/missions/${ref}/${transition}`, { note: 'Table test.' });
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
