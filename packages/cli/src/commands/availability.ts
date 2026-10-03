import { availabilityBlockSchema } from '@mission-control/contract';
import type { Command } from 'commander';
import { z } from 'zod';
import type { Context } from '../context.ts';
import { printAnswer, printNext } from '../output/print.ts';
import { columns, formatPeriod } from '../output/words.ts';
import { callAsSession } from '../session.ts';
import { apiPath, askFirst, type Perform, startSession, type YesOption } from './shared.ts';

// `mctl availability`: periods when a crew member is unavailable. Crew are available outside them.

/** `mctl availability add`: a period when a crew member is unavailable. */
async function availabilityAdd(context: Context, crewRef: string, options: { from: string; to: string; reason?: string }): Promise<number> {
  const session = startSession(context);
  const { from, to, reason } = options;
  const { data, raw } = await callAsSession(session, { method: 'POST', path: apiPath('crew', crewRef, 'availability'), body: { from, to, reason } }, availabilityBlockSchema);
  printAnswer(context, raw, [`Added ${data.ref}: ${data.crew_member} is unavailable ${formatPeriod(data.from, data.to)}.`]);
  printNext(context, `mctl availability list ${crewRef}`);
  return 0;
}

/** `mctl availability list`: a crew member's availability blocks. */
async function availabilityList(context: Context, crewRef: string): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: apiPath('crew', crewRef, 'availability') }, z.array(availabilityBlockSchema));
  printAnswer(
    context,
    raw,
    data.length === 0
      ? [`${crewRef} has no availability blocks, so is available throughout.`]
      : columns(data.map(({ ref, from, to, reason }) => [ref, formatPeriod(from, to), reason ?? ''])),
  );
  return 0;
}

/** `mctl availability remove`: deletes a block, so the crew member is available again. Asks first. */
async function availabilityRemove(context: Context, ref: string, options: YesOption): Promise<number> {
  const session = startSession(context);
  await askFirst(context, options.yes, 'mctl availability remove', `Remove availability block ${ref}?`);
  await callAsSession(session, { method: 'DELETE', path: apiPath('availability', ref) }, z.null());
  // The API answers with no body, so --json reports what was removed.
  printAnswer(context, { removed: ref }, [`Removed ${ref}.`]);
  return 0;
}

export function registerAvailabilityCommands(program: Command, perform: Perform) {
  const availability = program.command('availability').description('periods when a crew member is unavailable');
  availability
    .command('add')
    .description('add a period when a crew member is unavailable')
    .argument('<crew member>', 'the crew member, as CRW-1, or me')
    .requiredOption('--from <day>', 'the first day, as 2027-03-05')
    .requiredOption('--to <day>', 'the day they are back, as 2027-03-12')
    .option('--reason <text>', 'why')
    .action(perform(availabilityAdd));
  availability.command('list').description('a crew member\'s availability blocks').argument('<crew member>', 'the crew member, as CRW-1, or me').action(perform(availabilityList));
  availability
    .command('remove')
    .description('remove an availability block')
    .argument('<block>', 'the availability block, as AVL-3')
    .option('--yes', 'do not ask first')
    .action(perform(availabilityRemove));

}
