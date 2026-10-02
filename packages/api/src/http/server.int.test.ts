import { expect, it } from 'vitest';
import { requireEnv } from '../env.ts';
import { startServer } from './server.ts';

const config = (port: number) => ({
  port,
  databaseUrl: requireEnv('TEST_DATABASE_URL'),
  tokenSecret: 'a-secret-for-integration-tests',
  tokenTtlSeconds: 3600,
});

it('serves the API over HTTP, and says so plainly when its port is taken', async () => {
  const server = await startServer(config(0));
  try {
    const health = await fetch(`http://localhost:${server.port}/v1/health`);
    expect(await health.json()).toEqual({ status: 'ok' });
    const login = await fetch(`http://localhost:${server.port}/v1/auth/login`, { method: 'POST', body: '{}' });
    expect(login.status).toBe(400);

    await expect(startServer(config(server.port))).rejects.toThrow(
      `Port ${server.port} is already in use. Stop what is using it, or set PORT in .env to another port.`,
    );
  } finally {
    await server.close();
  }
  await expect(fetch(`http://localhost:${server.port}/v1/health`)).rejects.toThrow();
});
