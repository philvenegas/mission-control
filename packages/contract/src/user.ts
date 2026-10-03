import { z } from 'zod';

/** A user, as a response names one: by name, and by email, which addresses them. */
export const namedUserSchema = z.object({ name: z.string(), email: z.string() });
export type NamedUser = z.infer<typeof namedUserSchema>;
