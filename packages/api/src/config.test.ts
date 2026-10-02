import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const env = { DATABASE_URL: 'postgres://mc_api:pw@localhost:54329/mission_control', TOKEN_SECRET: 'sixteen-chars-ok' };

describe('the API settings', () => {
  it('default to port 3000 and tokens that last 12 hours', () => {
    expect(loadConfig(env)).toEqual({
      port: 3000,
      databaseUrl: env.DATABASE_URL,
      token: { secret: env.TOKEN_SECRET, ttlSeconds: 12 * 60 * 60 },
    });
  });

  it('take the port and token lifetime from the environment', () => {
    expect(loadConfig({ ...env, PORT: '8080', TOKEN_TTL: '7d' })).toMatchObject({ port: 8080, token: { ttlSeconds: 7 * 24 * 60 * 60 } });
  });

  it.each([
    ['no database address', { ...env, DATABASE_URL: undefined }, /DATABASE_URL is not set/],
    ['no token secret', { ...env, TOKEN_SECRET: '' }, /TOKEN_SECRET is not set/],
    ['a short token secret', { ...env, TOKEN_SECRET: 'short' }, /at least 16 characters/],
    ['a port that is not a number', { ...env, PORT: 'http' }, /is not a port number/],
    ['a port out of range', { ...env, PORT: '70000' }, /is not a port number/],
    ['a token lifetime it cannot read', { ...env, TOKEN_TTL: 'forever' }, /is not a lifetime/],
  ])('refuse to load with %s', (_, bad, message) => {
    expect(() => loadConfig(bad)).toThrow(message);
  });
});
