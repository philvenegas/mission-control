import { type CrewMember, crewMemberSchema, type CrewSkill } from '@mission-control/contract';
import type { Command } from 'commander';
import { z } from 'zod';
import type { Context } from '../context.ts';
import { printAnswer, printNext } from '../output/print.ts';
import { columns, formatDay } from '../output/words.ts';
import { callAsSession } from '../session.ts';
import { apiPath, type Perform, startSession, wholeNumber } from './shared.ts';

// `mctl crew`: the organisation's crew and their skills.

/** A skill a crew member holds: "medic 3, until 10 Mar 2027". */
const describeSkill = ({ skill, level, certified_until: until }: CrewSkill) => `${skill} ${level}${until ? `, until ${formatDay(until)}` : ''}`;

const crewCells = ({ ref, name, status, skills }: CrewMember) => [ref, name, status, skills.length > 0 ? skills.map(describeSkill).join('; ') : 'no skills'];

/** `mctl crew list`: every crew member of the organisation, with their skills. */
async function crewList(context: Context): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: apiPath('crew') }, z.array(crewMemberSchema));
  printAnswer(context, raw, columns(data.map(crewCells)));
  return 0;
}

/** `mctl crew show`: one crew member, their login and their skills. */
async function crewShow(context: Context, ref: string): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: apiPath('crew', ref) }, crewMemberSchema);
  printAnswer(context, raw, [
    `${data.ref}  ${data.name}  ${data.status}`,
    `Login: ${data.user_email ?? 'none'}`,
    ...(data.skills.length === 0 ? ['No skills yet.'] : ['Skills:', ...data.skills.map((skill) => `  ${describeSkill(skill)}`)]),
  ]);
  return 0;
}

/** `mctl crew add`: a new crew member, by name. */
async function crewAdd(context: Context, options: { name: string }): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'POST', path: apiPath('crew'), body: { name: options.name } }, crewMemberSchema);
  printAnswer(context, raw, [`Added ${data.name} as ${data.ref}.`]);
  printNext(context, `mctl crew skill set ${data.ref} --skill <skill> --level <level>`);
  return 0;
}

/** `mctl crew skill set`: the level a crew member holds a skill at, and when it expires, set whole. */
async function crewSkillSet(context: Context, ref: string, options: { skill: string; level: number; certifiedUntil?: string }): Promise<number> {
  const session = startSession(context);
  const body = { level: options.level, certified_until: options.certifiedUntil ?? null };
  const { data, raw } = await callAsSession(session, { method: 'PUT', path: apiPath('crew', ref, 'skills', options.skill), body }, crewMemberSchema);
  printAnswer(
    context,
    raw,
    data.skills.filter(({ skill }) => skill === options.skill).map((skill) => `${data.name} ${data.ref} holds ${describeSkill(skill)}.`),
  );
  printNext(context, `mctl crew show ${data.ref}`);
  return 0;
}

export function registerCrewCommands(program: Command, perform: Perform) {
  const crew = program.command('crew').description('the organisation\'s crew and their skills');
  crew.command('list').description('every crew member, with their skills').action(perform(crewList));
  crew.command('show').description('one crew member').argument('<crew member>', 'the crew member, as CRW-1, or me').action(perform(crewShow));
  crew.command('add').description('add a crew member').requiredOption('--name <name>', 'their name').action(perform(crewAdd));
  crew
    .command('skill')
    .description('a crew member\'s skills')
    .command('set')
    .description('set the level a crew member holds a skill at')
    .argument('<crew member>', 'the crew member, as CRW-1, or me')
    .requiredOption('--skill <skill>', 'the skill')
    .requiredOption('--level <level>', '1 (novice) to 5 (expert)', wholeNumber)
    .option('--certified-until <day>', 'the day the skill stops counting, as 2027-03-10; it does not expire unless given')
    .action(perform(crewSkillSet));
}
