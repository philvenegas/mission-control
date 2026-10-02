import { loginRequestSchema } from '@mission-control/contract';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { login } from '../auth/login.ts';
import { can, type Permission } from '../auth/policy.ts';
import { verifyToken } from '../auth/token.ts';
import type { Database } from '../db/connection.ts';
import { type TenantContext, withTenant } from '../db/tenant.ts';
import { DomainError, forbidden, internal, invalidInput, notFound, unauthenticated } from '../errors.ts';
import { describeOrganisation } from '../modules/org/service.ts';
import { describeActingUser } from '../modules/users/service.ts';

export interface AppDependencies {
  /** A connection as the API database role. */
  db: Database;
  tokenSecret: string;
  tokenTtlSeconds: number;
  /** Told about errors that are not the caller's doing. */
  onUnexpectedError?: (error: unknown) => void;
}

export type AppEnv = { Variables: { tenant: TenantContext } };
type Handler = (context: TenantContext, c: Context<AppEnv>) => Promise<object>;

/** Thrown inside the request's transaction to roll it back after the response has been decided. */
const ROLL_BACK = Symbol('roll back');

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalidInput('The request body is not valid JSON.');
  }
}

export function createApp({ db, tokenSecret, tokenTtlSeconds, onUnexpectedError = console.error }: AppDependencies) {
  const app = new Hono<AppEnv>();

  // The one place an error becomes a response.
  app.onError((error, c) => {
    if (!(error instanceof DomainError)) onUnexpectedError(error);
    const known = error instanceof DomainError ? error : internal();
    return c.json(known.toResponse(), known.status);
  });
  app.notFound((c) => {
    const error = notFound('That address');
    return c.json(error.toResponse(), error.status);
  });

  // Public routes: no login, no tenant.
  app.get('/v1/health', (c) => c.json({ status: 'ok' }));
  app.post('/v1/auth/login', async (c) => {
    const request = loginRequestSchema.safeParse(await readJson(c));
    if (!request.success) throw invalidInput('A login needs an organisation, an email and a password.');
    return c.json(await login(db, request.data, { secret: tokenSecret, ttlSeconds: tokenTtlSeconds }));
  });

  // Everything else acts as the token's user, inside one transaction confined to the token's
  // organisation. Any error, or any response of 400 or above, rolls the transaction back.
  const tenantTransaction: MiddlewareHandler<AppEnv> = async (c, next) => {
    const [scheme, token] = (c.req.header('Authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthenticated();
    const claims = await verifyToken(token, tokenSecret);
    try {
      await withTenant(db, claims, async (tenant) => {
        c.set('tenant', tenant);
        await next();
        if (c.error || c.res.status >= 400) throw ROLL_BACK;
      });
    } catch (error) {
      if (error !== ROLL_BACK) throw error;
    }
  };
  app.use('/v1/*', tenantTransaction);

  /** The one permission check. A route is registered with the permission it needs. */
  const requires =
    (permission: Permission): MiddlewareHandler<AppEnv> =>
    async (c, next) => {
      if (!can(c.var.tenant.role, permission)) throw forbidden('Your role does not allow this.');
      await next();
    };
  const get = (path: string, permission: Permission, handler: Handler) =>
    app.get(path, requires(permission), async (c) => c.json(await handler(c.var.tenant, c)));

  get('/v1/me', 'me:read', describeActingUser);
  get('/v1/org', 'org:read', describeOrganisation);

  return app;
}

export type App = ReturnType<typeof createApp>;
