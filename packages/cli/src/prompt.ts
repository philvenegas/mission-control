import { CliError } from './errors.ts';
import type { Output } from './output/style.ts';

// The password prompt: a line read from the terminal without echoing it.

/** A terminal that can be put in raw mode, so keys are read one at a time and not echoed. */
export interface Terminal extends NodeJS.ReadableStream {
  setRawMode(mode: boolean): unknown;
}

/** Whether a stream is a terminal the prompt can put in raw mode. */
export const isTerminal = (stream: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: unknown }): stream is Terminal =>
  stream.isTTY === true && typeof stream.setRawMode === 'function';

const ENTER = ['\r', '\n'];
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = ['\u007f', '\b'];

/** Asks a question and reads one line from the terminal without echoing it: a password prompt. */
export function readHiddenLine(input: Terminal, output: Output, question: string): Promise<string> {
  output.write(question);
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();
  let typed = '';
  return new Promise<string>((resolve, reject) => {
    const finish = (settle: () => void) => {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      settle();
    };
    const cancelled = () => finish(() => reject(new CliError('interrupted', 'Login cancelled.')));
    const onEnd = cancelled;
    function onData(chunk: string | Buffer) {
      for (const key of String(chunk)) {
        if (ENTER.includes(key)) return finish(() => resolve(typed));
        if (key === CTRL_C || key === CTRL_D) return cancelled();
        typed = BACKSPACE.includes(key) ? typed.slice(0, -1) : typed + key;
      }
    }
    input.on('data', onData);
    input.on('end', onEnd);
  });
}

/** Reads one line typed at a terminal, which echoes it; null if the input ends first. */
function readLine(input: NodeJS.ReadableStream): Promise<string | null> {
  let typed = '';
  return new Promise((resolve) => {
    const finish = (line: string | null) => {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.pause();
      resolve(line);
    };
    const onEnd = () => finish(null);
    function onData(chunk: string | Buffer) {
      typed += String(chunk);
      const end = typed.indexOf('\n');
      if (end >= 0) finish(typed.slice(0, end));
    }
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

/**
 * Asks before a destructive change (DESIGN.md section 8), and goes ahead only on yes. With no
 * terminal to ask on, it refuses with `cannotAsk`, which says how to go ahead without being asked.
 */
export async function confirm(input: NodeJS.ReadableStream & { isTTY?: boolean }, output: Output, question: string, cannotAsk: CliError): Promise<void> {
  if (input.isTTY !== true) throw cannotAsk;
  output.write(`${question} [y/N] `);
  const answer = (await readLine(input))?.trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') throw new CliError('general', 'Nothing was changed.');
}
