import { type Context, Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError } from '../errors.ts';
import { pathParam, readBody } from './request.ts';

/** Runs `read` inside a real request and returns what it gave, or the error it threw. */
async function within(read: (c: Context) => unknown, body?: string, path = '/things/CRW-4') {
  const app = new Hono();
  let outcome: unknown;
  app.post('/things/:ref', async (c) => {
    try {
      outcome = await read(c);
    } catch (error) {
      outcome = error;
    }
    return c.body(null, 204);
  });
  await app.request(path, { method: 'POST', body });
  return outcome;
}

describe('reading a request body', () => {
  const schema = z.object({ name: z.string().min(1), level: z.number() });

  it('gives the body when it matches the schema', async () => {
    expect(await within((c) => readBody(c, schema), '{"name":"pilot","level":3}')).toEqual({ name: 'pilot', level: 3 });
  });

  it('refuses a body that is not JSON', async () => {
    expect(await within((c) => readBody(c, schema), 'name=pilot')).toMatchObject({
      code: 'INVALID_INPUT',
      message: 'The request body is not valid JSON.',
    });
  });

  it('refuses a body that does not match, naming each field that is wrong', async () => {
    const error = await within((c) => readBody(c, schema), '{"name":"","level":"three"}');
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/^name: .+; level: .+$/) });
  });
});

describe('reading the path', () => {
  it("gives a parameter the route declares, and treats one it does not declare as a bug", async () => {
    expect(await within((c) => pathParam(c, 'ref'))).toBe('CRW-4');
    expect(String(await within((c) => pathParam(c, 'skill')))).toBe('Error: The route /things/:ref has no :skill parameter');
  });
});
