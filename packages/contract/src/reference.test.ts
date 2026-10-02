import { describe, expect, it } from 'vitest';
import { formatRef, parseRef } from './reference.ts';

describe('a reference', () => {
  it('is written as its kind and number', () => {
    expect(formatRef('mission', 12)).toBe('MSN-12');
    expect(formatRef('crew_member', 7)).toBe('CRW-7');
    expect(formatRef('availability_block', 3)).toBe('AVL-3');
  });

  it('is read back to its number, ignoring case and surrounding space', () => {
    expect(parseRef('crew_member', 'CRW-7')).toBe(7);
    expect(parseRef('crew_member', ' crw-7 ')).toBe(7);
    expect(parseRef('availability_block', 'AVL-123456789')).toBe(123_456_789);
  });

  it.each([
    ['another kind', 'MSN-7'],
    ['a zero', 'CRW-0'],
    ['a leading zero', 'CRW-07'],
    ['no number', 'CRW-'],
    ['a number too large to be a reference', 'CRW-1234567890'],
    ['an internal id', '6f1c2a0e-0000-4000-8000-000000000000'],
    ['text carrying SQL', "CRW-1' OR '1'='1"],
  ])('is not read from %s', (_, text) => {
    expect(parseRef('crew_member', text)).toBeNull();
  });
});
