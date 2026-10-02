import { describe, expect, it } from 'vitest';
import { createAvailabilityBlockSchema, createCrewMemberSchema, setCrewSkillSchema, updateCrewMemberSchema } from './crew.ts';

const accepts = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe('adding a crew member', () => {
  it('needs a name, and nothing else', () => {
    expect(createCrewMemberSchema.parse({ name: '  Zoe Park ' })).toEqual({ name: 'Zoe Park' });
    expect(accepts(createCrewMemberSchema, { name: ' ' })).toBe(false);
    expect(accepts(createCrewMemberSchema, { name: 'Zoe Park', ref: 'CRW-1' })).toBe(false);
  });
});

describe('changing a crew member', () => {
  it('takes a name, a status, or both', () => {
    expect(accepts(updateCrewMemberSchema, { name: 'Zoe Park' })).toBe(true);
    expect(accepts(updateCrewMemberSchema, { status: 'inactive' })).toBe(true);
    expect(accepts(updateCrewMemberSchema, { name: 'Zoe Park', status: 'active' })).toBe(true);
  });

  it.each([
    ['nothing to change', {}],
    ['an unknown status', { status: 'retired' }],
    ['a field that cannot be changed', { ref: 'CRW-2' }],
  ])('refuses %s', (_, update) => {
    expect(accepts(updateCrewMemberSchema, update)).toBe(false);
  });
});

describe("setting a crew member's skill", () => {
  it('takes a level from 1 to 5 and an optional certification date, which null clears', () => {
    expect(accepts(setCrewSkillSchema, { level: 1 })).toBe(true);
    expect(accepts(setCrewSkillSchema, { level: 5, certified_until: '2027-03-10' })).toBe(true);
    expect(accepts(setCrewSkillSchema, { level: 3, certified_until: null })).toBe(true);
  });

  it.each([
    ['level 0', { level: 0 }],
    ['level 6', { level: 6 }],
    ['a fractional level', { level: 3.5 }],
    ['a certification that is not a date', { level: 3, certified_until: 'soon' }],
  ])('refuses %s', (_, skill) => {
    expect(accepts(setCrewSkillSchema, skill)).toBe(false);
  });
});

describe('adding an availability block', () => {
  it('takes a period and an optional reason', () => {
    expect(accepts(createAvailabilityBlockSchema, { from: '2027-03-01', to: '2027-03-05' })).toBe(true);
    expect(accepts(createAvailabilityBlockSchema, { from: '2027-03-01', to: '2027-03-05', reason: 'Leave' })).toBe(true);
  });

  it.each([
    ['a period that runs backwards', { from: '2027-03-05', to: '2027-03-01' }],
    ['a blank reason', { from: '2027-03-01', to: '2027-03-05', reason: ' ' }],
    ['a field that is not part of a block', { from: '2027-03-01', to: '2027-03-05', crew_member: 'CRW-2' }],
  ])('refuses %s', (_, block) => {
    expect(accepts(createAvailabilityBlockSchema, block)).toBe(false);
  });
});
