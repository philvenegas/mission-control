import { ERROR_CODES, type ErrorCode, type ErrorResponse } from '@mission-control/contract';

/** An error the caller caused or can act on. Thrown, never returned; one handler renders it. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.hint = hint;
  }

  get status() {
    return ERROR_CODES[this.code];
  }

  toResponse(): ErrorResponse {
    return { error: { code: this.code, message: this.message, ...(this.hint ? { hint: this.hint } : {}) } };
  }
}

export const invalidInput = (message: string) => new DomainError('INVALID_INPUT', message);

/** One answer for every way a login can fail, so it reveals neither organisations nor emails. */
export const invalidLogin = () =>
  new DomainError('INVALID_LOGIN', 'Invalid organisation, email or password.', 'Check all three and try again.');

export const unauthenticated = (message = 'You are not logged in.') =>
  new DomainError('UNAUTHENTICATED', message, 'Log in with `mctl login`.');

export const forbidden = (message: string, hint?: string) => new DomainError('FORBIDDEN', message, hint);

/** For a record that does not exist and, identically, for one the caller may not see. */
export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} was not found.`);

export const internal = () => new DomainError('INTERNAL', 'Something went wrong on the server.');
