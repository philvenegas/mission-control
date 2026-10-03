import type { LOSS_REASONS, MatchRun, Mission, ScoreComponentResponse } from '@mission-control/contract';
import { formatTime } from './print.ts';
import type { Paint } from './style.ts';
import { counted, describeFailure, formatPeriod, nameMission, outOf100, yearOf } from './words.ts';

// What `mctl match run` and `mctl match show` print (DESIGN.md section 8, "What `mctl match run`
// prints"): the verdict first, a block per slot with the reasons in words, then who was excluded
// with the skill, and a footer naming the run and the next commands.

type SlotResult = MatchRun['slots'][number];
type NearestMiss = NonNullable<SlotResult['unfilled']>['nearest_misses'][number];
type LossReason = (typeof LOSS_REASONS)[number];
/** What the header and the commands need of the run's mission. */
export type RunMission = Pick<Mission, 'ref' | 'name' | 'from' | 'to' | 'status'>;

/** At most this many crew excluded with the skill are named; the rest are counted. */
export const MAX_EXCLUDED_SHOWN = 5;

/** A slot as a person names it: "pilot", or "medic 1 of 2" when the requirement has more than one. */
const slotLabel = ({ slot }: SlotResult) => (slot.headcount > 1 ? `${slot.skill} ${slot.number} of ${slot.headcount}` : slot.skill);

/** One component's points out of its share of 100, with what earned them: "level 5 (36 of 45)". */
function describeComponent(component: ScoreComponentResponse): string {
  const earned = `(${outOf100(component.points)} of ${outOf100(component.weight)})`;
  switch (component.name) {
    case 'proficiency':
      return `level ${component.level} ${earned}`;
    case 'workload':
      return `${component.days_assigned} of ${component.window_days} days assigned ${earned}`;
    case 'rest':
      return `${component.days_rested === null ? 'never flown' : `${counted(component.days_rested, 'day')} rested`} ${earned}`;
  }
}

/** How many crew were lost to one reason, as a phrase: "1 below level 4", "9 do not have geologist". */
function describeLoss(reason: LossReason, count: number, { skill, min_level: minLevel }: SlotResult['slot']): string {
  const verb = (singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;
  const phrases: Record<LossReason, string> = {
    active: verb('is inactive', 'are inactive'),
    no_skill: verb(`does not have ${skill}`, `do not have ${skill}`),
    below_level: `${count} below level ${minLevel}`,
    certification: verb(`has a ${skill} certification that expires too soon`, `have a ${skill} certification that expires too soon`),
    availability: verb('has an availability block', 'have an availability block'),
    free: verb('is on another mission then', 'are on another mission then'),
    not_declined: verb('declined this mission', 'declined this mission'),
    not_on_mission: verb('is already in another slot', 'are already in other slots'),
    chosen_for_another_slot: verb('fills another slot', 'fill other slots'),
  };
  return phrases[reason];
}

/**
 * The commands that would make a requirement's unfilled slots fillable, on a draft: lowering the
 * level to that of a nearest miss who lacks only level, and lowering the headcount to the slots filled.
 */
function fixesFor(mission: RunMission, { skill, min_level: minLevel, headcount }: SlotResult['slot'], nearestMisses: NearestMiss[], unfilledOfSkill: number): string[] {
  const require = (level: number, count: number) => `mctl mission require ${mission.ref} --skill ${skill} --level ${level} --count ${count}`;
  const shortOnlyOfLevel = nearestMisses.filter(({ failures }) =>
    failures.every((failure) => failure.constraint === 'skill' && failure.level !== null),
  );
  const lowerLevel = Math.max(0, ...shortOnlyOfLevel.map(({ level }) => level));
  const filled = headcount - unfilledOfSkill;
  const fixes: [string, string][] = [];
  if (lowerLevel > 0) fixes.push(['lower the level:', require(lowerLevel, headcount)]);
  if (filled > 0) fixes.push([fixes.length > 0 ? 'or the headcount:' : 'lower the headcount:', require(minLevel, filled)]);
  else fixes.push([fixes.length > 0 ? 'or drop it:' : 'drop it:', `mctl mission unrequire ${mission.ref} --skill ${skill}`]);
  const width = Math.max(...fixes.map(([label]) => label.length));
  return fixes.map(([label, command]) => `${label.padEnd(width)} ${command}`);
}

function slotBlock(run: MatchRun, mission: RunMission, result: SlotResult, style: Paint): string[] {
  const year = yearOf(mission.from);
  const lines = ['', `${style('bold', slotLabel(result))}  ${style('dim', `level ${result.slot.min_level} or above`)}`];
  const { chosen, unfilled } = result;
  if (chosen) {
    lines.push(`  ${style('green', '→')} ${style('bold', chosen.crew_member.name)} ${style('dim', chosen.crew_member.ref)}   score ${style('bold', String(outOf100(chosen.score.total)))}`);
    lines.push(`    ${chosen.score.components.map(describeComponent).join(' · ')}`);
    if (chosen.clashes.length > 0) {
      const others = chosen.clashes.map(nameMission).join(' and ');
      lines.push(`    ${style('yellow', `⚠ clash: also proposed on ${others}. Neither mission can be submitted until one lets ${chosen.crew_member.name} go.`)}`);
    }
  }
  if (unfilled) {
    const losses = [...unfilled.lost_to.filter(({ reason }) => reason !== 'no_skill'), ...unfilled.lost_to.filter(({ reason }) => reason === 'no_skill')];
    const why = losses.length > 0 ? `nobody qualifies: ${losses.map(({ reason, count }) => describeLoss(reason, count, result.slot)).join(', ')}` : 'nobody qualifies';
    lines.push(`  ${style('red', '✗ unfilled')} — ${why}`);
    for (const miss of unfilled.nearest_misses) {
      // A skill failure already says the level they hold.
      const levelSaid = miss.failures.some((failure) => failure.constraint === 'skill');
      const lacks = [...(levelSaid ? [] : [`${result.slot.skill} level ${miss.level}`]), ...miss.failures.map((failure) => describeFailure(failure, result.slot.skill, year))];
      lines.push(`    nearest: ${miss.crew_member.ref} ${miss.crew_member.name} — ${lacks.join(', ')}`);
    }
    // The fixes are the requirement's, so they follow its last unfilled slot.
    const unfilledOfSkill = run.slots.filter(({ slot, unfilled: open }) => slot.skill === result.slot.skill && open !== null);
    if (mission.status === 'draft' && unfilledOfSkill.at(-1) === result) {
      lines.push(...fixesFor(mission, result.slot, unfilled.nearest_misses, unfilledOfSkill.length).map((fix) => `    ${style('dim', fix)}`));
    }
  }
  // On an unfilled slot every alternate fills another, which the count of losses already says.
  if (chosen && result.alternates.length > 0) {
    const named = result.alternates.map((alternate) => {
      const elsewhere = run.slots.filter((other) => other.chosen?.crew_member.ref === alternate.crew_member.ref);
      const notes = [
        ...elsewhere.map((other) => `chosen for ${slotLabel(other)}`),
        ...alternate.clashes.map((clash) => `clash with ${clash.ref}`),
      ];
      return `${alternate.crew_member.name} ${outOf100(alternate.score)}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
    });
    lines.push(style('dim', `    alternates: ${named.join(', ')}`));
  }
  return lines;
}

/** The run, as a person reads it: the verdict, a block per slot, and who was excluded with the skill. */
export function matchRunLines(run: MatchRun, mission: RunMission, style: Paint): string[] {
  const filled = run.summary.already_filled + run.summary.filled;
  const verdict = `${filled} of ${counted(run.summary.slots, 'slot')} filled`;
  const lines = [
    `${style('bold', `${mission.ref}  ${mission.name}`)}  ${style('dim', formatPeriod(mission.from, mission.to))}`,
    filled === run.summary.slots ? style('green', `✓ ${verdict}`) : style('yellow', `! ${verdict}`),
    ...run.slots.flatMap((result) => slotBlock(run, mission, result, style)),
  ];
  if (run.ruled_out.length > 0) {
    const year = yearOf(mission.from);
    const shown = run.ruled_out.slice(0, MAX_EXCLUDED_SHOWN).map(
      ({ crew_member: crewMember, skill, failures }) => `  ${crewMember.ref} ${crewMember.name} — ${failures.map((failure) => describeFailure(failure, skill, year)).join(', ')}`,
    );
    const more = run.ruled_out.length - shown.length;
    lines.push('', style('dim', ['Excluded with the skill:', ...shown, ...(more > 0 ? [`  and ${more} more`] : [])].join('\n')));
  }
  return lines;
}

/**
 * The run's reference and what to do with it: apply it, or pick an alternate by hand. A run that
 * has been applied says when; one that fills no slot has nothing to apply.
 */
export function matchRunFooter(run: MatchRun, style: Paint): string[] {
  if (run.applied_at !== null) return ['', style('dim', `${run.ref} was applied at ${formatTime(run.applied_at)}.`)];
  if (run.summary.filled === 0) return ['', style('dim', `Saved as ${run.ref}. It fills no slot, so there is nothing to apply.`)];
  const freeAlternate = run.slots.flatMap(({ slot, chosen, alternates }) =>
    chosen ? alternates.filter((alternate) => !alternate.chosen_for_another_slot && alternate.clashes.length === 0).map((alternate) => ({ slot, alternate })) : [],
  )[0];
  return [
    '',
    style(
      'dim',
      [
        `Saved as ${run.ref}. Nothing has changed yet.`,
        `  Apply it:      mctl match apply ${run.ref}`,
        ...(freeAlternate ? [`  Pick another:  mctl assignment add ${run.mission} --crew ${freeAlternate.alternate.crew_member.ref} --skill ${freeAlternate.slot.skill}`] : []),
      ].join('\n'),
    ),
  ];
}
