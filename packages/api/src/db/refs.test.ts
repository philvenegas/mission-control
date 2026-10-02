import { expect, it } from 'vitest';
import { refNumber } from './refs.ts';

it('reads the number of a reference of the expected kind', () => {
  expect(refNumber('crew_member', 'CRW-4')).toBe(4);
  expect(refNumber('availability_block', 'avl-12')).toBe(12);
});

it('finds nothing behind text that is not a reference of that kind', () => {
  for (const text of ['MSN-4', 'CRW-0', 'nobody', '6f1c2a0e-0000-4000-8000-000000000000']) {
    expect(() => refNumber('crew_member', text)).toThrow(expect.objectContaining({ code: 'NOT_FOUND', message: `${text} was not found.` }));
  }
});
