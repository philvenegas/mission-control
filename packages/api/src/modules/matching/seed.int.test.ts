import { type MatchRun, matchRunSchema, missionSchema } from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../../test/app.ts';

// The seed is built so that the matcher gives the outcomes DESIGN.md section 10 names. This runs the
// matcher over it, as a mission lead would, and checks each one.

const { app } = useSeededApp();

let sam: Caller;

beforeAll(async () => {
  sam = await loginAs(app, 'artemis', 'sam@artemis.example');
});

const run = async (missionRef: string) => bodyOf(await sam.post(`/v1/missions/${missionRef}/match`), matchRunSchema);

const choices = (matchRun: MatchRun) =>
  matchRun.slots.map(({ slot, chosen }) => `${slot.skill} ${slot.number}: ${chosen ? chosen.crew_member.name : 'unfilled'}`);

describe('the matcher over the seed', () => {
  it('fills one of Titan Relay\'s two geologist slots, and explains the other', async () => {
    const titan = await run('MSN-6');
    expect(choices(titan)).toEqual(['geologist 1: Rosa Imani', 'geologist 2: unfilled']);
    expect(titan.slots[1]?.unfilled).toEqual({
      // Every other crew member of Artemis's twelve, counted once.
      lost_to: [
        { reason: 'no_skill', count: 9 },
        { reason: 'below_level', count: 1 },
        { reason: 'availability', count: 1 },
        { reason: 'chosen_for_another_slot', count: 1 },
      ],
      nearest_misses: [
        {
          crew_member: { ref: 'CRW-12', name: 'Tala Moreno' },
          failures: [{ constraint: 'availability', block: { ref: 'AVL-3', from: '2027-04-01', to: '2027-04-14' } }],
        },
        { crew_member: { ref: 'CRW-11', name: 'Sven Dahl' }, failures: [{ constraint: 'skill', level: 3, min_level: 4 }] },
      ],
    });
  });

  it('makes Ben the pilot and Ada the medic of Io Flyby, which filling one slot at a time would miss', async () => {
    expect(choices(await run('MSN-7'))).toEqual(['medic 1: Ada Reyes', 'pilot 1: Ben Osei']);
  });

  it('makes Ada the pilot and Quin the medic of Europa Survey, with Mina next in line', async () => {
    const { ref } = await bodyOf(await sam.post('/v1/missions', { name: 'Europa Survey', from: '2027-03-01', to: '2027-03-20' }), missionSchema);
    await sam.put(`/v1/missions/${ref}/requirements/pilot`, { min_level: 3 });
    await sam.put(`/v1/missions/${ref}/requirements/medic`, { min_level: 3 });
    const europa = await run(ref);
    expect(choices(europa)).toEqual(['medic 1: Quin Abara', 'pilot 1: Ada Reyes']);
    // Mina is the stronger medic, but her time on Lunar Gateway Resupply, ending 19 days before,
    // puts her below Quin. She is the replacement when Quin declines (responding.int.test.ts).
    const medic = europa.slots.find(({ slot }) => slot.skill === 'medic');
    const free = medic?.alternates.filter((alternate) => !alternate.chosen_for_another_slot).map(({ crew_member }) => crew_member.name);
    expect(free?.[0]).toBe('Mina Farouk');
    expect(medic?.chosen?.score.total).toBeGreaterThan(medic?.alternates.find(({ crew_member }) => crew_member.name === 'Mina Farouk')?.score ?? 1);
  });
});
