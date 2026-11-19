/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ApiBase,
  createApiBase,
} from '@discava/common-server-utils/trpc-api-base';
import {
  createCoreTablePlugin,
  IMiddlewareContext,
} from '@discava/common-server-utils/trpc-middleware';

export type Context = IMiddlewareContext;

const base = createApiBase({
  serviceName: 'AdminApi',
  requiredGroup: 'admin',
});

export const t: ApiBase['t'] = base.t;
export const publicProcedure: ApiBase['publicProcedure'] = base.publicProcedure;
export const protectedProcedure: ApiBase['protectedProcedure'] =
  base.protectedProcedure;

/** Like protectedProcedure, additionally exposing ctx.coreTable. */
export const adminProcedure = protectedProcedure.concat(
  createCoreTablePlugin(),
);
