import { parseTtl, type TokenSettings } from './auth/token.ts';
import { requireEnv } from './env.ts';

export interface Config {
  port: number;
  databaseUrl: string;
  token: TokenSettings;
}

const DEFAULT_PORT = 3000;
const DEFAULT_TOKEN_TTL = '12h';
const MIN_SECRET_LENGTH = 16;

/** The API's settings, read from the environment. Refuses to start on a missing or unusable value. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const port = Number(env.PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT "${env.PORT}" is not a port number`);
  const secret = requireEnv('TOKEN_SECRET', env);
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  return {
    port,
    databaseUrl: requireEnv('DATABASE_URL', env),
    token: { secret, ttlSeconds: parseTtl(env.TOKEN_TTL || DEFAULT_TOKEN_TTL) },
  };
}
