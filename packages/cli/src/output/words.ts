import type { AssignmentStatus, ConstraintFailureResponse, MissionStatus, Problem } from '@mission-control/contract';

// The API gives reasons as data; this puts them into words for a person (DESIGN.md section 6.6,
// "The matcher returns data, not sentences" in the README).

/** The months' short names, three letters each, in order. */
const MONTHS = 'JanFebMarAprMayJunJulAugSepOctNovDec';

/** A day written `2027-03-01`, as its year, the month's short name and the day of the month. */
const partsOf = (day: string) => {
  const month = Number(day.slice(5, 7));
  return { year: day.slice(0, 4), month: MONTHS.slice(3 * (month - 1), 3 * month), date: String(Number(day.slice(8, 10))) };
};

/** A day as a person reads it: "10 Mar 2027", or "10 Mar" when the year goes without saying. */
export function formatDay(day: string, withYear = true) {
  const { year, month, date } = partsOf(day);
  return withYear ? `${date} ${month} ${year}` : `${date} ${month}`;
}

/**
 * A period as a person reads it, both ends as written: "1–20 Mar 2027", "4 Apr – 2 May 2027",
 * "15 Oct 2026 – 10 Feb 2027". Without the year, "5–12 Mar", for a period inside a mission's year.
 */
export function formatPeriod(from: string, to: string, withYear = true) {
  const start = partsOf(from);
  const end = partsOf(to);
  const year = withYear ? ` ${end.year}` : '';
  if (start.year !== end.year) return `${formatDay(from)} – ${formatDay(to)}`;
  if (start.month !== end.month) return `${start.date} ${start.month} – ${end.date} ${end.month}${year}`;
  return `${start.date}–${end.date} ${end.month}${year}`;
}

/** A period mentioned beside a mission: without the year when it falls in the mission's year. */
const periodBeside = (missionYear: string, from: string, to: string) =>
  formatPeriod(from, to, partsOf(from).year !== missionYear || partsOf(to).year !== missionYear);

/** A day mentioned beside a mission: without the year when it falls in the mission's year. */
const dayBeside = (missionYear: string, day: string) => formatDay(day, partsOf(day).year !== missionYear);

/** The year a mission starts in, which dates beside it leave out. */
export const yearOf = (day: string) => partsOf(day).year;

/** A score from 0 to 1, out of 100, as a person reads it. */
export const outOf100 = (score: number) => Math.round(score * 100);

/** "1 crew member", "2 crew members": a count and a noun, made plural when it needs to be. */
export const counted = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

/** Another mission, as a reason names it: "MSN-5 Vesta Mapping (draft, owner Priya Nair)". */
export const nameMission = ({ ref, name, status, owner }: { ref: string; name: string; status: MissionStatus; owner: string }) =>
  `${ref} ${name} (${status}, owner ${owner})`;

/** How a crew member stands on another mission, by their assignment's status there. Only a live one fails a constraint. */
const ON_ANOTHER_MISSION: Record<AssignmentStatus, string> = {
  proposed: 'proposed on',
  held: 'held by',
  offered: 'offered a place on',
  accepted: 'on',
  declined: 'declined',
  released: 'released from',
};

/**
 * One failed hard constraint, as what the crew member lacks for a slot needing `skill`:
 * "availability block AVL-3, 5–12 Mar", "geologist level 3, needs 4".
 */
export function describeFailure(failure: ConstraintFailureResponse, skill: string, missionYear: string): string {
  switch (failure.constraint) {
    case 'active':
      return 'inactive';
    case 'skill':
      return failure.level === null ? `does not have ${skill}` : `${skill} level ${failure.level}, needs ${failure.min_level}`;
    case 'certification':
      return `${skill} certification expires ${dayBeside(missionYear, failure.certified_until)}, before the mission ends`;
    case 'availability':
      return `availability block ${failure.block.ref}, ${periodBeside(missionYear, failure.block.from, failure.block.to)}`;
    case 'free': {
      const { status, mission, from, to } = failure.assignment;
      return `${ON_ANOTHER_MISSION[status]} ${nameMission(mission)}, ${periodBeside(missionYear, from, to)}`;
    }
    case 'not_declined':
      return `declined ${failure.assignment.mission.ref}`;
    case 'not_on_mission':
      return `already in another slot of this mission (${failure.assignment.ref})`;
  }
}

/** A problem with a proposed assignment, in words. */
export function describeProblem(problem: Problem, skill: string, missionYear: string): string {
  return problem.kind === 'clash' ? `clash: also proposed on ${nameMission(problem.mission)}` : describeFailure(problem.failure, skill, missionYear);
}

/** Rows of cells, each column as wide as its widest cell, two spaces apart; trailing space trimmed. */
export function columns(rows: string[][]): string[] {
  const widthOf = (column: number) => Math.max(...rows.flatMap((row) => row.slice(column, column + 1).map((cell) => cell.length)));
  return rows.map((cells) => cells.map((cell, column) => cell.padEnd(widthOf(column))).join('  ').trimEnd());
}
