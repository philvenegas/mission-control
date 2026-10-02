import { type HealthResponse, loginRequestSchema } from '@mission-control/contract';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';
import { login } from '../auth/login.ts';
import { can } from '../auth/policy.ts';
import { type TokenSettings, verifyToken } from '../auth/token.ts';
import type { Database } from '../db/connection.ts';
import { withTenant } from '../db/tenant.ts';
import { DomainError, forbidden, internal, invalidInput, notFound, unauthenticated } from '../errors.ts';
import { orgRoutes } from '../modules/org/routes.ts';
import { userRoutes } from '../modules/users/routes.ts';
import { describeActingUser } from '../modules/users/service.ts';
import { type AppEnv, type Route, routeKey } from './route.ts';

export interface AppDependencies {
  /** A connection as the API database role. */
  db: Database;
  token: TokenSettings;
  /** Routes beyond the product's own; tests use this to probe the request pipeline. */
  extraRoutes?: Route[];
  /** Told about errors that are not the caller's doing. */
  onUnexpectedError?: (error: unknown) => void;
}

const ROUTES: Route[] = [...userRoutes, ...orgRoutes];

/** Thrown inside the request's transaction to roll it back after the response has been decided. */
const ROLL_BACK = Symbol('roll back');

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalidInput('The request body is not valid JSON.');
  }
}

const render = (c: Context, error: DomainError) => c.json(error.toResponse(), error.status);

export function createApp({ db, token, extraRoutes = [], onUnexpectedError = console.error }: AppDependencies) {
  const app = new Hono<AppEnv>();
  const routes = [...ROUTES, ...extraRoutes];
  const permissions = new Map(routes.map((route) => [routeKey(route), route.permission]));

  // The one place an error becomes a response.
  app.onError((error, c) => {
    if (error instanceof DomainError) return render(c, error);
    onUnexpectedError(error);
    return render(c, internal());
  });
  app.notFound((c) => render(c, notFound('That address')));

  // Public routes: no login, no tenant.
  app.get('/v1/health', (c) => c.json<HealthResponse>({ status: 'ok' }));
  app.post('/v1/auth/login', async (c) => {
    const request = loginRequestSchema.safeParse(await readJson(c));
    if (!request.success) throw invalidInput('A login needs an organisation, an email and a password.');
    return c.json(await login(db, request.data, token));
  });

  /**
   * The request pipeline: everything below acts as the token's user, inside one transaction
   * confined to the token's organisation. It checks, in order, that the caller is logged in, still
   * exists, and holds the permission the route declares. Any error, or any response of 400 or
   * above, rolls the transaction back.
   */
  const requestPipeline: MiddlewareHandler<AppEnv> = async (c, next) => {
    const [scheme, bearer] = (c.req.header('Authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !bearer) throw unauthenticated();
    const claims = await verifyToken(bearer, token.secret);
    try {
      await withTenant(db, claims, async (tenant) => {
        c.set('tenant', tenant);
        c.set('actingAs', await describeActingUser(tenant));

        const handlerRoute = matchedRoutes(c).find((route) => route.handler !== requestPipeline);
        if (handlerRoute) {
          const permission = permissions.get(routeKey(handlerRoute));
          if (!permission) throw new Error(`${routeKey(handlerRoute)} was registered without a permission`);
          if (!can(claims.role, permission)) throw forbidden('Your role does not allow this.');
        }

        await next();
        if (c.error || c.res.status >= 400) throw ROLL_BACK;
      });
    } catch (error) {
      if (error !== ROLL_BACK) throw error;
    }
  };
  app.use('/v1/*', requestPipeline);
  for (const route of routes) app.on(route.method, route.path, route.handler);

  return app;
}

export type App = ReturnType<typeof createApp>;
