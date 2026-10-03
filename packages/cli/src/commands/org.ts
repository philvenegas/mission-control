import { orgResponseSchema } from '@mission-control/contract';
import type { Command } from 'commander';
import type { Context } from '../context.ts';
import { printAnswer } from '../output/print.ts';
import { callAsSession } from '../session.ts';
import { apiPath, type Perform, startSession } from './shared.ts';

// `mctl org`: the organisation and its settings, which are seeded and read-only.

/** `mctl org show`: the organisation and its settings, for a director. */
async function orgShow(context: Context): Promise<number> {
  const session = startSession(context);
  const { data, raw } = await callAsSession(session, { method: 'GET', path: apiPath('org') }, orgResponseSchema);
  const { approvals_required: approvals, allow_unfilled_submission: allowUnfilled, match_weights: weights } = data.settings;
  printAnswer(context, raw, [
    `${data.name} (${data.slug})`,
    `Approvals required: ${approvals}`,
    `Submitting with unfilled slots: ${allowUnfilled ? 'allowed' : 'not allowed'}`,
    `Match weights: ${Object.entries(weights)
      .map(([component, weight]) => `${component} ${weight}`)
      .join(', ')}`,
  ]);
  return 0;
}

export function registerOrgCommands(program: Command, perform: Perform) {
  program.command('org').description('your organisation').command('show').description('the organisation and its settings').action(perform(orgShow));
}
