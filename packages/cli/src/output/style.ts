// Text for a person: in colour only for a terminal.

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
type Style = keyof typeof STYLES;

/** Styles text for a stream: in colour for a terminal, plain otherwise or when NO_COLOR is set. */
export function paint(stream: Pick<Output, 'isTTY'>, env: Record<string, string | undefined>) {
  const coloured = stream.isTTY === true && !env.NO_COLOR;
  return (style: Style, text: string) => (coloured ? `${STYLES[style][0]}${text}${STYLES[style][1]}` : text);
}
