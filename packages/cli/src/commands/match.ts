import { type MatchRun, matchRunSchema, type Mission, missionSchema, parseRef } from '@mission-control/contract';
import type { Command } from 'commander';
import type { ApiAnswer } from '../api.ts';
import type { Context } from '../context.ts';
import { CliError } from '../errors.ts';
import { matchRunFooter, matchRunLines } from '../output/match.ts';
import { fillCount } from '../output/mission.ts';
import { printAnswer, printLines } from '../output/print.ts';
import { counted, describeProblem, yearOf } from '../output/words.ts';
import { confirm } from '../prompt.ts';
import { callAsSession, type Session } from '../session.ts';
import { apiPath, type Perform, printNextFor, startSession, styleOf, type YesOption } from './shared.ts';

// `mctl match`: run the matcher, read a run's reasoning, and apply it (DESIGN.md sections 6.6 and 8).

/** The run as a person reads it, under its mission's name and period. */
async function runLines(context: Context, session: Session, run: MatchRun) {
  const { data: mission } = await callAsSession(session, { method: 'GET', path: apiPath('missions', run.mission) }, missionSchema);
  return matchRunLines(run, mission, styleOf(context));
}

/**
 * Applies a run. A run that would place someone despite a clash is refused by the API unless told
 * otherwise: with `--yes` it is told at once; on a terminal the person is asked, with the API's
 * naming of the clash; with neither, the refusal stands.
 */
async function applyRun(context: Context, session: Session, runRef: string, yes: boolean | undefined): Promise<ApiAnswer<Mission>> {
  const apply = (allowClashes: boolean) =>
    callAsSession(session, { method: 'POST', path: apiPath('match-runs', runRef, 'apply'), body: allowClashes ? { allow_clashes: true } : {} }, missionSchema);
  try {
    return await apply(yes === true);
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'CLASH_NOT_ALLOWED') throw error;
    const cannotAsk = new CliError(error.failure, error.message, 'Neither mission can be submitted until one lets them go. Add --yes to apply it anyway.', error.code);
    await confirm(context.io.stdin, context.io.stderr, `${error.message} Apply it anyway?`, cannotAsk);
    return apply(true);
  }
}

/** What applying a run did, and what to do next. */
function printApplied(context: Context, runRef: string, mission: Mission, raw: unknown) {
  const { filled, slots } = fillCount(mission);
  const style = styleOf(context);
  const placed = mission.requirements.flatMap(({ skill, crew }) =>
    crew
      .filter(({ match_run: matchRun }) => matchRun !== null && parseRef('match_run', matchRun) === parseRef('match_run', runRef))
      .map(({ assignment, crew_member: crewMember, status, problems }) =>
        [
          `  ${skill}: ${crewMember.name} ${crewMember.ref}, ${status} (${assignment})`,
          ...problems.map((problem) => style('red', `✗ ${describeProblem(problem, skill, yearOf(mission.from))}`)),
        ].join('  '),
      ),
  );
  printAnswer(context, raw, [`Applied ${runRef}. ${mission.ref} has ${filled} of ${counted(slots, 'slot')} filled.`, ...placed]);
  printNextFor(context, mission);
}

/** `mctl match run`: the matcher's proposal for the mission's open slots, with its reasons. With `--apply`, applies it too. */
async function run(context: Context, missionRef: string, options: YesOption & { apply?: boolean }): Promise<number> {
  const session = startSession(context);
  const runMade = await callAsSession(session, { method: 'POST', path: apiPath('missions', missionRef, 'match') }, matchRunSchema);
  const lines = context.json ? [] : await runLines(context, session, runMade.data);
  if (!options.apply) {
    printAnswer(context, runMade.raw, [...lines, ...matchRunFooter(runMade.data, styleOf(context))]);
    return 0;
  }
  if (!context.json) printLines(context, [...lines, '']);
  const applied = await applyRun(context, session, runMade.data.ref, options.yes);
  // Two calls, so with --json both answers, as they came.
  if (context.json) printAnswer(context, { match_run: runMade.raw, mission: applied.raw }, []);
  else printApplied(context, runMade.data.ref, applied.data, applied.raw);
  return 0;
}

/** `mctl match show`: a saved run, printed as it was when made. */
async function show(context: Context, runRef: string): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: apiPath('match-runs', runRef) }, matchRunSchema);
  const lines = context.json ? [] : await runLines(context, session, data);
  printAnswer(context, raw, [...lines, ...matchRunFooter(data, styleOf(context))]);
  return 0;
}

/** `mctl match apply`: turns a run into assignments, all or nothing. */
async function apply(context: Context, runRef: string, options: YesOption): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await applyRun(context, session, runRef, options.yes);
  printApplied(context, runRef, data, raw);
  return 0;
}

export function registerMatchCommands(program: Command, perform: Perform) {
  const matching = program.command('match').description('run the matcher, read its reasons, and apply a run');
  matching
    .command('run')
    .description('propose crew for a mission\'s open slots, with the reasons; nothing changes until it is applied')
    .argument('<mission>', 'the mission, as MSN-8')
    .option('--apply', 'apply the run straight away')
    .option('--yes', 'with --apply, apply it even if it makes a clash')
    .action(perform(run));
  matching.command('show').description('a run and its reasons, as when it was made').argument('<run>', 'the run, as RUN-1').action(perform(show));
  matching
    .command('apply')
    .description('turn a run into assignments: proposed on a draft, offered on an approved mission')
    .argument('<run>', 'the run, as RUN-1')
    .option('--yes', 'apply it even if it makes a clash, without asking')
    .action(perform(apply));
}
