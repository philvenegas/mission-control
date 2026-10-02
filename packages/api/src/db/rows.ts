/** The single row a query must have returned. Anything else is a bug, not something the caller did. */
export function exactlyOne<Row>(rows: readonly Row[], what: string): Row {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) throw new Error(`Expected exactly one ${what}, found ${rows.length}`);
  return row;
}
