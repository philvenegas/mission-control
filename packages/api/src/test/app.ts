import type { LoginResponse } from '@mission-control/contract';
import { type App, createApp } from '../http/app.ts';
import { DEMO_PASSWORD } from '../db/seed.ts';
import { connectAsApi } from './database.ts';

export const TEST_TOKEN_SECRET = 'a-secret-for-integration-tests';
export const TEST_TOKEN_TTL_SECONDS = 60 * 60;

/** The API under test: the real app, on the test database, as the API database role. */
export function startTestApp() {
  const { client, db } = connectAsApi();
  const unexpectedErrors: unknown[] = [];
  const app = createApp({
    db,
    tokenSecret: TEST_TOKEN_SECRET,
    tokenTtlSeconds: TEST_TOKEN_TTL_SECONDS,
    onUnexpectedError: (error) => unexpectedErrors.push(error),
  });
  return { app, db, unexpectedErrors, close: () => client.end() };
}

export function postLogin(app: App, body: unknown) {
  return app.request('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Logs a seeded user in and returns a caller that sends their token. */
export async function loginAs(app: App, org: string, email: string) {
  const response = await postLogin(app, { org, email, password: DEMO_PASSWORD });
  if (response.status !== 200) throw new Error(`Could not log ${email} in to ${org}: ${response.status}`);
  const { token } = (await response.json()) as LoginResponse;
  return caller(app, token);
}

export function caller(app: App, token: string) {
  const request = (method: string) => (path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { token, get: request('GET'), post: request('POST') };
}

export type Caller = ReturnType<typeof caller>;
