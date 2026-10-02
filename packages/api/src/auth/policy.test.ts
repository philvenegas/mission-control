import { describe, expect, it } from 'vitest';
import { can, reaches, scopeOf } from './policy.ts';

describe('the policy, as DESIGN.md section 5 states it', () => {
  it('lets every role see who they are logged in as, and read the skill taxonomy', () => {
    for (const role of ['director', 'mission_lead', 'crew_member'] as const) {
      expect(can(role, 'me:read')).toBe(true);
      expect(scopeOf(role, 'skills:read')).toBe('all');
    }
  });

  it('lets only a director read the organisation and its settings', () => {
    expect(can('director', 'org:read')).toBe(true);
    expect(can('mission_lead', 'org:read')).toBe(false);
    expect(can('crew_member', 'org:read')).toBe(false);
  });

  it('lets directors and mission leads read all crew, and a crew member only their own record', () => {
    expect(scopeOf('director', 'crew:read')).toBe('all');
    expect(scopeOf('mission_lead', 'crew:read')).toBe('all');
    expect(scopeOf('crew_member', 'crew:read')).toBe('own');
  });

  it('lets a director manage all crew and availability, a crew member their own, and a mission lead neither', () => {
    for (const permission of ['crew:edit', 'availability:manage'] as const) {
      expect(scopeOf('director', permission)).toBe('all');
      expect(scopeOf('crew_member', permission)).toBe('own');
      expect(can('mission_lead', permission)).toBe(false);
    }
  });

  it('lets only a director add crew members or change whether they are active', () => {
    for (const permission of ['crew:create', 'crew:set-status'] as const) {
      expect(can('director', permission)).toBe(true);
      expect(can('mission_lead', permission)).toBe(false);
      expect(can('crew_member', permission)).toBe(false);
    }
  });
});

describe('reaching a record', () => {
  const ada = { role: 'crew_member' as const, userId: 'user-ada' };
  const dana = { role: 'director' as const, userId: 'user-dana' };
  const sam = { role: 'mission_lead' as const, userId: 'user-sam' };

  it('reaches every record when the scope is all, including one with no owner', () => {
    expect(reaches(dana, 'crew:edit', 'user-ada')).toBe(true);
    expect(reaches(dana, 'crew:edit', null)).toBe(true);
  });

  it('reaches only the caller\'s own record when the scope is own', () => {
    expect(reaches(ada, 'crew:edit', 'user-ada')).toBe(true);
    expect(reaches(ada, 'crew:edit', 'user-ben')).toBe(false);
    expect(reaches(ada, 'crew:edit', null)).toBe(false);
  });

  it('reaches nothing without the permission', () => {
    expect(reaches(sam, 'crew:edit', 'user-sam')).toBe(false);
  });
});
