import { crewAssignmentSchema, missionSchema, parseRef } from '@mission-control/contract';
import type { Command } from 'commander';
import { z } from 'zod';
import type { Context } from '../context.ts';
import { printAnswer, printNext } from '../output/print.ts';
import { columns, describeProblem, formatPeriod, yearOf } from '../output/words.ts';
import { callAsSession } from '../session.ts';
import { apiPath, askFirst, type Perform, printNextFor, startSession, styleOf, type YesOption } from './shared.ts';

// `mctl assignment`: crew in a mission's slots. A mission lead assigns and releases them; a crew
// member sees their offers and responds.

/** `mctl assignment list`: a crew member's offered and accepted assignments. */
async function list(context: Context): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: apiPath('assignments') }, z.array(crewAssignmentSchema));
  printAnswer(
    context,
    raw,
    data.length === 0
      ? ['You have no offered or accepted assignments.']
      : columns(data.map(({ ref, mission, skill, status }) => [ref, `${mission.ref} ${mission.name}`, formatPeriod(mission.from, mission.to), skill, status])),
  );
  const offered = data.find(({ status }) => status === 'offered');
  if (offered) printNext(context, `mctl assignment accept ${offered.ref}`);
  return 0;
}

/** `mctl assignment add`: places a named crew member in an open slot, by hand; the response says if it makes a clash. */
async function add(context: Context, missionRef: string, options: { crew: string; skill: string }): Promise<number> {
  const session = startSession(context);
  const body = { crew_member: options.crew, skill: options.skill };
  const { data, raw } = await callAsSession(session, { method: 'POST', path: apiPath('missions', missionRef, 'assignments'), body }, missionSchema);
  const style = styleOf(context);
  const added = data.requirements
    .filter(({ skill }) => skill === options.skill)
    .flatMap(({ skill, crew }) =>
      crew
        .filter(({ crew_member: crewMember, status }) => parseRef('crew_member', crewMember.ref) === parseRef('crew_member', options.crew) && status !== 'declined')
        .flatMap(({ assignment, crew_member: crewMember, status, problems }) => [
          `Assigned ${crewMember.name} ${crewMember.ref} to ${data.ref} as ${skill}: ${assignment}, ${status}.`,
          ...problems.map((problem) => style('red', `  ✗ ${describeProblem(problem, skill, yearOf(data.from))}`)),
        ]),
    );
  printAnswer(context, raw, added);
  printNextFor(context, data);
  return 0;
}

/** `mctl assignment remove`: releases a crew member from their slot. Asks first. */
async function remove(context: Context, ref: string, options: YesOption): Promise<number> {
  const session = startSession(context);
  await askFirst(context, options.yes, 'mctl assignment remove', `Release ${ref}? Its crew member leaves the slot.`);
  const { data, raw } = await callAsSession(session, { method: 'DELETE', path: apiPath('assignments', ref) }, missionSchema);
  printAnswer(context, raw, [`Released ${ref} from ${data.ref}.`]);
  printNextFor(context, data);
  return 0;
}

/** `mctl assignment clear`: releases every proposed crew member of a draft, to start over. Asks first. */
async function clear(context: Context, missionRef: string, options: YesOption): Promise<number> {
  const session = startSession(context);
  await askFirst(context, options.yes, 'mctl assignment clear', `Release every crew member proposed on ${missionRef}?`);
  const { data, raw } = await callAsSession(session, { method: 'DELETE', path: apiPath('missions', missionRef, 'assignments') }, missionSchema);
  printAnswer(context, raw, [`Released the proposed crew of ${data.ref}.`]);
  printNextFor(context, data);
  return 0;
}

/** `mctl assignment accept`: a crew member takes their offered place. */
async function accept(context: Context, ref: string): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'POST', path: apiPath('assignments', ref, 'accept') }, crewAssignmentSchema);
  const { mission } = data;
  printAnswer(context, raw, [`Accepted ${data.ref}: ${data.skill} on ${mission.ref} ${mission.name}, ${formatPeriod(mission.from, mission.to)}.`]);
  printNext(context, `mctl mission show ${mission.ref}`);
  return 0;
}

/** `mctl assignment decline`: a crew member turns down their offered place, saying why if they wish. */
async function decline(context: Context, ref: string, options: { reason?: string }): Promise<number> {
  const session = startSession(context);
  const body = options.reason === undefined ? {} : { reason: options.reason };
  const { data, raw } = await callAsSession(session, { method: 'POST', path: apiPath('assignments', ref, 'decline'), body }, crewAssignmentSchema);
  printAnswer(context, raw, [`Declined ${data.ref}: ${data.skill} on ${data.mission.ref} ${data.mission.name}.`]);
  printNext(context, 'mctl assignment list');
  return 0;
}

export function registerAssignmentCommands(program: Command, perform: Perform) {
  const assignments = program.command('assignment').description('crew in a mission\'s slots: assign, release, accept and decline');
  assignments.command('list').description('your offered and accepted assignments, as a crew member').action(perform(list));
  assignments
    .command('add')
    .description('assign a crew member to an open slot by hand')
    .argument('<mission>', 'the mission, as MSN-8')
    .requiredOption('--crew <crew member>', 'the crew member, as CRW-2')
    .requiredOption('--skill <skill>', 'the requirement whose slot they fill')
    .action(perform(add));
  assignments
    .command('remove')
    .description('release a crew member from their slot')
    .argument('<assignment>', 'the assignment, as ASG-40')
    .option('--yes', 'do not ask first')
    .action(perform(remove));
  assignments
    .command('clear')
    .description('release every crew member proposed on a draft')
    .argument('<mission>', 'the mission, as MSN-4')
    .option('--yes', 'do not ask first')
    .action(perform(clear));
  assignments.command('accept').description('accept a place you are offered').argument('<assignment>', 'the assignment, as ASG-31').action(perform(accept));
  assignments
    .command('decline')
    .description('decline a place you are offered')
    .argument('<assignment>', 'the assignment, as ASG-32')
    .option('--reason <text>', 'why, for the mission lead')
    .action(perform(decline));
}
