import type { Context } from 'hono';
import type { z } from 'zod';
import { invalidInput } from '../errors.ts';

/** The request body, checked against its schema. A refusal names what was wrong. */
export async function readBody<Schema extends z.ZodType>(context: Context, schema: Schema): Promise<z.infer<Schema>> {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    throw invalidInput('The request body is not valid JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
    throw invalidInput(problems.join('; '));
  }
  return parsed.data;
}

/** A named parameter of the route's path. Every route declares the parameters it reads, so a missing one is a bug. */
export function pathParam(context: Context, name: string): string {
  const value = context.req.param(name);
  if (value === undefined) throw new Error(`The route ${context.req.routePath} has no :${name} parameter`);
  return value;
}
