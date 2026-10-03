import { type CrewMission, type Mission, type MissionCrew, type MissionEvent, PLACED_ASSIGNMENT_STATUSES, type Requirement } from '@mission-control/contract';
import { formatTime } from './print.ts';
import type { Paint } from './style.ts';
import { columns, counted, describeProblem, formatPeriod, outOf100, yearOf } from './words.ts';

// What `mctl mission show`, `mission list` and `mission history` print (DESIGN.md section 8). Here
// the crew is context, so each slot takes one line: who fills it, their score, who chose them, and
// any problem.

const isPlaced = (crew: MissionCrew) => PLACED_ASSIGNMENT_STATUSES.some((status) => status === crew.status);

/** The crew in a requirement's slots, in slot order, and the declined crew who no longer fill one. */
const slotsOf = (requirement: Requirement) => ({
  placed: requirement.crew.filter(isPlaced),
  declined: requirement.crew.filter((crew) => !isPlaced(crew)),
});

/** How many of a mission's slots are filled, and how many it has. */
export function fillCount(mission: Mission) {
  return mission.requirements.reduce(
    (count, requirement) => ({ filled: count.filled + Math.min(slotsOf(requirement).placed.length, requirement.headcount), slots: count.slots + requirement.headcount }),
    { filled: 0, slots: 0 },
  );
}

const crewName = ({ crew_member: crewMember }: MissionCrew) => `${crewMember.name} ${crewMember.ref}`;

/** Where a crew member came from: the matcher's run, or the person who assigned them by hand. */
const origin = (crew: MissionCrew) => (crew.match_run ? `chosen by the matcher (${crew.match_run})` : `chosen by ${crew.assigned_by.name}`);

/** One line per slot: number, assignment, crew member, score, status, origin and any problem. */
function requirementLines(requirement: Requirement, year: string, width: number, style: Paint): string[] {
  const { placed, declined } = slotsOf(requirement);
  const slotNumber = (number: number) => `${number} of ${requirement.headcount}`;
  const numberWidth = slotNumber(requirement.headcount).length;
  const crewLine = (label: string, crew: MissionCrew) => {
    const score = crew.score === null ? '' : `score ${outOf100(crew.score)}`;
    const status = crew.status === 'declined' ? `declined${crew.decline_reason ? `: ${crew.decline_reason}` : ''}` : crew.status;
    const problems = crew.problems.map((problem) => style('red', `✗ ${describeProblem(problem, requirement.skill, year)}`));
    return ['  ' + label.padEnd(numberWidth), crew.assignment, crewName(crew).padEnd(width), score.padEnd(8), status, origin(crew), ...problems].join('  ');
  };
  const open = Math.max(0, requirement.headcount - placed.length);
  return [
    `${style('bold', requirement.skill)}  ${style('dim', `level ${requirement.min_level} or above`)}`,
    ...placed.map((crew, index) => crewLine(slotNumber(index + 1), crew)),
    ...Array.from({ length: open }, (_, index) => `  ${slotNumber(placed.length + index + 1)}  ${style('yellow', 'open')}`),
    ...declined.map((crew) => style('dim', crewLine('', crew))),
  ];
}

/** Who has approved the current submission, out of how many the organisation requires. */
function approvalLine(mission: Mission): string[] {
  if (mission.status === 'draft') return [];
  const { required, approved_by: approvedBy } = mission.approval;
  return [`Approvals: ${approvedBy.length} of ${required}${approvedBy.length > 0 ? ` — ${approvedBy.map(({ name }) => name).join(', ')}` : ''}`];
}

/** `mctl mission show`: the mission, who owns and submitted it, its approvals, and a line per slot. */
export function missionLines(mission: Mission, style: Paint): string[] {
  const year = yearOf(mission.from);
  const crew = mission.requirements.flatMap((requirement) => requirement.crew);
  const width = Math.max(0, ...crew.map((each) => crewName(each).length));
  const { filled, slots } = fillCount(mission);
  return [
    `${style('bold', `${mission.ref}  ${mission.name}`)}  ${style('dim', formatPeriod(mission.from, mission.to))}`,
    [mission.status, `owner ${mission.owner.name}`, ...(mission.submitted_by ? [`submitted by ${mission.submitted_by.name}`] : [])].join(' · '),
    ...approvalLine(mission),
    ...(mission.description ? [mission.description] : []),
    '',
    ...(mission.requirements.length === 0
      ? ['No requirements yet.']
      : [`${filled} of ${counted(slots, 'slot')} filled`, ...mission.requirements.flatMap((requirement) => requirementLines(requirement, year, width, style))]),
  ];
}

/** The clashes a mission's proposals make, each naming the crew member and the other mission with its owner. */
const clashesOf = (mission: Mission) =>
  mission.requirements.flatMap((requirement) =>
    requirement.crew.flatMap((crew) =>
      crew.problems.flatMap((problem) => (problem.kind === 'clash' ? [`${crew.crew_member.name} also on ${problem.mission.ref} (${problem.mission.owner})`] : [])),
    ),
  );

/** `mctl mission list`: a line per mission, marking every clash and counting other problems. */
export function missionListLines(missions: Mission[], style: Paint): string[] {
  if (missions.length === 0) return ['No missions yet.'];
  const marked = missions.map((mission) => {
    const { filled, slots } = fillCount(mission);
    const clashes = clashesOf(mission);
    const problems = mission.requirements.flatMap((requirement) => requirement.crew.flatMap((crew) => crew.problems)).length - clashes.length;
    return {
      cells: [mission.ref, mission.name, formatPeriod(mission.from, mission.to), mission.status, mission.owner.name, `${filled} of ${slots} filled`],
      marks: [
        ...clashes.map((clash) => style('red', `✗ clash: ${clash}`)),
        ...(problems > 0 ? [style('red', `✗ ${counted(problems, 'other problem')}`)] : []),
      ],
    };
  });
  // The marks go last, as one cell, so the columns before them line up.
  return columns(marked.map(({ cells, marks }) => [...cells, marks.join('  ')]));
}

/** A crew member's own missions: each one's name, period and their slot. */
export function crewMissionLines(missions: CrewMission[]): string[] {
  if (missions.length === 0) return ['No missions you are offered or accepted on.'];
  return columns(missions.map(({ ref, name, from, to, slot }) => [ref, name, formatPeriod(from, to), slot.skill, slot.status, slot.assignment]));
}

/** `mctl mission history`: who did what, and when. */
export function historyLines(events: MissionEvent[]): string[] {
  return columns(
    events.map(({ type, from_status: from, to_status: to, actor, note, at }) => [
      formatTime(at),
      type,
      from && to ? `${from} → ${to}` : '',
      actor.name,
      note ? `“${note}”` : '',
    ]),
  );
}

/** Where a submitted mission stands after one more approval that did not yet meet the policy. */
export function approvalProgress(mission: Mission): string {
  const { required, approved_by: approvedBy } = mission.approval;
  const more = required - approvedBy.length;
  const waitingFor = more === 1 ? 'one more director approves' : `${more} more directors approve`;
  return `Approved (${approvedBy.length} of ${required}). ${mission.ref} stays ${mission.status} until ${waitingFor}.`;
}

/** The command a mission's state most likely calls for next, if any. */
export function nextForMission(mission: Mission): string | null {
  const { ref } = mission;
  const crew = mission.requirements.flatMap((requirement) => requirement.crew);
  const { filled, slots } = fillCount(mission);
  switch (mission.status) {
    case 'draft': {
      const withProblem = crew.find((each) => each.problems.length > 0);
      if (withProblem) return `mctl assignment remove ${withProblem.assignment}`;
      if (mission.requirements.length === 0) return `mctl mission require ${ref} --skill <skill> --level <level>`;
      return filled < slots ? `mctl match run ${ref}` : `mctl mission submit ${ref}`;
    }
    case 'submitted':
      return `mctl mission approve ${ref}`;
    case 'approved':
      if (filled < slots) return `mctl match run ${ref}`;
      return crew.filter(isPlaced).every((each) => each.status === 'accepted') ? `mctl mission launch ${ref}` : null;
    case 'active':
      return `mctl mission complete ${ref}`;
    case 'completed':
    case 'cancelled':
      return `mctl mission history ${ref}`;
  }
}
