import type { MeResponse } from '@mission-control/contract';
import type { TenantContext } from '../../db/tenant.ts';
import { unauthenticated } from '../../errors.ts';
import { findActingUser } from './repository.ts';

/** Who the token acts as. A token whose user has since been removed is no longer a login. */
export async function describeActingUser(context: TenantContext): Promise<MeResponse> {
  const actingUser = await findActingUser(context);
  if (!actingUser) throw unauthenticated('Your login is not valid.');
  return actingUser;
}
