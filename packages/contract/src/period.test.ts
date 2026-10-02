import { expect, it } from 'vitest';
import { periodSchema } from './period.ts';

it('accepts a period that ends after it starts', () => {
  expect(periodSchema.parse({ from: '2027-03-01', to: '2027-03-20' })).toEqual({ from: '2027-03-01', to: '2027-03-20' });
});

it.each([
  ['an empty period', { from: '2027-03-20', to: '2027-03-20' }],
  ['a period that runs backwards', { from: '2027-03-20', to: '2027-03-01' }],
  ['a day that does not exist', { from: '2027-02-30', to: '2027-03-20' }],
  ['a time instead of a day', { from: '2027-03-01T00:00:00Z', to: '2027-03-20' }],
  ['a missing end', { from: '2027-03-01' }],
])('refuses %s', (_, period) => {
  expect(periodSchema.safeParse(period).success).toBe(false);
});
