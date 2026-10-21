/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initTRPC, TRPCError } from '@trpc/server';
import {
  createAuthPlugin,
  createCoreTablePlugin,
  createErrorPlugin,
  createLoggerPlugin,
  createMetricsPlugin,
  createTracerPlugin,
  IMiddlewareContext,
} from './middleware/index.js';

process.env.POWERTOOLS_SERVICE_NAME = 'InstructorApi';
process.env.POWERTOOLS_METRICS_NAMESPACE = 'InstructorApi';

export type Context = IMiddlewareContext;

// Never in development: without this, tRPC decides from NODE_ENV, which the
// Lambdas don't set, and sends each error's server stack trace to the caller
// in `data.stack` (#153). Errors are still logged in full, stack included.
export const t = initTRPC.context<Context>().create({ isDev: false });

export const publicProcedure = t.procedure
  .concat(createLoggerPlugin())
  .concat(createTracerPlugin())
  .concat(createMetricsPlugin())
  .concat(createAuthPlugin())
  .concat(createErrorPlugin());

/**
 * Like publicProcedure, but requires ctx.user to be set (i.e. the caller
 * presented a valid Cognito token) and a member of the `instructor` group,
 * narrowing ctx.user from optional to required for the procedures built on
 * top of it.
 */
export const protectedProcedure = publicProcedure.use(async (opts) => {
  if (!opts.ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (!opts.ctx.user.groups.includes('instructor')) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  return opts.next({
    ctx: {
      ...opts.ctx,
      user: opts.ctx.user,
    },
  });
});

/** Like protectedProcedure, additionally exposing ctx.coreTable. */
export const courseProcedure = protectedProcedure.concat(
  createCoreTablePlugin(),
);
