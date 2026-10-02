import { z } from 'zod';

/** Stable, documented codes. A client branches on the code, never on the message. */
export const ERROR_CODES = {
  INVALID_INPUT: 400,
  INVALID_LOGIN: 401,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
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
