import { expect, it } from 'vitest';
import { valueAt } from './arrays.ts';

it('gives the entry at an index, and refuses one past the end', () => {
  expect(valueAt([3, 5], 1)).toBe(5);
  expect(() => valueAt([3, 5], 2)).toThrow('Index 2 is past the end of an array of 2');
});
