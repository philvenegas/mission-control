import { describe, expect, it } from 'vitest';
import { EXCLUSION_VIOLATION, isBookingRuleViolation } from './errors.ts';

/** An error as a database driver raises one: an `Error` with a Postgres code. */
const databaseError = (code: string) => Object.assign(new Error('refused'), { code });

describe('telling the booking rule\'s refusal from any other error', () => {
  it('finds it on the error itself, or anywhere down the chain of causes', () => {
    expect(isBookingRuleViolation(databaseError(EXCLUSION_VIOLATION))).toBe(true);
    const wrapped = new Error('Failed query', { cause: new Error('in a transaction', { cause: databaseError(EXCLUSION_VIOLATION) }) });
    expect(isBookingRuleViolation(wrapped)).toBe(true);
  });

  it('finds nothing in another database error, an error with no code, or something that is not an error', () => {
    expect(isBookingRuleViolation(new Error('Failed query', { cause: databaseError('23505') }))).toBe(false);
    expect(isBookingRuleViolation(new Error('no code'))).toBe(false);
    expect(isBookingRuleViolation({ code: EXCLUSION_VIOLATION })).toBe(false);
    expect(isBookingRuleViolation(undefined)).toBe(false);
  });
});
