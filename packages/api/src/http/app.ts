import { type HealthResponse, loginRequestSchema } from '@mission-control/contract';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';
import { login } from '../auth/login.ts';
import { can } from '../auth/policy.ts';
import { type TokenSettings, verifyToken } from '../auth/token.ts';
import type { Database } from '../db/connection.ts';
import { withTenant } from '../db/tenant.ts';
import { crewAlreadyHeld, DomainError, forbidden, internal, isBookingRuleViolation, notFound, unauthenticated } from '../errors.ts';
import { assignmentRoutes } from '../modules/assignments/routes.ts';
import { availabilityRoutes } from '../modules/availability/routes.ts';
import { crewRoutes } from '../modules/crew/routes.ts';
import { matchingRoutes } from '../modules/matching/routes.ts';
import { missionRoutes } from '../modules/missions/routes.ts';
import { orgRoutes } from '../modules/org/routes.ts';
import { skillRoutes } from '../modules/skills/routes.ts';
import { userRoutes } from '../modules/users/routes.ts';
import { describeActingUser } from '../modules/users/service.ts';
import { readBody } from './request.ts';
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

const ROUTES: Route[] = [...userRoutes, ...orgRoutes, ...skillRoutes, ...crewRoutes, ...availabilityRoutes, ...missionRoutes, ...matchingRoutes, ...assignmentRoutes];

/** Thrown inside the request's transaction to roll it back after the response has been decided. */
const ROLL_BACK = Symbol('roll back');

const render = (context: Context, error: DomainError) => context.json(error.toResponse(), error.status);

export function createApp({ db, token, extraRoutes = [], onUnexpectedError = console.error }: AppDependencies) {
  const app = new Hono<AppEnv>();
  const routes = [...ROUTES, ...extraRoutes];
  const permissions = new Map(routes.map((route) => [routeKey(route), route.permission]));

  // The one place an error becomes a response.
  app.onError((error, context) => {
    if (error instanceof DomainError) return render(context, error);
    // The database is the final arbiter of the booking rule (DESIGN.md section 3).
    if (isBookingRuleViolation(error)) return render(context, crewAlreadyHeld());
    onUnexpectedError(error);
    return render(context, internal());
  });
  app.notFound((context) => render(context, notFound('That address')));

  // Public routes: no login, no tenant.
  app.get('/v1/health', (context) => context.json<HealthResponse>({ status: 'ok' }));
  app.post('/v1/auth/login', async (context) => {
    return context.json(await login(db, await readBody(context, loginRequestSchema), token));
  });

  /**
   * The request pipeline: everything below acts as the token's user, inside one transaction
   * confined to the token's organisation. It checks, in order, that the caller is logged in, still
   * exists, and holds the permission the route declares. Any error, or any response of 400 or
   * above, rolls the transaction back.
   */
  const requestPipeline: MiddlewareHandler<AppEnv> = async (context, next) => {
    const [scheme, bearer] = (context.req.header('Authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !bearer) throw unauthenticated();
    const claims = await verifyToken(bearer, token.secret);
    try {
      await withTenant(db, claims, async (tenant) => {
        context.set('tenant', tenant);
        context.set('actingAs', await describeActingUser(tenant));

        const handlerRoute = matchedRoutes(context).find((route) => route.handler !== requestPipeline);
        if (handlerRoute) {
          const permission = permissions.get(routeKey(handlerRoute));
          if (!permission) throw new Error(`${routeKey(handlerRoute)} was registered without a permission`);
          if (!can(claims.role, permission)) throw forbidden('Your role does not allow this.');
        }

        await next();
        if (context.error || context.res.status >= 400) throw ROLL_BACK;
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
