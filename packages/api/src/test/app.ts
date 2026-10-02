import { loginResponseSchema } from '@mission-control/contract';
import { afterAll, beforeAll } from 'vitest';
import type { TokenSettings } from '../auth/token.ts';
import { DEMO_PASSWORD, seed } from '../db/seed.ts';
import { type App, createApp } from '../http/app.ts';
import type { Route } from '../http/route.ts';
import { connectAsApi, connectAsOwner } from './database.ts';

export const TEST_TOKEN: TokenSettings = { secret: 'a-secret-for-integration-tests', ttlSeconds: 60 * 60 };

/**
 * The API under test: the real app, on a freshly seeded test database, as the API database role.
 * `owner` is for arranging data the API cannot; it never stands in for the API.
 */
export function useSeededApp(extraRoutes: Route[] = []) {
  const owner = connectAsOwner();
  const api = connectAsApi();
  const unexpectedErrors: unknown[] = [];
  const app = createApp({ db: api.db, token: TEST_TOKEN, extraRoutes, onUnexpectedError: (error) => unexpectedErrors.push(error) });

  beforeAll(async () => {
    await seed(owner.db);
  });
  afterAll(async () => {
    await Promise.all([owner.client.end(), api.client.end()]);
  });
  return { app, owner: owner.client, api, unexpectedErrors };
}

export function postLogin(app: App, body: unknown) {
  return app.request('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Logs a user in and returns a caller that sends their token. */
export async function loginAs(app: App, org: string, email: string, password = DEMO_PASSWORD) {
  const response = await postLogin(app, { org, email, password });
  const { token } = loginResponseSchema.parse(await response.json());
  return callerWith(app, token);
}

export function callerWith(app: App, token: string) {
  const request = (method: string) => (path: string) => app.request(path, { method, headers: { Authorization: `Bearer ${token}` } });
  return { get: request('GET'), post: request('POST') };
}

export type Caller = ReturnType<typeof callerWith>;
