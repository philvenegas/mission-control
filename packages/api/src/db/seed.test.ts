import { expect, it } from 'vitest';
import { seedDate } from './seed.ts';

it('moves every seeded date by as far as the base date has moved', () => {
  expect(seedDate('2027-03-01', '2026-10-01')).toBe('2027-03-01');
  expect(seedDate('2027-03-01', '2026-10-11')).toBe('2027-03-11');
  expect(seedDate('2027-02-10', '2027-10-01')).toBe('2028-02-10');
});
