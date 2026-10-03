import { describe, expect, it } from 'vitest';
import { CliError, failureFor } from './errors.ts';

describe('exit codes', () => {
  it('follow the API\'s answer as DESIGN.md section 8 lists them', () => {
    const codes = [400, 422, 401, 403, 404, 409, 500, 418].map((status) => new CliError(failureFor(status), '').exitCode);
    expect(codes).toEqual([2, 2, 3, 4, 5, 6, 1, 1]);
  });
});
