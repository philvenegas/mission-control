import { availabilityBlockSchema, errorResponseSchema } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../../test/app.ts';

const { app } = useSeededApp();

let dana: Caller; // director
let sam: Caller; // mission lead
let ada: Caller; // crew member, CRW-1

beforeAll(async () => {
  [dana, sam, ada] = await Promise.all([
    loginAs(app, 'artemis', 'dana@artemis.example'),
    loginAs(app, 'artemis', 'sam@artemis.example'),
    loginAs(app, 'artemis', 'ada@artemis.example'),
  ]);
});

const blocks = async (caller: Caller, crewMember: string) =>
  bodyOf(await caller.get(`/v1/crew/${crewMember}/availability`), z.array(availabilityBlockSchema));
const block = async (response: Response) => bodyOf(response, availabilityBlockSchema);
const error = async (response: Response) => ({ status: response.status, ...(await bodyOf(response, errorResponseSchema)).error });
const leave = { from: '2027-08-02', to: '2027-08-16', reason: 'Leave' };

describe('reading availability', () => {
  it("lists a crew member's blocks, earliest first, to a director and a mission lead", async () => {
    const omar = [
      { ref: 'AVL-1', crew_member: 'CRW-5', from: '2027-03-05', to: '2027-03-12', reason: 'Training course' },
      { ref: 'AVL-2', crew_member: 'CRW-5', from: '2027-06-01', to: '2027-06-30', reason: 'Parental leave' },
    ];
    expect(await blocks(dana, 'CRW-5')).toEqual(omar);
    expect(await blocks(sam, 'CRW-5')).toEqual(omar);
  });

  it('lets a crew member read their own, and hides everyone else\'s', async () => {
    expect(await blocks(ada, 'me')).toEqual([]);
    expect((await ada.get('/v1/crew/CRW-5/availability')).status).toBe(404);
  });
});

describe('adding a block', () => {
  it('lets a director add one for any crew member, numbered next', async () => {
    const response = await dana.post('/v1/crew/CRW-2/availability', leave);
    expect(response.status).toBe(201);
    expect(await block(response)).toEqual({ ref: 'AVL-4', crew_member: 'CRW-2', ...leave });
  });

  it('lets a crew member add one for themselves, with or without a reason, and not for anyone else', async () => {
    expect(await block(await ada.post('/v1/crew/me/availability', { from: '2027-09-01', to: '2027-09-03' }))).toMatchObject({
      crew_member: 'CRW-1',
      reason: null,
    });
    expect((await ada.post('/v1/crew/CRW-2/availability', leave)).status).toBe(404);
  });

  it('refuses a mission lead', async () => {
    expect((await sam.post('/v1/crew/CRW-2/availability', leave)).status).toBe(403);
  });

  it('refuses a period that does not end after it starts', async () => {
    expect(await error(await dana.post('/v1/crew/CRW-2/availability', { from: '2027-08-16', to: '2027-08-02' }))).toMatchObject({
      status: 400,
      message: 'to: A period must end after it starts.',
    });
  });
});

describe('removing a block', () => {
  it('lets a director remove any block, after which it is gone', async () => {
    const { ref } = await block(await dana.post('/v1/crew/CRW-6/availability', leave));
    expect((await dana.delete(`/v1/availability/${ref}`)).status).toBe(204);
    expect(await blocks(dana, 'CRW-6')).toEqual([]);
    expect(await error(await dana.delete(`/v1/availability/${ref}`))).toMatchObject({ status: 404, message: `${ref} was not found.` });
  });

  it('lets a crew member remove their own block, and not anyone else\'s', async () => {
    const { ref } = await block(await ada.post('/v1/crew/me/availability', leave));
    expect((await ada.delete('/v1/availability/AVL-1')).status).toBe(404);
    expect((await ada.delete(`/v1/availability/${ref}`)).status).toBe(204);
    expect((await blocks(dana, 'CRW-5')).map((omar) => omar.ref)).toEqual(['AVL-1', 'AVL-2']);
  });

  it('refuses a mission lead', async () => {
    expect((await sam.delete('/v1/availability/AVL-1')).status).toBe(403);
  });
});
