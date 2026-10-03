import { errorResponseSchema } from '@mission-control/contract';
import type { z } from 'zod';
import { CliError, failureFor } from './errors.ts';

// The one way the CLI talks to the API. It sends a request and checks the answer against the
// contract's schema; the API decides everything else (DESIGN.md section 9, rule 5).

/** Where the API is when nothing says otherwise. */
export const DEFAULT_API = 'http://localhost:3000';

/** The API's address: the one given (`--api`), else `MCTL_API`, else the default; without a trailing slash. */
export const apiAddress = (given: string | undefined, env: Record<string, string | undefined>) =>
  (given ?? env.MCTL_API ?? DEFAULT_API).replace(/\/+$/, '');

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  token?: string;
  body?: unknown;
}

/** The API's answer: checked against its schema, and as it came, for `--json`. */
export interface ApiAnswer<T> {
  data: T;
  raw: unknown;
}

/** Nothing answered at the API's address: it is not running there. */
export class UnreachableApi extends CliError {
  constructor(api: string) {
    super('general', `Cannot reach the API at ${api}.`, 'Start it with `pnpm api`, in a terminal of its own, or check the address with `mctl status`.');
  }
}

export async function callApi<Schema extends z.ZodType>(api: string, request: ApiRequest, schema: Schema): Promise<ApiAnswer<z.infer<Schema>>> {
  let response: Response;
  try {
    response = await fetch(`${api}${request.path}`, {
      method: request.method,
      headers: {
        ...(request.token ? { Authorization: `Bearer ${request.token}` } : {}),
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch {
    throw new UnreachableApi(api);
  }
  const text = await response.text();
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = undefined;
  }
  if (!response.ok) {
    const refusal = errorResponseSchema.safeParse(raw);
    if (!refusal.success) throw new CliError(failureFor(response.status), `The API at ${api} answered ${response.status}.`);
    throw new CliError(failureFor(response.status), refusal.data.error.message, refusal.data.error.hint);
  }
  const data = schema.safeParse(raw);
  if (!data.success) {
    throw new CliError('general', `The API at ${api} gave an answer this mctl does not understand.`, 'Check that mctl and the API come from the same version.');
  }
  return { data: data.data, raw };
}
