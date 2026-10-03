import type { Period } from '@mission-control/contract';

// Periods are `from` inclusive and `to` exclusive, as calendar days written `2027-03-01`.

const DAY_MS = 86_400_000;

const toDays = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** The day `days` after `day`, or before it when negative. */
export const addDays = (day: string, days: number) => new Date((toDays(day) + days) * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `from` to `to`. */
export const daysBetween = (from: string, to: string) => toDays(to) - toDays(from);

/** The last day a period covers. */
export const lastDay = (period: Period) => addDays(period.to, -1);

/** How many days two periods share. */
export const sharedDays = (first: Period, second: Period) =>
  Math.max(0, daysBetween(first.from > second.from ? first.from : second.from, first.to < second.to ? first.to : second.to));
