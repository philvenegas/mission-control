import { CliError } from './errors.ts';

// Everything the CLI writes goes through here: plain text, with colour only for a terminal.

/** Somewhere text is written: standard output or the error stream. */
export interface Output {
  write(text: string): void;
  isTTY?: boolean;
}

const STYLES = {
  dim: ['\u001b[2m', '\u001b[22m'],
  red: ['\u001b[31m', '\u001b[39m'],
  green: ['\u001b[32m', '\u001b[39m'],
  yellow: ['\u001b[33m', '\u001b[39m'],
} as const;
export type Style = keyof typeof STYLES;

/** Styles text for a stream: in colour for a terminal, plain otherwise or when NO_COLOR is set. */
export function paint(stream: Pick<Output, 'isTTY'>, env: Record<string, string | undefined>) {
  const coloured = stream.isTTY === true && !env.NO_COLOR;
  return (style: Style, text: string) => (coloured ? `${STYLES[style][0]}${text}${STYLES[style][1]}` : text);
}

/** A terminal that can be put in raw mode, so keys are read one at a time and not echoed. */
export interface Terminal extends NodeJS.ReadableStream {
  setRawMode(mode: boolean): unknown;
}

/** Whether a stream is a terminal the prompt can put in raw mode. */
export const isTerminal = (stream: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: unknown }): stream is Terminal =>
  stream.isTTY === true && typeof stream.setRawMode === 'function';

const ENTER = ['\r', '\n'];
const CTRL_C = '\u0003';
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
    const cancelled = () => finish(() => reject(new CliError('general', 'Login cancelled.')));
    const onEnd = cancelled;
    function onData(chunk: string | Buffer) {
      for (const key of String(chunk)) {
        if (ENTER.includes(key)) return finish(() => resolve(typed));
        if (key === CTRL_C) return cancelled();
        typed = BACKSPACE.includes(key) ? typed.slice(0, -1) : typed + key;
      }
    }
    input.on('data', onData);
    input.on('end', onEnd);
  });
}
