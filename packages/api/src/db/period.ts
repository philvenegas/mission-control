import { type Period, periodSchema } from '@mission-control/contract';

/** The period as Postgres writes a daterange: `[2027-03-01,2027-03-20)`. Refuses anything that is not a period. */
export function toDaterange(period: Period): string {
  const parsed = periodSchema.safeParse(period);
  if (!parsed.success) throw new Error(`Not a period that ends after it starts: ${JSON.stringify(period)}`);
  return `[${parsed.data.from},${parsed.data.to})`;
}

/** The period a daterange holds, as Postgres writes it back. */
export function fromDaterange(text: string): Period {
  const [, from, to] = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/.exec(text) ?? [];
  if (!from || !to) throw new Error(`"${text}" is not a daterange with a start and an end`);
  return { from, to };
}
