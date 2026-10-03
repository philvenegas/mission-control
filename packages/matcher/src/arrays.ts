/** The entry at `index`, which the caller has sized the array to hold. Past the end is a bug, not an absence. */
export function valueAt(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error(`Index ${index} is past the end of an array of ${values.length}`);
  return value;
}
