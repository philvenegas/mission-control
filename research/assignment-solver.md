# Assignment solver: library or hand-written Hungarian

Research for issue #8. Checked on 2026-10-02. Feeds `DESIGN.md` section 6.5.

## Answer

Write it by hand. A Hungarian solver in the potentials / shortest-augmenting-path form is 50 lines of TypeScript with no dependencies, and the version in the appendix matched a brute-force optimum on 4000 random cases.

One library is a credible alternative: `munkres` (havelessbemore) 2.1.1. It is typed, dependency-free, MIT, handles rectangular matrices and passed the same 4000 cases. Keep it as the fallback. The encoding below works unchanged with either, so swapping is a one-function change.

Reasons for hand-written over `munkres`:

- **Determinism is owned, not inherited.** The `munkres` README promises only that "if several optimal assignments exist, one is returned". Which one is not specified, so a version bump could change saved match runs. In the test, the two solvers picked different (equally optimal) assignments in 39 of 4000 cases, which shows tie-breaking is implementation-specific.
- **`Infinity` does not mean forbidden in any candidate.** In `munkres` it means "last resort": a forbidden pair is returned when nothing finite is left. So the padding and the post-filter have to be written either way. The library saves only the 50-line core.
- **Maintenance risk is real but small.** `munkres` has one maintainer, 2 GitHub stars, and no release between 2.0.4 (2024-06-22) and 2.0.5 (2026-05-26).
- **The matcher package stays dependency-free**, which matches its "pure" role.

The cost of hand-writing is the test, not the code: one property test against brute force (appendix has the shape). Budget about 30 minutes for both.

## Candidates

Registry data from `registry.npmjs.org/<pkg>`, downloads from `api.npmjs.org/downloads/point/last-week/<pkg>` (week 2026-09-24 to 2026-09-30), repository data from the GitHub API.

| Package | Latest, published | Weekly downloads | Types | Licence | Runtime deps | Open issues (excl. PRs) | Rectangular | `Infinity` / forbidden pairs |
|---|---|---|---|---|---|---|---|---|
| [`munkres`](https://github.com/havelessbemore/munkres) | 2.1.1, 2026-05-29 | 35,528 | Bundled `.d.ts`, ESM and CJS | MIT | None | 0 (6 open dependency-bot PRs) | Yes, returns `min(rows, cols)` pairs | Accepted. Documented as "used only as a last resort, when no finite alternative exists". Tested: returns the forbidden pair when a row is all `Infinity`. `NaN` throws. |
| [`linear-sum-assignment`](https://github.com/mljs/linear-sum-assignment) (mljs) | 1.0.9, 2025-10-21 | 675,090 | Bundled `.d.ts`, ESM only | MIT | 3: `ml-matrix`, `ml-spectra-processing`, `cheminfo-types` (13 packages, 7.1 MB installed together with the other two candidates) | 0 | Yes, unassigned index is `-1` | Not documented. Tested: one `Infinity` cell is fine; a row of all `Infinity` makes the whole result `-1` with `gain: -1`, so nothing is assigned. |
| [`munkres-js`](https://github.com/addaleax/munkres-js) | 1.2.2, 2017-01-02 | 78,500 | None bundled; `@types/munkres-js` does not exist on the registry | Apache-2.0 OR BSD-3-Clause | None | 1 (`undefined` values cause an infinite loop, open since 2020) | Yes per README ("N×M") | Tested on one case only: avoided the `Infinity` cell. |
| [`hungarian-on3`](https://github.com/mattkrick/hungarian-on3) | 0.3.1, 2015-09-19 | 124 | None | MIT | `fast-bitset` | 1 (open since 2018) | Not verified | Not verified |
| `munkres-algorithm` | 1.0.2, 2022-05-12 | 20,048 | `types` field points at `dist/index.d.js`, not verified to resolve | MIT | None | No repository listed | Not verified | Not verified |

Not usable: `hungarian` is an npm security-holder placeholder. `ml-hungarian`, `lapjv` and `lap-jv` do not exist on the registry.

Notes on the two serious candidates:

- **`munkres`**: Node >= 18. README states O(M²N) time and O(M+N) extra memory, and offers a `bigint` path for exact integer costs. Last push 2026-08-05.
- **`linear-sum-assignment`**: Jonker–Volgenant, after Crouse, "On implementing 2D rectangular assignment algorithms". Two traps. It **maximises by default**, and the option to turn that off is spelled `maximaze`. The README's `import linearSumAssignment from` fails on 1.0.9; the export is named (`import { linearSumAssignment }`). The core is 198 source lines but pulls in a matrix library the project does not otherwise need.

## Encoding "fill as many slots as possible, then minimise cost"

`DESIGN.md` 6.5 says: cost `1 − score`, infinity where a hard constraint fails, padded with "leave unfilled" options. The padding is right. The infinity is not safe to pass to a solver: `Infinity − Infinity` is `NaN` in a hand-written solver, and the libraries treat it as "last resort" or fail. Use finite integers for everything.

For `S` open slots and `C` crew, build an `S × (C + S)` matrix:

| Cell | Value |
|---|---|
| Allowed pair | `round((1 − score) × 1_000_000)`, an integer from 0 to 1,000,000 |
| Slot `i`, its own dummy column `C + i` | `UNFILLED = S × 1_000_000 + 1` |
| Forbidden pair, and any other slot's dummy column | `FORBIDDEN = 2 × UNFILLED` |

Why this is correct:

- `UNFILLED` is larger than the sum of any `S` real costs. Filling one more slot therefore always beats any improvement in quality, which is the lexicographic order the design asks for.
- Every slot always has its own dummy available, so the optimum never contains a `FORBIDDEN` cell. Still check for it when decoding and treat it as a bug.
- Rows never exceed columns, so the simple "rows ≤ columns" form of the algorithm is enough, including when there are fewer crew than slots or none.
- One dummy per slot (rather than `S` interchangeable ones) removes a source of meaningless ties.
- All values are integers far below 2⁵³ (the largest possible sum is about 8 × 10⁸ for 20 slots), so the arithmetic is exact.

Decoding: a slot whose column index is `>= C` is unfilled.

Large penalty alone, without dummy columns, also works when crew outnumber slots: mark forbidden pairs with the penalty and drop them afterwards. It breaks down when slots outnumber crew, because the solver then needs the transposed problem or an explicit pad. Dummy columns cover both cases with one code path, so use both together as above.

Pinned and already `offered` or `accepted` crew are removed from the matrix before solving, as 6.5 already says. They need no solver support.

## Determinism

1. Sort slots and crew by reference before building the matrix. `DESIGN.md` 6.5 already requires this.
2. Use the integer costs above. Float sums can differ in the last bit depending on the order of addition, which would make ties unstable. The rounding means two scores closer than 0.000001 count as equal.
3. Keep the comparisons strict (`<`). The lowest column index then wins a tie, so with sorted input the earliest crew reference wins.
4. No randomness, no `Map` or `Set` iteration, no dependence on time.
5. If the library is used instead, pin the exact version (`"munkres": "2.1.1"`, no caret), because its tie-breaking is unspecified.

When several assignments are equally good, the result is whichever the scan order reaches first. That is stable for the same input, but it is not a documented rule such as "lowest crew reference". If a stated rule is wanted, add a tiny per-column tie-break term to the integer costs; this was not tested.

## Hand-written version: size and risks

Size: 50 lines for the solver in the appendix, plus about 15 for encode and decode.

Risks:

- **Off-by-one errors.** The standard form uses 1-based arrays with a virtual column 0. A property test against brute force catches these.
- **Non-finite input.** `Infinity` or `NaN` in the matrix gives `NaN` potentials and a wrong answer or a hang. The encoding above never produces them; assert it at the boundary.
- **More rows than columns.** The loop does not terminate correctly. The padding guarantees it cannot happen; the function throws if it does.
- **Complexity.** O(rows² × columns). For 20 slots × 520 columns it ran in about 0.3 ms, the same order as `munkres` (0.24 ms). Measured on one machine, Node 22.
- **It is not the O(n³) matrix-covering "textbook Munkres".** That variant (the one `munkres-js` ports, 710 lines) is longer and harder to get right. Do not write that one.

## Sanity check

Run in a temporary directory outside the repo, Node 22.22.1.

3 slots × 4 crew, slot 0 × crew 0 forbidden with `Infinity`:

| Solver | Result | Correct |
|---|---|---|
| `munkres` | `[[0,1],[1,0],[2,3]]` | Yes (total 0.8) |
| `munkres-js` | `[[0,1],[1,0],[2,3]]` | Yes |
| `linear-sum-assignment`, `maximaze: false` | rows `[1,0,3]`, gain 0.8 | Yes |
| `linear-sum-assignment`, default options | all `-1` | No: it was maximising |

Slot 0 with no candidate at all (row of `Infinity`):

| Solver | Result |
|---|---|
| `munkres` | `[[0,2],[1,0],[2,1]]`: assigns the forbidden pair `[0,2]` |
| `linear-sum-assignment` | all `-1`: assigns nothing, including the two slots that could be filled |

With the integer encoding above, over 4000 random cases (1 to 5 slots, 0 to 6 crew, random forbidden pairs, scores in steps of 0.1 to force ties), compared with brute force on slots filled and then total cost:

- hand-written solver: 0 non-optimal;
- `munkres`: 0 non-optimal;
- 39 cases where the two chose different, equally optimal assignments.

The `DESIGN.md` 6.3 example (Ada and Ben, Pilot and Medic) gives Ben as pilot and Ada as medic with both.

## Not verified

- `hungarian-on3` and `munkres-algorithm` were not installed or run.
- `munkres-js` was run on one case only.
- How `munkres` breaks ties internally; its source was not read.
- The complexity and benchmark figures in the `munkres` README.
- The `-1` result of `linear-sum-assignment` on an infeasible row is observed behaviour, not documented.
- npm web pages were not opened; figures come from the registry and downloads APIs.
- Timings are from a single machine and a single matrix shape.

## Appendix: the solver that was tested

```ts
/** Minimum-cost assignment. Requires rows <= columns and finite costs. Returns the column for each row. */
export function solveAssignment(cost: number[][]): number[] {
  const n = cost.length;
  const m = n === 0 ? 0 : cost[0].length;
  if (n > m) throw new Error("rows must not exceed columns");
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const rowOfCol = new Array<number>(m + 1).fill(0); // 1-based row matched to column j, 0 = none
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    rowOfCol[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = rowOfCol[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j]; // strict <: lowest column index wins ties
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[rowOfCol[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (rowOfCol[j0] !== 0);
    do {
      const j1 = way[j0];
      rowOfCol[j0] = rowOfCol[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const colOfRow = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (rowOfCol[j] !== 0) colOfRow[rowOfCol[j] - 1] = j - 1;
  return colOfRow;
}
```

The test ran this as JavaScript; the type annotations were added for this note and have not been through `tsc`.

Property test shape: generate small random score matrices with `null` for forbidden pairs, enumerate every partial assignment by recursion to find the maximum number filled and then the minimum integer cost, and assert the solver's result has the same two numbers and uses no forbidden pair and no crew member twice.

## Sources

- npm registry: `https://registry.npmjs.org/munkres`, `/linear-sum-assignment`, `/munkres-js`, `/hungarian-on3`, `/munkres-algorithm`, `/hungarian`, `/@types/munkres-js`
- npm downloads API: `https://api.npmjs.org/downloads/point/last-week/<package>`
- <https://github.com/havelessbemore/munkres> (README, repository and issues API)
- <https://github.com/mljs/linear-sum-assignment> (README, `lib/index.d.ts` in the published 1.0.9 package)
- <https://github.com/addaleax/munkres-js> (README, issue #7)
- <https://github.com/mattkrick/hungarian-on3> (repository and issues API)
- Crouse, "On implementing 2D rectangular assignment algorithms", <https://doi.org/10.1109/TAES.2016.140952> (cited by `linear-sum-assignment`; the paper itself was not read)
