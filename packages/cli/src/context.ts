import type { Output } from './output/style.ts';
import { type Config, readConfig, writeConfig } from './profiles.ts';
import type { Terminal } from './prompt.ts';

// What every command is given.

/** The process's streams and settings, passed in so a test can stand in for them. */
export interface Io {
  stdout: Output;
  stderr: Output;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: Terminal['setRawMode'] };
  env: Record<string, string | undefined>;
  /** The user's home folder, where the config file lives by default. */
  home: string;
}

export interface Context {
  io: Io;
  /** Print the API's answer as it came, and nothing else, on standard output. */
  json: boolean;
  /** `--profile`, when given. */
  profileFlag: string | undefined;
  configFile: string;
}

export const loadConfig = (context: Context): Config => readConfig(context.configFile);
export const saveConfig = (context: Context, config: Config) => writeConfig(context.configFile, config);
