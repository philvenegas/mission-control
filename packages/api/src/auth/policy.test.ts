import { expect, it } from 'vitest';
import { can } from './policy.ts';

it('lets every role see who they are logged in as', () => {
  expect(can('director', 'me:read')).toBe(true);
  expect(can('mission_lead', 'me:read')).toBe(true);
  expect(can('crew_member', 'me:read')).toBe(true);
});

it('lets only a director read the organisation and its settings', () => {
  expect(can('director', 'org:read')).toBe(true);
  expect(can('mission_lead', 'org:read')).toBe(false);
  expect(can('crew_member', 'org:read')).toBe(false);
});
