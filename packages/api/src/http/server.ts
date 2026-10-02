import { serve } from '@hono/node-server';
import type { Config } from '../config.ts';
import { connect } from '../db/connection.ts';
import { createApp } from './app.ts';

/** Starts the API. Resolves once it is listening; rejects, in words, if the port is taken. */
export function startServer(config: Config): Promise<{ port: number; close(): Promise<void> }> {
  const { client, db } = connect(config.databaseUrl);
  const app = createApp({ db, token: config.token });
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
      const close = () =>
        new Promise<void>((closed, failed) => server.close((error) => (error ? failed(error) : closed()))).then(() => client.end());
      resolve({ port, close });
    });
    server.on('error', (error: NodeJS.ErrnoException) => {
      void client.end();
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${config.port} is already in use. Stop what is using it, or set PORT in .env to another port.`)
          : error,
      );
    });
  });
}
