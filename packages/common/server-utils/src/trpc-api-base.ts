/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initTRPC, TRPCError } from '@trpc/server';
import {
  createAuthPlugin,
  createErrorPlugin,
  createLoggerPlugin,
  createMetricsPlugin,
  createTracerPlugin,
  IMiddlewareContext,
} from './trpc-middleware.js';

export interface ApiBaseOptions {
  /** Powertools' service name and metrics namespace, e.g. `CoreApi`. */
  serviceName: string;
  /** The Cognito group `protectedProcedure` requires; any signed-in user if unset. */
  requiredGroup?: string;
}

/**
 * The `t`, `publicProcedure` and `protectedProcedure` an API's `init.ts`
 * builds on.
 */
export const createApiBase = ({
  serviceName,
  requiredGroup,
}: ApiBaseOptions) => {
  // Set before the plugins below, as Powertools reads them when it's created.
  process.env.POWERTOOLS_SERVICE_NAME = serviceName;
  process.env.POWERTOOLS_METRICS_NAMESPACE = serviceName;

  // Never in development: without this, tRPC decides from NODE_ENV, which the
  // Lambdas don't set, and sends each error's server stack trace to the caller
  // in `data.stack` (#153). Errors are still logged in full, stack included.
  const t = initTRPC.context<IMiddlewareContext>().create({ isDev: false });

  const publicProcedure = t.procedure
    .concat(createLoggerPlugin())
    .concat(createTracerPlugin())
    .concat(createMetricsPlugin())
    .concat(createAuthPlugin())
    .concat(createErrorPlugin());

  /**
   * Like publicProcedure, but requires ctx.user to be set (i.e. the caller
   * presented a valid Cognito token), and a member of `requiredGroup` if the
   * API has one, narrowing ctx.user from optional to required for the
   * procedures built on top of it.
   */
  const protectedProcedure = publicProcedure.use(async (opts) => {
    if (!opts.ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    if (requiredGroup && !opts.ctx.user.groups.includes(requiredGroup)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    return opts.next({
      ctx: {
        ...opts.ctx,
        user: opts.ctx.user,
      },
    });
  });

  return { t, publicProcedure, protectedProcedure };
};

/**
 * What `createApiBase` returns. An API's `init.ts` annotates its exports with
 * this, as tsc can't otherwise name the types the plugins' dependencies live in.
 */
export type ApiBase = ReturnType<typeof createApiBase>;
