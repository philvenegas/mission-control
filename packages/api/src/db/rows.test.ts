import { expect, it } from 'vitest';
import { exactlyOne } from './rows.ts';

it('gives the row when there is exactly one', () => {
  expect(exactlyOne([{ slug: 'artemis' }], 'organisation')).toEqual({ slug: 'artemis' });
});

it('refuses none, and refuses more than one', () => {
  expect(() => exactlyOne([], 'organisation')).toThrow('Expected exactly one organisation, found 0');
  expect(() => exactlyOne([1, 2], 'organisation')).toThrow('Expected exactly one organisation, found 2');
});
