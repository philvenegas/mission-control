// How a command fails (DESIGN.md section 8): a message and a hint for a person, and an exit code a
// script can branch on.

/** Each way a command can fail, with its exit code. */
export const EXIT_CODES = {
  /** Anything else, including an API that cannot be reached. */
  general: 1,
  /** Usage or invalid input: 400 and 422. */
  usage: 2,
  /** Not logged in, or the login has expired: 401. */
  unauthenticated: 3,
  forbidden: 4,
  notFound: 5,
  /** A refused change, such as a transition whose guard does not hold: 409. */
  conflict: 6,
  /** Stopped by the user with Ctrl-C, as shells report it. */
  interrupted: 130,
} as const;

export type Failure = keyof typeof EXIT_CODES;

/** A failure the CLI reports in words and exits on. Thrown, never returned. */
export class CliError extends Error {
  readonly failure: Failure;
  readonly hint?: string;

  constructor(failure: Failure, message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.failure = failure;
    this.hint = hint;
  }

  get exitCode(): number {
    return EXIT_CODES[this.failure];
  }
}

/** What an API answer with this status means for the exit code. */
export function failureFor(status: number): Failure {
  if (status === 400 || status === 422) return 'usage';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  return 'general';
}
