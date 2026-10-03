import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CONTEXT.md lists, under each term, the words to avoid for it. Those apply to identifiers, test
// names, SQL aliases and comments as much as to prose (CODING_STANDARDS.md, "Names"). This test
// reads the lists and finds any of those words in the source.

const root = fileURLToPath(new URL('../../..', import.meta.url));
const glossary = readFileSync(join(root, 'CONTEXT.md'), 'utf8');

/** A source text as lower-case words: identifiers split at camelCase, snake_case and punctuation. */
const wordsOf = (text: string) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Every glossary term, as words: `mission lead`, `crew member`. */
const TERMS = [...glossary.matchAll(/^\*\*(.+?)\*\*:$/gm)].map(([, term = '']) => wordsOf(term));

/**
 * Avoided words that are also another glossary term, a word the design itself uses for something
 * else, or the plain name of a programming idea. Each is listed with why, so the list stays honest.
 */
const AMBIGUOUS: Record<string, string> = {
  tenant: 'avoided in user-facing text only; the code says tenant for the organisation a request is confined to',
  accept: 'avoided for applying a match run only; a crew member accepts an assignment',
  role: 'a glossary term itself (a user\'s role)',
  requirement: 'a glossary term itself',
  block: 'part of the term availability block',
  match: 'part of the terms match run and matcher',
  lock: 'a database row lock, which the lifecycle takes',
  filter: 'Array.prototype.filter',
  key: 'a database or object key',
  code: 'an error code',
  id: 'an internal database id, which the API never shows',
  slug: 'the organisation\'s slug, which the design addresses it by',
  error: 'a thrown error',
  rule: 'the booking rule, which the design names',
  state: 'approvalState, which the design names',
  open: 'an open slot, as the design says',
  leave: 'a reason a seeded crew member is away',
  flight: 'a seeded skill category',
  operation: 'a seeded skill category, operations',
  window: 'not used, but too common a word to police',
  review: 'code review, in comments',
  validation: 'input validation',
  confirm: 'not used, but too common a word to police',
  need: 'the verb; avoided only as a noun for a requirement',
  conflict: 'SQL\'s ON CONFLICT and HTTP\'s 409 Conflict',
  issue: 'a Zod validation issue',
  admin: 'the Postgres administrator connection, DATABASE_ADMIN_URL',
  removed: 'a user or record deleted; avoided only for a released assignment',
  fit: 'not used, but too common a word to police',
  force: 'not used, but too common a word to police',
  option: 'a command-line option, as Commander names it',
  action: 'a Commander action handler',
};

/** Where the design itself fixes a name that contains an avoided word (CODING_STANDARDS.md, "Names"). */
const FIXED_BY_DESIGN = ['no double booking', 'double booking', 'booking rule'];

/** Files where avoided words are meant, each with why. */
const MEANT_IN: Record<string, { words: string[]; why: string }> = {
  'packages/api/src/modules/missions/approval.ts': { words: ['pending'], why: 'approvalState → pending | approved, as DESIGN.md section 4 names it' },
  'packages/api/src/modules/missions/approval.test.ts': { words: ['pending'], why: 'the same' },
  'packages/api/src/db/schema.int.test.ts': { words: ['pending'], why: 'a status the database must refuse' },
  'packages/cli/src/profiles.test.ts': { words: ['lead'], why: 'the demo profile `lead`, which DESIGN.md section 8 names' },
  'packages/cli/src/cli.int.test.ts': { words: ['lead'], why: 'the same' },
  'packages/cli/src/bin.int.test.ts': { words: ['lead'], why: 'the same' },
};

/** Each avoided word or phrase, as words, with the term it is avoided for. */
const AVOIDED = [...glossary.matchAll(/^\*\*(.+?)\*\*:\n.*\n_Avoid_: (.+)$/gm)].flatMap(([, term = '', list = '']) =>
  list
    // "lead (alone, in formal text)": the qualifier is honoured by not counting a glossary term's own words.
    .replace(/\s*\([^)]*\)/g, '')
    .split(',')
    .map((entry) => ({ words: wordsOf(entry), term }))
    .filter(({ words }) => words.length > 0 && !Object.hasOwn(AMBIGUOUS, words.join(' '))),
);

const sequenceAt = (words: string[], index: number, sequence: string[]) => sequence.every((word, offset) => words[index + offset] === word);

/** The avoided words in a text, ignoring those inside a glossary term or a name the design fixes. */
function avoidedIn(text: string): { word: string; term: string }[] {
  const words = wordsOf(text);
  const covered = new Set<number>();
  for (const sequence of [...TERMS, ...FIXED_BY_DESIGN.map(wordsOf)]) {
    words.forEach((_, index) => {
      if (sequenceAt(words, index, sequence)) sequence.forEach((__, offset) => covered.add(index + offset));
    });
  }
  return AVOIDED.flatMap(({ words: avoided, term }) =>
    words.flatMap((_, index) =>
      sequenceAt(words, index, avoided) && avoided.every((__, offset) => !covered.has(index + offset))
        ? [{ word: avoided.join(' '), term }]
        : [],
    ),
  );
}

const sourceFiles = readdirSync(join(root, 'packages'), { withFileTypes: true, recursive: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && entry.parentPath.includes('/src') && !entry.parentPath.includes('node_modules'))
  .map((entry) => join(entry.parentPath, entry.name))
  // This file names avoided words on purpose, to test that they are found.
  .filter((file) => file !== fileURLToPath(import.meta.url));

describe('the glossary in the code', () => {
  it('reads the terms and the words to avoid from CONTEXT.md', () => {
    expect(TERMS).toEqual(expect.arrayContaining([['mission', 'lead'], ['crew', 'member']]));
    expect(AVOIDED).toEqual(expect.arrayContaining([{ words: ['lead'], term: 'Mission lead' }, { words: ['creator'], term: 'Owner' }]));
  });

  it('finds an avoided word, but not one inside a glossary term or a name the design fixes', () => {
    expect(avoidedIn('const leads = await lead(missionCreator);')).toEqual([
      { word: 'lead', term: 'Mission lead' },
      { word: 'creator', term: 'Owner' },
    ]);
    expect(avoidedIn('missionLead crew_member no_double_booking')).toEqual([]);
  });

  it('uses no avoided word in any source file, test or comment', () => {
    const found = sourceFiles.flatMap((file) =>
      avoidedIn(readFileSync(file, 'utf8'))
        .filter(({ word }) => !(MEANT_IN[relative(root, file)]?.words ?? []).includes(word))
        .map(({ word, term }) => `${relative(root, file)}: ${word} (say ${term})`),
    );
    expect([...new Set(found)]).toEqual([]);
  });
});
