import { createServer, type Server } from 'node:http';
import { healthResponseSchema } from '@mission-control/contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiAddress, callApi, DEFAULT_API } from './api.ts';
import { CliError } from './errors.ts';
import { mctl, scratch } from './test/api.ts';

describe('the API\'s address', () => {
  it('is the one given, else MCTL_API, else the default, without a trailing slash', () => {
    expect(apiAddress('http://api.example/', { MCTL_API: 'http://other.example' })).toBe('http://api.example');
    expect(apiAddress(undefined, { MCTL_API: 'http://other.example//' })).toBe('http://other.example');
    expect(apiAddress(undefined, {})).toBe(DEFAULT_API);
  });
});

// An API that answers in ways the real one does not: what the CLI does when an answer is not the contract's.
const ANSWERS: Record<string, { status: number; body: string }> = {
  '/v1/broken': { status: 502, body: '<html>Bad gateway</html>' },
  '/v1/teapot': { status: 409, body: '{"something":"else"}' },
  '/v1/health': { status: 200, body: '{"status":"maybe"}' },
};

let server: Server;
let address = '';
beforeAll(async () => {
  server = createServer((request, response) => {
    const answer = ANSWERS[request.url ?? ''] ?? { status: 404, body: '' };
    response.writeHead(answer.status).end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const listening = server.address();
  address = `http://localhost:${listening && typeof listening === 'object' ? listening.port : 0}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('an answer that is not the contract\'s', () => {
  it('reports a refusal without the error shape by its status, mapped to its exit code', async () => {
    await expect(callApi(address, { method: 'GET', path: '/v1/broken' }, healthResponseSchema)).rejects.toThrow(
      new CliError('general', `The API at ${address} answered 502.`),
    );
    await expect(callApi(address, { method: 'GET', path: '/v1/teapot' }, healthResponseSchema)).rejects.toMatchObject({ failure: 'conflict' });
  });

  it('makes mctl status say the API answers, but not as expected, rather than that it is not running', async () => {
    const ran = await mctl(['status'], { MCTL_API: address, MCTL_CONFIG: `${scratch()}/config.json` });
    expect(ran.code).toBe(1);
    expect(ran.stdout).toContain(`API      ${address}  answers, but not as expected: The API at ${address} gave an answer this mctl does not understand.`);
  });

  it('refuses a success it does not understand, rather than guessing', async () => {
    await expect(callApi(address, { method: 'GET', path: '/v1/health' }, healthResponseSchema)).rejects.toThrow(
      new CliError('general', `The API at ${address} gave an answer this mctl does not understand.`, 'Check that mctl and the API come from the same version.'),
    );
  });
});
