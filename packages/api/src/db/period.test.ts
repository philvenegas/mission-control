import { expect, it } from 'vitest';
import { toDaterange } from './period.ts';

it('writes a period with its start inclusive and its end exclusive', () => {
  expect(toDaterange({ from: '2027-03-01', to: '2027-03-20' })).toBe('[2027-03-01,2027-03-20)');
});

it('refuses a period that is empty or runs backwards', () => {
  expect(() => toDaterange({ from: '2027-03-20', to: '2027-03-20' })).toThrow(/must end after it starts/);
  expect(() => toDaterange({ from: '2027-03-20', to: '2027-03-01' })).toThrow(/must end after it starts/);
});

it('refuses anything that is not a date', () => {
  expect(() => toDaterange({ from: '2027-13-01', to: '2027-03-20' })).toThrow(/not a date/);
  expect(() => toDaterange({ from: "2027-03-01'); DROP TABLE missions; --", to: '2027-03-20' })).toThrow(/not a date/);
});
