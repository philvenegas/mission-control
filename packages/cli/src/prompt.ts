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
