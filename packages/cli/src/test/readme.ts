// The README's walk-through, read as a script: each console block of its "Walk-through" section is
// an act, each `$ mctl …` line a command, and the lines under it what the command prints. The
// end-to-end test runs it, so the README cannot drift from what the CLI does.

/** One command of the walk-through, as the README shows it. */
export interface WalkthroughStep {
  /** The command as typed, without its comment. */
  command: string;
  /** The words after `mctl`, as the shell would pass them. */
  args: string[];
  /** 0, or the code a comment gives ("refused with exit code 4"). */
  exitCode: number;
  /** What the README shows the command printing, both streams, without trailing blank lines. */
  output: string;
}

const SECTION = '## Walk-through';
const PROMPT = '$ ';
// Shell syntax the walk-through does not use, so that splitting on spaces and double quotes gives
// the words a shell would.
const SHELL_SYNTAX = /['\\$|<>;&`]/;

/**
 * Splits a command into words, as a shell does for plain words and double quotes, and finds where
 * its comment starts.
 */
function splitCommand(line: string): { words: string[]; commentAt: number } {
  const words: string[] = [];
  let word: string | null = null;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);
    if (character === '"') {
      quoted = !quoted;
      word ??= '';
    } else if (quoted) {
      word = (word ?? '') + character;
    } else if (character === ' ') {
      if (word !== null) words.push(word);
      word = null;
    } else if (character === '#' && word === null) {
      return { words, commentAt: index };
    } else {
      word = (word ?? '') + character;
    }
  }
  if (quoted) throw new Error(`The walk-through command "${line}" has an unclosed quote.`);
  if (word !== null) words.push(word);
  return { words, commentAt: line.length };
}

function readStep(line: string): WalkthroughStep {
  const typed = line.slice(PROMPT.length);
  const { words, commentAt } = splitCommand(typed);
  const command = typed.slice(0, commentAt).trim();
  const comment = typed.slice(commentAt);
  if (SHELL_SYNTAX.test(command)) throw new Error(`The walk-through command "${command}" uses shell syntax the test does not run.`);
  const [program, ...args] = words;
  if (program !== 'mctl') throw new Error(`The walk-through runs only mctl, not "${command}".`);
  const exitCode = Number(/exit code (\d+)/.exec(comment)?.[1] ?? 0);
  return { command, args, exitCode, output: '' };
}

/** The lines of each console block in the walk-through section. */
function consoleBlocks(markdown: string): string[][] {
  const start = markdown.indexOf(`\n${SECTION}\n`);
  if (start < 0) throw new Error(`The README has no "${SECTION}" section.`);
  const rest = markdown.slice(start + SECTION.length + 2);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^```console\n([\s\S]*?)^```$/gm)].map(([, body = '']) => body.split('\n'));
}

/** The walk-through's acts, each a list of the commands it runs and what they print. */
export function readWalkthrough(markdown: string): WalkthroughStep[][] {
  const blocks = consoleBlocks(markdown);
  if (blocks.length === 0) throw new Error('The walk-through has no console blocks.');
  return blocks.map((lines) => {
    const steps: { step: WalkthroughStep; output: string[] }[] = [];
    for (const line of lines) {
      const current = steps.at(-1);
      if (line.startsWith(PROMPT)) steps.push({ step: readStep(line), output: [] });
      else if (current) current.output.push(line);
      else if (line.trim()) throw new Error(`Output before any command in the walk-through: "${line}"`);
    }
    return steps.map(({ step, output }) => ({ ...step, output: output.join('\n').trimEnd() }));
  });
}
