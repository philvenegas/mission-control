// The Hungarian algorithm in its shortest-augmenting-path form (DESIGN.md section 6.5; the research
// note on branch research/assignment-solver). Exact, and cubic in the size of the matrix. Rows and
// columns are numbered from 1 inside, with column 0 standing for "no column yet".

import { valueAt } from './arrays.ts';

function checkCosts(cost: readonly (readonly number[])[], columns: number) {
  if (cost.length > columns) {
    throw new Error(`The solver needs at least as many columns as rows, not a ${cost.length} × ${columns} matrix.`);
  }
  cost.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) => {
      if (!Number.isFinite(value)) {
        throw new Error(`The solver takes only finite costs; row ${rowIndex + 1}, column ${columnIndex + 1} is ${value}.`);
      }
    }),
  );
}

/**
 * The column for each row that gives every row its own column at the least total cost. Needs at
 * least as many columns as rows, and finite costs. Comparisons are strict, so of several equally
 * cheap answers the same one is always found for the same matrix.
 */
export function solveAssignment(cost: readonly (readonly number[])[]): number[] {
  const rows = cost.length;
  const columns = cost[0]?.length ?? 0;
  checkCosts(cost, columns);
  const costs = cost.flat();
  const costAt = (row: number, column: number) => valueAt(costs, (row - 1) * columns + column - 1);

  const rowPotential = new Array<number>(rows + 1).fill(0);
  const columnPotential = new Array<number>(columns + 1).fill(0);
  /** The row each column is given to, or 0. */
  const rowOfColumn = new Array<number>(columns + 1).fill(0);
  /** The previous column on the shortest path to each column. */
  const previous = new Array<number>(columns + 1).fill(0);

  for (let row = 1; row <= rows; row++) {
    rowOfColumn[0] = row;
    let column = 0;
    const shortest = new Array<number>(columns + 1).fill(Number.POSITIVE_INFINITY);
    const reached = new Array<boolean>(columns + 1).fill(false);
    do {
      reached[column] = true;
      const fromRow = valueAt(rowOfColumn, column);
      let step = Number.POSITIVE_INFINITY;
      let nextColumn = 0;
      for (let candidate = 1; candidate <= columns; candidate++) {
        if (reached[candidate]) continue;
        const reduced = costAt(fromRow, candidate) - valueAt(rowPotential, fromRow) - valueAt(columnPotential, candidate);
        if (reduced < valueAt(shortest, candidate)) {
          shortest[candidate] = reduced;
          previous[candidate] = column;
        }
        if (valueAt(shortest, candidate) < step) {
          step = valueAt(shortest, candidate);
          nextColumn = candidate;
        }
      }
      for (let each = 0; each <= columns; each++) {
        if (reached[each]) {
          const owner = valueAt(rowOfColumn, each);
          rowPotential[owner] = valueAt(rowPotential, owner) + step;
          columnPotential[each] = valueAt(columnPotential, each) - step;
        } else {
          shortest[each] = valueAt(shortest, each) - step;
        }
      }
      column = nextColumn;
    } while (valueAt(rowOfColumn, column) !== 0);
    // Walk the path back, handing each column on it to the row before.
    do {
      const before = valueAt(previous, column);
      rowOfColumn[column] = valueAt(rowOfColumn, before);
      column = before;
    } while (column !== 0);
  }

  const answer = new Array<number>(rows).fill(-1);
  for (let column = 1; column <= columns; column++) {
    const row = valueAt(rowOfColumn, column);
    if (row !== 0) answer[row - 1] = column - 1;
  }
  return answer;
}
