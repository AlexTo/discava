/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IMiddlewareContext } from '@discava/common-server-utils/trpc-middleware';
import { getOpenSearchClient } from '@discava/search';
import { initTRPC } from '@trpc/server';

export type ISearchContext = {
  search?: Awaited<ReturnType<typeof getOpenSearchClient>>;
};

// Memoized across invocations on a warm Lambda, the same as
// createCoreTablePlugin: the OpenSearch client (and the endpoint it
// resolves) is already memoized in @discava/search.
let searchClientPromise: ReturnType<typeof getOpenSearchClient> | undefined;

export const createSearchPlugin = () => {
  const t = initTRPC.context<ISearchContext & IMiddlewareContext>().create();

  return t.procedure.use(async (opts) => {
    if (!searchClientPromise) {
      searchClientPromise = getOpenSearchClient();
    }

    return opts.next({
      ctx: {
        ...opts.ctx,
        search: await searchClientPromise,
      },
    });
  });
};
