import { expect, it } from 'vitest';
import { bootstrapDatabase } from './bootstrap.ts';

const ADMIN = 'postgres://postgres:postgres@localhost:1/postgres';

it('refuses, before connecting, when the owner and the API role are given different databases', async () => {
  await expect(
    bootstrapDatabase(ADMIN, 'postgres://mc_owner:pw@localhost:1/mission_control', 'postgres://mc_api:pw@localhost:1/elsewhere'),
  ).rejects.toThrow('name different databases: mission_control and elsewhere');
});

it('refuses, before connecting, a role name that is not a plain identifier', async () => {
  await expect(
    bootstrapDatabase(ADMIN, 'postgres://mc_owner%3B:pw@localhost:1/mission_control', 'postgres://mc_api:pw@localhost:1/mission_control'),
  ).rejects.toThrow(/not a plain identifier/);
});
