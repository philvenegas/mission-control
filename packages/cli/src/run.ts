import { Command, CommanderError } from 'commander';
import { listProfiles, useProfileCommand } from './commands/profile.ts';
import { type LoginOptions, login, logout, whoami } from './commands/session.ts';
import { status } from './commands/status.ts';
import { type Context, type Io, printError } from './context.ts';
import { CliError, EXIT_CODES } from './errors.ts';
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
      exitCode = listProfiles(context());
    });
  profiles
    .command('use')
    .description('make a profile the current one')
    .argument('<name>', 'the profile')
    .action((name: string) => {
      exitCode = useProfileCommand(context(), name);
    });

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
