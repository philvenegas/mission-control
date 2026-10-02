import type { OrgResponse } from '@mission-control/contract';
import type { TenantContext } from '../../db/tenant.ts';
import { notFound } from '../../errors.ts';
import { findOrganisation } from './repository.ts';

export async function describeOrganisation(context: TenantContext): Promise<OrgResponse> {
  const organisation = await findOrganisation(context);
  if (!organisation) throw notFound('The organisation');
  return organisation;
}
