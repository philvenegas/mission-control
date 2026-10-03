import { z } from 'zod';

/** Stable, documented codes. A client branches on the code, never on the message. */
export const ERROR_CODES = {
  INVALID_INPUT: 400,
  INVALID_LOGIN: 401,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  /** Whoever submitted a mission cannot approve or reject it. */
  SELF_APPROVAL_FORBIDDEN: 403,
  NOT_FOUND: 404,
  /** The mission's status does not allow the transition. */
  TRANSITION_NOT_ALLOWED: 409,
  /** A transition's guard does not hold; the message says which and why. */
  GUARD_FAILED: 409,
  /** A mission's requirements, period and details change only while it is a draft. */
  NOT_DRAFT: 409,
  /** A requirement cannot be removed, or cut below its crew, while crew are proposed for it. */
  REQUIREMENT_STAFFED: 409,
  /** A mission's crew change only while it is a draft, or to refill a slot once it is approved. */
  NOT_STAFFABLE: 409,
  /** Every slot of the requirement is already filled. */
  NO_OPEN_SLOT: 409,
  /** The crew member fails a hard constraint for the slot; nobody can assign against one. */
  HARD_CONSTRAINT_FAILED: 409,
  /** A match run applies once. */
  RUN_ALREADY_APPLIED: 409,
  /** Something the run chose no longer holds, so none of it was applied. */
  RUN_OUT_OF_DATE: 409,
  /** The run would make a clash, and applying it did not say `allow_clashes`. */
  CLASH_NOT_ALLOWED: 409,
  /** The assignment's status does not allow the change. */
  WRONG_ASSIGNMENT_STATUS: 409,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

const isErrorCode = (value: string): value is ErrorCode => Object.hasOwn(ERROR_CODES, value);

/** The one shape every error response has. `hint` is written for a person. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().refine(isErrorCode),
    message: z.string(),
    hint: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
