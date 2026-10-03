import { describe, expect, it } from 'vitest';
import { readWalkthrough } from './readme.ts';

const readme = (walkthrough: string) => `# Mission Control

## Setup

\`\`\`console
$ mctl status
not part of the walk-through
\`\`\`

## Walk-through

${walkthrough}

## Tests

\`\`\`console
$ mctl whoami
not part of the walk-through either
\`\`\`
`;

describe('readWalkthrough', () => {
  it('reads each console block of the walk-through section as an act: the commands, their output, and exit code 0', () => {
    const acts = readWalkthrough(
      readme(`### Act 1

\`\`\`console
$ mctl mission create --name "Europa Survey" --from 2027-03-01 --to 2027-03-20
Created MSN-8.

Next: mctl mission require MSN-8
$ mctl match run MSN-8      # the proposal; nothing changes yet
✓ 2 of 2 slots filled


\`\`\`

### Act 2

\`\`\`console
$ mctl mission show MSN-4
MSN-4
\`\`\``),
    );
    expect(acts).toEqual([
      [
        {
          command: 'mctl mission create --name "Europa Survey" --from 2027-03-01 --to 2027-03-20',
          args: ['mission', 'create', '--name', 'Europa Survey', '--from', '2027-03-01', '--to', '2027-03-20'],
          exitCode: 0,
          output: 'Created MSN-8.\n\nNext: mctl mission require MSN-8',
        },
        { command: 'mctl match run MSN-8', args: ['match', 'run', 'MSN-8'], exitCode: 0, output: '✓ 2 of 2 slots filled' },
      ],
      [{ command: 'mctl mission show MSN-4', args: ['mission', 'show', 'MSN-4'], exitCode: 0, output: 'MSN-4' }],
    ]);
  });

  it('takes the exit code a refused command shows from its comment', () => {
    const [step] = readWalkthrough(readme('```console\n$ mctl mission approve MSN-8   # refused with exit code 4: a mission lead cannot approve\nError: Your role does not allow this.\n```')).flat();
    expect(step).toMatchObject({ command: 'mctl mission approve MSN-8', exitCode: 4 });
  });

  it('keeps a # inside quotes as part of a word', () => {
    const [step] = readWalkthrough(readme('```console\n$ mctl assignment decline ASG-14 --reason "Leave #2"\nDeclined.\n```')).flat();
    expect(step?.args).toEqual(['assignment', 'decline', 'ASG-14', '--reason', 'Leave #2']);
  });

  it('refuses a README without a walk-through section, or with one that runs nothing', () => {
    expect(() => readWalkthrough('# Mission Control\n')).toThrow('The README has no "## Walk-through" section.');
    expect(() => readWalkthrough(readme('Prose only.'))).toThrow('The walk-through has no console blocks.');
  });

  it('refuses output before the first command, and a command other than mctl', () => {
    expect(() => readWalkthrough(readme('```console\nstray\n$ mctl whoami\n```'))).toThrow('Output before any command in the walk-through: "stray"');
    expect(() => readWalkthrough(readme('```console\n$ pnpm demo:login\n```'))).toThrow('The walk-through runs only mctl, not "pnpm demo:login".');
  });

  it('refuses shell syntax it would not run as the shell does: other quotes, escapes, variables, pipes and unbalanced quotes', () => {
    for (const command of [`mctl crew add --name 'Ada'`, 'mctl crew add --name Ada\\ Reyes', 'mctl whoami --profile $USER', 'mctl whoami | cat', 'mctl whoami > out', 'mctl whoami; ls', 'mctl whoami && ls', 'mctl whoami `ls`']) {
      expect(() => readWalkthrough(readme(`\`\`\`console\n$ ${command}\n\`\`\``)), command).toThrow(`The walk-through command "${command}" uses shell syntax`);
    }
    expect(() => readWalkthrough(readme('```console\n$ mctl crew add --name "Ada\n```'))).toThrow('The walk-through command "mctl crew add --name "Ada" has an unclosed quote.');
  });
});
