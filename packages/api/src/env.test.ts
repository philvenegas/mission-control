import { afterEach, expect, it } from 'vitest';
import { requireEnv } from './env.ts';

afterEach(() => {
  delete process.env.MISSION_CONTROL_TEST_SETTING;
});

it('gives a setting that is set', () => {
  process.env.MISSION_CONTROL_TEST_SETTING = 'value';
  expect(requireEnv('MISSION_CONTROL_TEST_SETTING')).toBe('value');
});

it('names a missing or empty setting and says how to create it', () => {
  expect(() => requireEnv('MISSION_CONTROL_TEST_SETTING')).toThrow(/MISSION_CONTROL_TEST_SETTING is not set.*pnpm demo:setup/);
  process.env.MISSION_CONTROL_TEST_SETTING = '';
  expect(() => requireEnv('MISSION_CONTROL_TEST_SETTING')).toThrow(/is not set/);
});
