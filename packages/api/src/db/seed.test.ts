import { expect, it } from 'vitest';
import { seedDate } from './seed.ts';
import { SEED_BASE_DATE } from './seed-data.ts';

it('counts every seeded date in days from the base date', () => {
  expect(seedDate(0)).toBe(SEED_BASE_DATE);
  expect(seedDate(151, '2026-10-01')).toBe('2027-03-01');
  expect(seedDate(-6, '2026-10-01')).toBe('2026-09-25');
});

it('moves every seeded date when the base date moves', () => {
  expect(seedDate(151, '2026-10-11')).toBe('2027-03-11');
  expect(seedDate(132, '2027-10-01')).toBe('2028-02-10');
});
