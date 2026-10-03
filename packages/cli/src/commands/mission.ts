import { crewMissionSchema, type Mission, missionEventSchema, missionSchema } from '@mission-control/contract';
import type { Command } from 'commander';
import { z } from 'zod';
import type { Context } from '../context.ts';
import { approvalProgress, crewMissionLines, historyLines, missionLines, missionListLines } from '../output/mission.ts';
import { printAnswer, printNext } from '../output/print.ts';
import { counted, formatPeriod } from '../output/words.ts';
import { callAsSession, type Session } from '../session.ts';
import { apiPath, askFirst, type Perform, printNextFor, startSession, styleOf, wholeNumber, type YesOption } from './shared.ts';

// `mctl mission`: create a mission, say what it needs, and move it through its lifecycle.

interface NoteOption {
  note?: string;
}

/** `mctl mission create`: a new draft, owned by whoever creates it. */
async function create(context: Context, options: { name: string; from: string; to: string; description?: string }): Promise<number> {
  const session = startSession(context);
  const { name, from, to, description } = options;
  const { data, raw } = await callAsSession(session, { method: 'POST', path: apiPath('missions'), body: { name, from, to, description } }, missionSchema);
  printAnswer(context, raw, [`Created ${data.ref} ${data.name}, ${formatPeriod(data.from, data.to)}, as a draft.`]);
  printNext(context, `mctl mission require ${data.ref} --skill <skill> --level <level>`);
  return 0;
}

/** `mctl mission list`: every mission the caller may see; a crew member sees only their own slots. */
async function list(context: Context): Promise<number> {
  const session = startSession(context);
  const request = { method: 'GET', path: apiPath('missions') } as const;
  if (session.profile.role === 'crew_member') {
    const { data, raw } = await callAsSession(session, request, z.array(crewMissionSchema));
    printAnswer(context, raw, crewMissionLines(data));
    return 0;
  }
  const { data, raw } = await callAsSession(session, request, z.array(missionSchema));
  printAnswer(context, raw, missionListLines(data, styleOf(context)));
  return 0;
}

/** `mctl mission show`: the mission, a line per slot, and who has approved it. */
async function show(context: Context, ref: string): Promise<number> {
  const session = startSession(context);
  const request = { method: 'GET', path: apiPath('missions', ref) } as const;
  if (session.profile.role === 'crew_member') {
    const { data, raw } = await callAsSession(session, request, crewMissionSchema);
    printAnswer(context, raw, crewMissionLines([data]));
    return 0;
  }
  const { data, raw } = await callAsSession(session, request, missionSchema);
  printAnswer(context, raw, missionLines(data, styleOf(context)));
  printNextFor(context, data);
  return 0;
}

/** `mctl mission require`: sets what the mission needs of one skill, whole. */
async function requireSkill(context: Context, ref: string, options: { skill: string; level: number; count?: number }): Promise<number> {
  const session = startSession(context);
  const body = { min_level: options.level, headcount: options.count };
  const { data, raw } = await callAsSession(session, { method: 'PUT', path: apiPath('missions', ref, 'requirements', options.skill), body }, missionSchema);
  printAnswer(
    context,
    raw,
    data.requirements
      .filter(({ skill }) => skill === options.skill)
      .map(({ skill, min_level: minLevel, headcount }) => `${data.ref} needs ${counted(headcount, 'crew member')} with ${skill} at level ${minLevel} or above.`),
  );
  printNext(context, `mctl match run ${data.ref}`);
  return 0;
}

/** `mctl mission unrequire`: the mission no longer needs the skill. */
async function unrequire(context: Context, ref: string, options: { skill: string }): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'DELETE', path: apiPath('missions', ref, 'requirements', options.skill) }, missionSchema);
  printAnswer(context, raw, [`${data.ref} no longer needs ${options.skill}.`]);
  printNext(context, `mctl mission show ${data.ref}`);
  return 0;
}

/** Makes a transition as the session's user, and gives the mission as it now is. */
function transition(session: Session, ref: string, name: string, note: string | undefined) {
  return callAsSession(session, { method: 'POST', path: apiPath('missions', ref, name), body: note === undefined ? {} : { note } }, missionSchema);
}

/** What a transition prints: one sentence, and the next command with who runs it when that is someone else. */
interface TransitionOutcome {
  sentence: (mission: Mission) => string;
  next: (mission: Mission) => string;
  nextBy?: string;
}

/** A transition whose outcome is one sentence and one next command. */
const simpleTransition =
  (name: string, { sentence, next, nextBy }: TransitionOutcome) =>
  async (context: Context, ref: string, options: NoteOption): Promise<number> => {
    const { data, raw } = await transition(startSession(context), ref, name, options.note);
    printAnswer(context, raw, [sentence(data)]);
    printNext(context, next(data), nextBy);
    return 0;
  };

/**
 * `mctl mission approve`: records the approval, and reports progress when the organisation needs
 * more than one (DESIGN.md section 4, "Approval policy").
 */
async function approve(context: Context, ref: string, options: NoteOption): Promise<number> {
  const { data, raw } = await transition(startSession(context), ref, 'approve', options.note);
  if (data.status === 'approved') {
    printAnswer(context, raw, [`Approved ${data.ref}. Its crew are offered their places.`]);
    printNext(context, `mctl mission show ${data.ref}`);
    return 0;
  }
  printAnswer(context, raw, [approvalProgress(data)]);
  printNext(context, `mctl mission approve ${data.ref}`, 'another director');
  return 0;
}

/** `mctl mission cancel`: asks first, since a cancelled mission cannot come back and its crew are released. */
async function cancel(context: Context, ref: string, options: YesOption & { note: string }): Promise<number> {
  const session = startSession(context);
  await askFirst(context, options.yes, 'mctl mission cancel', `Cancel ${ref}? Its crew are released, and a cancelled mission cannot be reopened.`);
  const { data, raw } = await transition(session, ref, 'cancel', options.note);
  printAnswer(context, raw, [`Cancelled ${data.ref}; its crew are released.`]);
  printNext(context, `mctl mission history ${data.ref}`);
  return 0;
}

/** `mctl mission history`: who did what, and when. */
async function history(context: Context, ref: string): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: apiPath('missions', ref, 'events') }, z.array(missionEventSchema));
  printAnswer(context, raw, data.length === 0 ? [`${ref} has no history yet.`] : historyLines(data));
  return 0;
}

export function registerMissionCommands(program: Command, perform: Perform) {
  const missions = program.command('mission').description('plan missions and move them through approval');
  missions
    .command('create')
    .description('create a mission, as a draft you own')
    .requiredOption('--name <name>', 'the mission\'s name')
    .requiredOption('--from <day>', 'its first day, as 2027-03-01')
    .requiredOption('--to <day>', 'the day it ends, as 2027-03-20; the period runs up to it')
    .option('--description <text>', 'what the mission is for')
    .action(perform(create));
  missions.command('list').description('every mission you can see, marking clashes').action(perform(list));
  missions.command('show').description('a mission, a line per slot, and who has approved it').argument('<mission>', 'the mission, as MSN-8').action(perform(show));
  missions
    .command('require')
    .description('say what a draft needs of one skill: the level, and how many crew')
    .argument('<mission>', 'the mission, as MSN-8')
    .requiredOption('--skill <skill>', 'the skill, as the organisation names it')
    .requiredOption('--level <level>', 'the lowest level that will do, 1 to 5', wholeNumber)
    .option('--count <count>', 'how many crew with the skill; one unless given', wholeNumber)
    .action(perform(requireSkill));
  missions
    .command('unrequire')
    .description('a draft no longer needs a skill')
    .argument('<mission>', 'the mission, as MSN-8')
    .requiredOption('--skill <skill>', 'the skill')
    .action(perform(unrequire));
  const transitions: [string, string, (context: Context, ref: string, options: NoteOption) => Promise<number>][] = [
    [
      'submit',
      'submit a draft for approval; its crew are held',
      simpleTransition('submit', {
        sentence: (mission) => `Submitted ${mission.ref} for approval; its crew are held.`,
        next: (mission) => `mctl mission approve ${mission.ref}`,
        nextBy: 'a director',
      }),
    ],
    ['approve', 'approve a submitted mission, as a director who did not submit it', approve],
    [
      'launch',
      'launch an approved mission once every slot is accepted',
      simpleTransition('launch', { sentence: (mission) => `Launched ${mission.ref}; it is active.`, next: (mission) => `mctl mission complete ${mission.ref}` }),
    ],
    ['complete', 'complete an active mission', simpleTransition('complete', { sentence: (mission) => `Completed ${mission.ref}.`, next: (mission) => `mctl mission history ${mission.ref}` })],
  ];
  for (const [name, description, command] of transitions) {
    missions.command(name).description(description).argument('<mission>', 'the mission, as MSN-8').option('--note <text>', 'a note for its history').action(perform(command));
  }
  missions
    .command('reject')
    .description('send a submitted mission back to draft, saying why; its crew are no longer held')
    .argument('<mission>', 'the mission, as MSN-8')
    .requiredOption('--note <text>', 'why')
    .action(
      perform(
        simpleTransition('reject', {
          sentence: (mission) => `Rejected ${mission.ref}; it is back in draft, and its crew are no longer held.`,
          next: (mission) => `mctl mission show ${mission.ref}`,
        }),
      ),
    );
  missions
    .command('cancel')
    .description('cancel a mission, saying why; its crew are released')
    .argument('<mission>', 'the mission, as MSN-8')
    .requiredOption('--note <text>', 'why')
    .option('--yes', 'do not ask first')
    .action(perform(cancel));
  missions.command('history').description('who did what to a mission, and when').argument('<mission>', 'the mission, as MSN-8').action(perform(history));
}
