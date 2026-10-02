import { describe, expect, it } from 'vitest';
import { fromDaterange, toDaterange } from './period.ts';

describe('a period in the database', () => {
  it('is written with its start inclusive and its end exclusive, and read back the same', () => {
    expect(toDaterange({ from: '2027-03-01', to: '2027-03-20' })).toBe('[2027-03-01,2027-03-20)');
    expect(fromDaterange('[2027-03-01,2027-03-20)')).toEqual({ from: '2027-03-01', to: '2027-03-20' });
  });

  it('refuses to write a period that is empty, runs backwards or is not made of dates', () => {
    expect(() => toDaterange({ from: '2027-03-20', to: '2027-03-20' })).toThrow(/Not a period/);
    expect(() => toDaterange({ from: '2027-03-20', to: '2027-03-01' })).toThrow(/Not a period/);
    expect(() => toDaterange({ from: '2027-13-01', to: '2027-03-20' })).toThrow(/Not a period/);
    expect(() => toDaterange({ from: "2027-03-01'); DROP TABLE missions; --", to: '2027-03-20' })).toThrow(/Not a period/);
  });

  it.each(['empty', '[2027-03-01,)', '(,2027-03-20)', '[2027-03-01,2027-03-20]'])('refuses to read "%s"', (text) => {
    expect(() => fromDaterange(text)).toThrow(/is not a daterange/);
  });
});
