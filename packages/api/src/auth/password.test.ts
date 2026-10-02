import { expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.ts';

it('verifies the password it hashed, and no other', () => {
  const stored = hashPassword('mission-control-demo');
  expect(stored).not.toContain('mission-control-demo');
  expect(verifyPassword('mission-control-demo', stored)).toBe(true);
  expect(verifyPassword('mission-control-dem0', stored)).toBe(false);
  expect(verifyPassword('mission-control-demo', 'not-a-hash')).toBe(false);
});
