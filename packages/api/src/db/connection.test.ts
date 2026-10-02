import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from './connection.ts';

describe('reading a database address', () => {
  it('gives the role, password and database', () => {
    expect(parseDatabaseUrl('postgres://mc_api:s%40cret@localhost:54329/mission_control')).toEqual({
      role: 'mc_api',
      password: 's@cret',
      database: 'mission_control',
    });
  });

  it.each([
    ['a role that carries SQL', 'postgres://mc_api%3B%20DROP%20ROLE%20x:pw@localhost/mission_control'],
    ['a database that carries SQL', 'postgres://mc_api:pw@localhost/db%3B%20DROP%20DATABASE%20x'],
    ['a quoted role', 'postgres://%22mc_api%22:pw@localhost/mission_control'],
    ['an upper-case database', 'postgres://mc_api:pw@localhost/Mission'],
    ['no role', 'postgres://localhost/mission_control'],
    ['no database', 'postgres://mc_api:pw@localhost'],
  ])('refuses %s', (_, url) => {
    expect(() => parseDatabaseUrl(url)).toThrow(/not a plain identifier/);
  });
});
