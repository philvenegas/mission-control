import { z } from 'zod';
import { orgSettingsSchema, ROLES } from './domain.ts';

const nonBlank = z.string().trim().min(1);

export const loginRequestSchema = z.object({
  /** The organisation's slug. */
  org: nonBlank.toLowerCase(),
  email: nonBlank.toLowerCase(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

const userSchema = z.object({ email: z.string(), name: z.string(), role: z.enum(ROLES) });
const organisationSchema = z.object({ slug: z.string(), name: z.string() });

/** Who a token acts as. */
export const meResponseSchema = z.object({ user: userSchema, organisation: organisationSchema });
export type MeResponse = z.infer<typeof meResponseSchema>;

export const loginResponseSchema = meResponseSchema.extend({
  token: z.string(),
  /** When the token stops working, as an ISO timestamp. There is no refresh. */
  expires_at: z.iso.datetime(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const orgResponseSchema = organisationSchema.extend({ settings: orgSettingsSchema });
export type OrgResponse = z.infer<typeof orgResponseSchema>;

export const healthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof healthResponseSchema>;
