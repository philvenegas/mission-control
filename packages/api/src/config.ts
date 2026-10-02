import { parseTtl } from './auth/token.ts';

export interface Config {
  port: number;
  databaseUrl: string;
  tokenSecret: string;
  tokenTtlSeconds: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_TOKEN_TTL = '12h';
const MIN_SECRET_LENGTH = 16;

/** The API's settings, read from the environment. Refuses to start on a missing or unusable value. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set. Run \`pnpm demo:setup\`, which copies .env.example to .env.`);
    return value;
  };
  const port = Number(env.PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT "${env.PORT}" is not a port number`);
  const tokenSecret = required('TOKEN_SECRET');
  if (tokenSecret.length < MIN_SECRET_LENGTH) throw new Error(`TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  return {
    port,
    databaseUrl: required('DATABASE_URL'),
    tokenSecret,
    tokenTtlSeconds: parseTtl(env.TOKEN_TTL || DEFAULT_TOKEN_TTL),
  };
}
