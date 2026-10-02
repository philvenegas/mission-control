import { describe, expect, it } from 'vitest';
import { formatRef, parseRef } from './reference.ts';

describe('references', () => {
  it('formats a reference from its kind and number', () => {
    expect(formatRef('mission', 12)).toBe('MSN-12');
    expect(formatRef('availability_block', 3)).toBe('AVL-3');
  });

  it('parses a reference of the expected kind, ignoring case', () => {
    expect(parseRef('crew_member', 'CRW-7')).toBe(7);
    expect(parseRef('crew_member', 'crw-7')).toBe(7);
  });

  it('rejects another kind, a zero, and anything that is not a reference', () => {
    expect(parseRef('crew_member', 'MSN-7')).toBeNull();
    expect(parseRef('mission', 'MSN-0')).toBeNull();
    expect(parseRef('mission', 'MSN-1; DROP TABLE missions')).toBeNull();
    expect(parseRef('mission', '6f1c2a0e-0000-4000-8000-000000000000')).toBeNull();
  });
});
