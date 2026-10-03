import { describe, expect, it } from 'vitest';
import { solveAssignment } from './solver.ts';

/** A seeded generator (mulberry32), so a failing case can be run again. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const totalCost = (cost: number[][], columns: number[]) => columns.reduce((sum, column, row) => sum + (cost[row]?.[column] ?? Number.NaN), 0);

/** The cheapest total over every way to give each row its own column, found by trying them all. */
function bruteForceMinimum(cost: number[][], columnCount: number): number {
  const rows = cost.length;
  let best = Number.POSITIVE_INFINITY;
  const used = new Array<boolean>(columnCount).fill(false);
  const visit = (row: number, sum: number) => {
    if (row === rows) {
      best = Math.min(best, sum);
      return;
    }
    for (let column = 0; column < columnCount; column++) {
      if (used[column]) continue;
      used[column] = true;
      visit(row + 1, sum + (cost[row]?.[column] ?? Number.NaN));
      used[column] = false;
    }
  };
  visit(0, 0);
  return best;
}

describe('the assignment solver', () => {
  it('gives each row its own column at the least total cost', () => {
    expect(solveAssignment([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
  });

  it('solves a matrix with more columns than rows, and one with no rows', () => {
    expect(solveAssignment([[9, 1, 9, 9]])).toEqual([1]);
    expect(solveAssignment([])).toEqual([]);
  });

  it('agrees with trying every assignment, on 2000 small random matrices with many ties', () => {
    const next = random(20261003);
    for (let trial = 0; trial < 2000; trial++) {
      const rows = 1 + Math.floor(next() * 5);
      const columns = rows + Math.floor(next() * 4);
      // Costs in a few coarse steps, so equal answers are common.
      const cost = Array.from({ length: rows }, () => Array.from({ length: columns }, () => Math.floor(next() * 5) * 1000));
      const answer = solveAssignment(cost);
      expect(new Set(answer).size, `trial ${trial}: a column used twice`).toBe(rows);
      expect(totalCost(cost, answer), `trial ${trial}: ${JSON.stringify(cost)}`).toBe(bruteForceMinimum(cost, columns));
    }
  });

  it('gives the same answer every time for the same matrix', () => {
    const cost = [[1, 1, 1], [1, 1, 1]];
    expect(solveAssignment(cost)).toEqual(solveAssignment(cost));
    expect(solveAssignment(cost)).toEqual([0, 1]);
  });

  it('refuses more rows than columns, and a cost that is not a finite number', () => {
    expect(() => solveAssignment([[1], [2]])).toThrow('The solver needs at least as many columns as rows, not a 2 × 1 matrix.');
    expect(() => solveAssignment([[1, Number.POSITIVE_INFINITY]])).toThrow('The solver takes only finite costs; row 1, column 2 is Infinity.');
    expect(() => solveAssignment([[1, Number.NaN]])).toThrow('row 1, column 2 is NaN');
  });
});
