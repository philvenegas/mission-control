import { z } from 'zod';

/** A calendar day, written `2027-03-01`. */
export const isoDaySchema = z.iso.date();

/** A check for any object with a `from` and a `to`: the period must end after it starts. */
export const endsAfterStart = ({ from, to }: { from: string; to: string }) => from < to;
export const PERIOD_ORDER = { message: 'A period must end after it starts.', path: ['to'] };

/** A range of dates: `from` inclusive, `to` exclusive, so `to` is the day after the last day. */
export const periodSchema = z.object({ from: isoDaySchema, to: isoDaySchema }).refine(endsAfterStart, PERIOD_ORDER);
export type Period = z.infer<typeof periodSchema>;
