import type { MeResponse } from '@mission-control/contract';
import type { TenantContext } from '../../db/tenant.ts';
import { unauthenticated } from '../../errors.ts';
import { findOrganisation } from '../org/repository.ts';
import { findActingUser } from './repository.ts';

/** Who the token acts as. A token whose user has since been removed is no longer a login. */
export async function describeActingUser(context: TenantContext): Promise<MeResponse> {
  const [user, organisation] = [await findActingUser(context), await findOrganisation(context)];
  if (!user || !organisation) throw unauthenticated('Your login is not valid.');
  return { user, organisation: { slug: organisation.slug, name: organisation.name } };
}
