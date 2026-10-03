// The matcher (DESIGN.md section 6): a pure function from a mission's open slots and the crew to a
// proposed crew and its explanation. It knows nothing of HTTP or the database.
export type { ConstraintFailure } from './constraints.ts';
export type { AssignmentInput, CrewInput, MatchedMission, MatchInput, MissionSummary, RequirementInput, Slot } from './input.ts';
export { match } from './match.ts';
export type {
  Alternate,
  ChosenCrewMember,
  CrewMemberSummary,
  LossReason,
  MatchOutput,
  NearestMiss,
  RuledOutCrewMember,
  SlotResult,
} from './match.ts';
export type { Score, ScoreComponent } from './scorers.ts';
