// Loads .env before anything reads the environment.
import './env.ts';
import { loadConfig } from './config.ts';
import { startServer } from './http/server.ts';

try {
  const { port } = await startServer(loadConfig(process.env));
  console.log(`Mission Control API listening on http://localhost:${port}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
