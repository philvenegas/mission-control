import { describe, expect, it } from 'vitest';
import { paint } from './style.ts';

describe('colour', () => {
  it('is used only when writing to a terminal, and never when NO_COLOR is set', () => {
    expect(paint({ isTTY: true }, {})('dim', 'as Sam')).toBe('\u001b[2mas Sam\u001b[22m');
    expect(paint({ isTTY: true }, {})('red', 'Error')).toBe('\u001b[31mError\u001b[39m');
    expect(paint({ isTTY: false }, {})('dim', 'as Sam')).toBe('as Sam');
    expect(paint({}, {})('green', 'ok')).toBe('ok');
    expect(paint({ isTTY: true }, { NO_COLOR: '1' })('dim', 'as Sam')).toBe('as Sam');
  });
});
