import { skillSchema } from '@mission-control/contract';
import type { Command } from 'commander';
import { z } from 'zod';
import type { Context } from '../context.ts';
import { printAnswer } from '../output/print.ts';
import { callAsSession } from '../session.ts';
import { apiPath, type Perform, startSession } from './shared.ts';

// `mctl skill`: the organisation's own taxonomy, which is seeded and read-only.

/** `mctl skill list`: the organisation's skills, by category. */
async function skillList(context: Context): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: apiPath('skills') }, z.array(skillSchema));
  const categories = [...new Set(data.map(({ category }) => category))];
  printAnswer(
    context,
    raw,
    categories.map((category) => `${category}: ${data.filter((skill) => skill.category === category).map(({ name }) => name).join(', ')}`),
  );
  return 0;
}

export function registerSkillCommands(program: Command, perform: Perform) {
  program.command('skill').description('the organisation\'s skills').command('list').description('every skill, by category').action(perform(skillList));
}
