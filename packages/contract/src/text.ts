import { z } from 'zod';

/** Longest a name may be: a crew member's or a mission's. */
export const MAX_NAME_LENGTH = 120;

/** A name a person gives a record: trimmed, not blank, at most `MAX_NAME_LENGTH` characters. */
export const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
