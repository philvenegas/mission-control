import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** A setting that must be present; the error names it and says how to create it. */
export function requireEnv(name: string, env: Record<string, string | undefined> = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set. Run \`pnpm demo:setup\`, which copies .env.example to .env.`);
  return value;
}
