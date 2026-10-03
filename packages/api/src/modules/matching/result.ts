import type { ConstraintFailureResponse, MatchRunResult } from '@mission-control/contract';
import type { AssignmentInput, ConstraintFailure, CrewMemberSummary, MatchOutput, MissionSummary, Score } from '@mission-control/matcher';

// The matcher's output, in the API's own shape: field names as every response writes them, and
// every record named by its reference.

const crewMember = ({ ref, name }: CrewMemberSummary) => ({ ref, name });

const missionSummary = ({ ref, name, status, owner }: MissionSummary) => ({ ref, name, status, owner });

const assignment = ({ ref, mission, period, status }: AssignmentInput) => ({
  ref,
  mission: missionSummary(mission),
  from: period.from,
  to: period.to,
  status,
});

const score = ({ total, components }: Score) => ({
  total,
  components: components.map(({ name, value, weight, points }) => ({ name, value, weight, points })),
});

export function toFailureResponse(failure: ConstraintFailure): ConstraintFailureResponse {
  switch (failure.constraint) {
    case 'active':
      return { constraint: 'active' };
    case 'skill':
      return { constraint: 'skill', level: failure.level, min_level: failure.minLevel };
    case 'certification':
      return { constraint: 'certification', certified_until: failure.certifiedUntil, last_day: failure.lastDay };
    case 'availability':
      return { constraint: 'availability', block: { ref: failure.block.ref, from: failure.block.period.from, to: failure.block.period.to } };
    case 'free':
    case 'not_declined':
    case 'not_on_mission':
      return { constraint: failure.constraint, assignment: assignment(failure.assignment) };
  }
}

export function toMatchRunResult(output: MatchOutput): MatchRunResult {
  return {
    slots: output.slots.map(({ slot, chosen, alternates, unfilled }) => ({
      slot: { skill: slot.skill, min_level: slot.minLevel, number: slot.number, headcount: slot.headcount },
      chosen: chosen && { crew_member: crewMember(chosen.crewMember), score: score(chosen.score), clashes: chosen.clashes.map(missionSummary) },
      alternates: alternates.map((alternate) => ({
        crew_member: crewMember(alternate.crewMember),
        score: alternate.score,
        chosen_for_another_slot: alternate.chosenForAnotherSlot,
        clashes: alternate.clashes.map(missionSummary),
      })),
      unfilled: unfilled && {
        lost_to: unfilled.lostTo,
        nearest_misses: unfilled.nearestMisses.map((miss) => ({ crew_member: crewMember(miss.crewMember), failures: miss.failures.map(toFailureResponse) })),
      },
    })),
    ruled_out: output.ruledOut.map((ruledOut) => ({
      crew_member: crewMember(ruledOut.crewMember),
      skill: ruledOut.skill,
      failures: ruledOut.failures.map(toFailureResponse),
    })),
    summary: {
      slots: output.summary.slots,
      already_filled: output.summary.alreadyFilled,
      open: output.summary.open,
      filled: output.summary.filled,
      clashes: output.summary.clashes,
    },
  };
}
