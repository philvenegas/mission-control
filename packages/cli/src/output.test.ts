import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CliError, failureFor } from './errors.ts';
import { paint, readHiddenLine } from './output.ts';

describe('exit codes', () => {
  it('follow the API\'s answer as DESIGN.md section 8 lists them', () => {
    const codes = [400, 422, 401, 403, 404, 409, 500, 418].map((status) => new CliError(failureFor(status), '').exitCode);
    expect(codes).toEqual([2, 2, 3, 4, 5, 6, 1, 1]);
  });
});

describe('colour', () => {
  it('is used only when writing to a terminal, and never when NO_COLOR is set', () => {
    expect(paint({ isTTY: true }, {})('dim', 'as Sam')).toBe('\u001b[2mas Sam\u001b[22m');
    expect(paint({ isTTY: true }, {})('red', 'Error')).toBe('\u001b[31mError\u001b[39m');
    expect(paint({ isTTY: false }, {})('dim', 'as Sam')).toBe('as Sam');
    expect(paint({}, {})('green', 'ok')).toBe('ok');
    expect(paint({ isTTY: true }, { NO_COLOR: '1' })('dim', 'as Sam')).toBe('as Sam');
  });
});

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

  it('gives up on Ctrl-C, and on the end of input, without a password', async () => {
    const interrupted = fakeTerminal();
    const cancelled = readHiddenLine(interrupted.input, interrupted.output, 'Password: ');
    interrupted.input.write('sec\u0003');
    await expect(cancelled).rejects.toThrow(new CliError('general', 'Login cancelled.'));
    expect(interrupted.input.rawModes).toEqual([true, false]);

    const ended = fakeTerminal();
    const closed = readHiddenLine(ended.input, ended.output, 'Password: ');
    ended.input.end();
    await expect(closed).rejects.toThrow('Login cancelled.');
  });
});
