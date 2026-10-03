import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CliError } from './errors.ts';
import { readHiddenLine } from './prompt.ts';

/** A terminal, as far as the prompt can tell: it echoes nothing while in raw mode. */
function fakeTerminal() {
  const rawModes: boolean[] = [];
  const input = Object.assign(new PassThrough(), { isTTY: true, rawModes, setRawMode: (mode: boolean) => rawModes.push(mode) });
  const written: string[] = [];
  return { input, output: { write: (text: string) => void written.push(text) }, written };
}

describe('the hidden password prompt', () => {
  it('asks, reads a line without echoing it, honours backspace, and puts the terminal back', async () => {
    const { input, output, written } = fakeTerminal();
    const answer = readHiddenLine(input, output, 'Password: ');
    input.write('secrex');
    input.write('\u007ft\r');
    expect(await answer).toBe('secret');
    expect(written).toEqual(['Password: ', '\n']);
    expect(input.rawModes).toEqual([true, false]);
  });

  it('gives up on Ctrl-C, Ctrl-D and the end of input, without a password, exiting as an interruption', async () => {
    const interrupted = fakeTerminal();
    const cancelled = readHiddenLine(interrupted.input, interrupted.output, 'Password: ');
    interrupted.input.write('sec\u0003');
    await expect(cancelled).rejects.toThrow(new CliError('interrupted', 'Login cancelled.'));
    await expect(cancelled).rejects.toMatchObject({ exitCode: 130 });
    expect(interrupted.input.rawModes).toEqual([true, false]);

    const quit = fakeTerminal();
    const ctrlD = readHiddenLine(quit.input, quit.output, 'Password: ');
    quit.input.write('\u0004');
    await expect(ctrlD).rejects.toThrow('Login cancelled.');

    const ended = fakeTerminal();
    const closed = readHiddenLine(ended.input, ended.output, 'Password: ');
    ended.input.end();
    await expect(closed).rejects.toThrow('Login cancelled.');
  });
});
