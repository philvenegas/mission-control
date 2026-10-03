import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_WEIGHTS } from './domain.ts';
import { scoreComponentSchema } from './matching.ts';

describe('a score\'s components', () => {
  it('are exactly the weighted components, one each', () => {
    expect(scoreComponentSchema.options.map((option) => option.shape.name.value)).toEqual(Object.keys(DEFAULT_MATCH_WEIGHTS));
  });
});
