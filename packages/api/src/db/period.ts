/** A range of dates, as ISO days: `from` inclusive, `to` exclusive. */
export interface Period {
  from: string;
  to: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The period as Postgres writes a daterange: `[2027-03-01,2027-03-20)`. */
export function toDaterange({ from, to }: Period): string {
  for (const day of [from, to]) {
    if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(day))) throw new Error(`"${day}" is not a date`);
  }
  if (from >= to) throw new Error(`A period must end after it starts: ${from} to ${to}`);
  return `[${from},${to})`;
}
