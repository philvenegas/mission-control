import { Command, CommanderError } from 'commander';
import { registerAssignmentCommands } from './commands/assignment.ts';
import { registerAvailabilityCommands } from './commands/availability.ts';
import { registerCrewCommands } from './commands/crew.ts';
import { type LoginOptions, login, logout, whoami } from './commands/login.ts';
import { registerMatchCommands } from './commands/match.ts';
import { registerMissionCommands } from './commands/mission.ts';
import { registerOrgCommands } from './commands/org.ts';
import { profileList, profileUse } from './commands/profile.ts';
import type { Perform } from './commands/shared.ts';
import { registerSkillCommands } from './commands/skill.ts';
import { status } from './commands/status.ts';
import type { Context, Io } from './context.ts';
import { CliError, EXIT_CODES } from './errors.ts';
import { printError } from './output/print.ts';
import { configPath } from './profiles.ts';

/**
 * Runs one `mctl` command and gives its exit code (DESIGN.md section 8). Commands are noun then
 * verb, mirroring the API; every failure is printed with its hint and mapped to an exit code.
 */
export async function run(argv: string[], io: Io): Promise<number> {
  let exitCode = 0;
  const program = new Command('mctl')
    .description('Plan missions and assign their crew, through the Mission Control API.')
    .option('--profile <name>', 'act as this profile for one command (or set MCTL_PROFILE)')
    .option('--json', 'print the API\'s answer as it came, for scripts')
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.stdout.write(text), writeErr: (text) => io.stderr.write(text) });
  const context = (): Context => {
    const options = program.opts<{ profile?: string; json?: boolean }>();
    return { io, json: options.json === true, profileFlag: options.profile, configFile: configPath(io.env, io.home) };
  };

  program
    .command('login')
    .description('log in, keeping the login as a profile; the password is asked for, never given as a flag')
    .requiredOption('--org <slug>', 'the organisation\'s slug')
    .requiredOption('--email <email>', 'your email')
    .option('--api <url>', 'the API\'s address (or set MCTL_API)')
    .option('--password-stdin', 'read the password from standard input, for scripts')
    .action(async (options: LoginOptions) => {
      exitCode = await login(context(), options);
    });
  program
    .command('logout')
    .description('forget the login of the current profile, or of every profile')
    .option('--all', 'every profile')
    .action((options: { all?: boolean }) => {
      exitCode = logout(context(), options);
    });
  program
    .command('whoami')
    .description('who commands act as')
    .action(async () => {
      exitCode = await whoami(context());
    });
  program
    .command('status')
    .description('where the API is, whether it answers, and the current login')
    .action(async () => {
      exitCode = await status(context());
    });
  const profiles = program.command('profile').description('the logins kept on this computer');
  profiles
    .command('list')
    .description('every profile, marking the current one')
    .action(() => {
      exitCode = profileList(context());
    });
  profiles
    .command('use')
    .description('make a profile the current one')
    .argument('<name>', 'the profile')
    .action((name: string) => {
      exitCode = profileUse(context(), name);
    });

  // The walk-through's commands, in its order (DESIGN.md section 8).
  const perform: Perform =
    (command) =>
    async (...args) => {
      exitCode = await command(context(), ...args);
    };
  for (const register of [
    registerMissionCommands,
    registerMatchCommands,
    registerAssignmentCommands,
    registerCrewCommands,
    registerAvailabilityCommands,
    registerSkillCommands,
    registerOrgCommands,
  ]) {
    register(program, perform);
  }

  try {
    await program.parseAsync(argv, { from: 'user' });
    return exitCode;
  } catch (error) {
    // Commander has already printed its own message: a usage error, or the help asked for.
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : EXIT_CODES.usage;
    if (error instanceof CliError) {
      printError(io, error);
      return error.exitCode;
    }
    throw error;
  }
}
