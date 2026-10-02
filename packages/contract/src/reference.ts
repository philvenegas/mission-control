/** The kinds of record that have a reference, numbered per organisation and per kind. */
export const REF_PREFIXES = {
  mission: 'MSN',
  crew_member: 'CRW',
  assignment: 'ASG',
  match_run: 'RUN',
  availability_block: 'AVL',
} as const;

export type RefKind = keyof typeof REF_PREFIXES;

export function formatRef(kind: RefKind, number: number): string {
  return `${REF_PREFIXES[kind]}-${number}`;
}

/** Returns the reference's number, or null when the text is not a reference of that kind. */
export function parseRef(kind: RefKind, text: string): number | null {
  const match = new RegExp(`^${REF_PREFIXES[kind]}-([1-9][0-9]*)$`, 'i').exec(text.trim());
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}
