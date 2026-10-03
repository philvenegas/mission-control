import {
  type ApplyMatchRun,
  formatRef,
  type MatchRun,
  type MatchRunResult,
  matchRunResultSchema,
  type Mission,
} from '@mission-control/contract';
import { assessCandidate, match } from '@mission-control/matcher';
import { reaches } from '../../auth/policy.ts';
import { refNumber, takeNextRef } from '../../db/refs.ts';
import { exactlyOne } from '../../db/rows.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { DomainError, notFound } from '../../errors.ts';
import { placeCrewMember } from '../assignments/service.ts';
import { listCrewMembers } from '../crew/repository.ts';
import { getMissionByRef } from '../missions/repository.ts';
import { describeMission, lockMissionForCrewChange, resolveMissionForCrewChange } from '../missions/service.ts';
import { getOrganisation } from '../org/repository.ts';
import { crewInputs, currentRequirements, matchedMission } from './candidates.ts';
import { nameCrewMember, nameMission, reasonsFor } from './reasons.ts';
import { findMatchRunByRef, insertMatchRun, markApplied, type MatchRunRow } from './repository.ts';
import { toMatchRunResult } from './result.ts';

/** A saved run as the API gives it: who made it and when, the weights in force, and what it proposed. */
const toMatchRun = (run: MatchRunRow, result: MatchRunResult): MatchRun => ({
  ref: formatRef('match_run', run.ref),
  mission: formatRef('mission', run.missionRef),
  created_by: run.createdBy,
  created_at: run.createdAt.toISOString(),
  applied_at: run.appliedAt?.toISOString() ?? null,
  weights: run.weights,
  ...result,
});

/**
 * Runs the matcher over a mission's open slots and saves what it proposes as a match run. Nothing
 * else changes until the run is applied. Every crew member is weighed, so an unfilled slot can say
 * how many lacked the skill altogether.
 */
export async function runMatcher(context: TenantContext, missionRef: string): Promise<MatchRun> {
  const mission = await resolveMissionForCrewChange(context, missionRef);
  const [requirements, crew, { settings }] = await Promise.all([
    currentRequirements(context, mission),
    listCrewMembers(context).then((rows) => crewInputs(context, rows)),
    getOrganisation(context),
  ]);
  const result = toMatchRunResult(match({ mission: matchedMission(mission), requirements, crew, weights: settings.match_weights }));
  const ref = await takeNextRef(context, 'match_run');
  await insertMatchRun(context, { ref, missionId: mission.id, result, weights: settings.match_weights });
  return showMatchRun(context, formatRef('match_run', ref));
}

/** A run the caller may see: one on a mission they may change the crew of. Any other is not found. */
async function resolveMatchRun(context: TenantContext, runRef: string): Promise<MatchRunRow> {
  const run = await findMatchRunByRef(context, refNumber('match_run', runRef));
  if (!run || !reaches(context, 'missions:assign-crew', run.missionOwnerId)) throw notFound(runRef);
  return run;
}

/** A match run, to the mission's owner and directors. */
export async function showMatchRun(context: TenantContext, runRef: string): Promise<MatchRun> {
  const run = await resolveMatchRun(context, runRef);
  return toMatchRun(run, matchRunResultSchema.parse(run.result));
}

/**
 * Turns a run into assignments, all or nothing: proposed on a draft, offered on an approved
 * mission. Every crew member it chose is checked again against the hard constraints and the slots
 * still open; if any fails, nothing is applied. A crew member it would place despite a clash needs
 * `allow_clashes`. A run applies once.
 */
export async function applyMatchRun(context: TenantContext, runRef: string, { allow_clashes: allowClashes }: ApplyMatchRun): Promise<Mission> {
  const { missionRef: missionNumber } = await resolveMatchRun(context, runRef);
  const mission = await lockMissionForCrewChange(context, await getMissionByRef(context, missionNumber));
  // Read again under the lock, so a run another request has just applied is seen as applied.
  const run = await resolveMatchRun(context, runRef);
  if (run.appliedAt !== null) {
    throw new DomainError('RUN_ALREADY_APPLIED', `${runRef} has already been applied.`, 'Run the matcher again for a new proposal.');
  }

  const missionRef = formatRef('mission', mission.ref);
  const requirements = await currentRequirements(context, mission);
  const chosen = matchRunResultSchema.parse(run.result).slots.flatMap(({ slot, chosen }) => (chosen ? [{ skill: slot.skill, ...chosen }] : []));
  const chosenRefs = new Set(chosen.map(({ crew_member: crewMember }) => crewMember.ref));
  const crew = await crewInputs(context, (await listCrewMembers(context)).filter((row) => chosenRefs.has(formatRef('crew_member', row.ref))));
  const { settings } = await getOrganisation(context);

  const problems: string[] = [];
  const clashes: string[] = [];
  const newAssignments = chosen.flatMap(({ skill, crew_member: crewMember, score }) => {
    const requirement = requirements.find((each) => each.skill === skill);
    if (!requirement) {
      problems.push(`${missionRef} no longer needs a ${skill}`);
      return [];
    }
    const chosenBefore = chosen.filter((other) => other.skill === skill).findIndex((other) => other.crew_member.ref === crewMember.ref);
    if (requirement.filled + chosenBefore >= requirement.headcount) {
      problems.push(`${missionRef} has no open ${skill} slot left for ${nameCrewMember(crewMember)}`);
      return [];
    }
    const candidate = exactlyOne(crew.filter((each) => each.ref === crewMember.ref), 'crew member');
    const assessment = assessCandidate({ crew: candidate, need: requirement, mission: matchedMission(mission) }, settings.match_weights);
    problems.push(...reasonsFor(crewMember, skill, assessment.failures));
    if (assessment.clashes.length > 0) {
      clashes.push(`${nameCrewMember(crewMember)}, who is also proposed on ${assessment.clashes.map(nameMission).join(' and ')}`);
    }
    return [{ requirementId: requirement.id, crewMemberId: candidate.id, score: score.total }];
  });

  if (problems.length > 0) {
    throw new DomainError('RUN_OUT_OF_DATE', `${runRef} cannot be applied, so none of it was: ${problems.join('; ')}.`, `Run the matcher again for ${missionRef}.`);
  }
  if (clashes.length > 0 && !allowClashes) {
    throw new DomainError(
      'CLASH_NOT_ALLOWED',
      `${runRef} proposes ${clashes.join('; and ')}.`,
      'Neither mission can be submitted until one lets them go. To apply it anyway, say allow_clashes.',
    );
  }
  for (const assignment of newAssignments) {
    await placeCrewMember(context, mission, { ...assignment, matchRunId: run.id });
  }
  await markApplied(context, run.id);
  return describeMission(context, mission);
}
