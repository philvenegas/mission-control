import { describe, expect, it } from 'vitest';
import { loginRequestSchema } from './api.ts';
import { ERROR_CODES, errorResponseSchema } from './errors.ts';

describe('a login request', () => {
  it('reads the organisation and email without regard to case or surrounding space', () => {
    expect(loginRequestSchema.parse({ org: ' Artemis ', email: 'Sam@Artemis.example', password: ' pass word ' })).toEqual({
      org: 'artemis',
      email: 'sam@artemis.example',
      password: ' pass word ',
    });
  });

  it.each([
    ['no organisation', { email: 'sam@artemis.example', password: 'x' }],
    ['a blank email', { org: 'artemis', email: '  ', password: 'x' }],
    ['an empty password', { org: 'artemis', email: 'sam@artemis.example', password: '' }],
    ['a password that is not text', { org: 'artemis', email: 'sam@artemis.example', password: 7 }],
  ])('is refused with %s', (_, body) => {
    expect(loginRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('an error response', () => {
  it('carries a known code, a message and an optional hint', () => {
    const body = { error: { code: 'FORBIDDEN', message: 'No.', hint: 'Ask a director.' } };
    expect(errorResponseSchema.parse(body)).toEqual(body);
    expect(errorResponseSchema.safeParse({ error: { code: 'TEAPOT', message: 'No.' } }).success).toBe(false);
  });

  it('gives a failed login and a missing login the same status', () => {
    expect(ERROR_CODES.INVALID_LOGIN).toBe(401);
    expect(ERROR_CODES.UNAUTHENTICATED).toBe(401);
  });
});
