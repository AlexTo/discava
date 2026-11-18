/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCoreTableService } from '@discava/core-table';
import { initTRPC } from '@trpc/server';

export type ICoreTableContext = {
  coreTable?: Awaited<ReturnType<typeof createCoreTableService>>;
};

// Memoized across invocations on a warm Lambda so a request doesn't pay to
// rebuild every entity/service definition; the DynamoDB client and resolved
// table name it depends on are already memoized in @discava/core-table.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;

export const createCoreTablePlugin = () => {
  const t = initTRPC.context<ICoreTableContext>().create();

  return t.procedure.use(async (opts) => {
    if (!coreTablePromise) {
      coreTablePromise = createCoreTableService();
    }

    return opts.next({
      ctx: {
        ...opts.ctx,
        coreTable: await coreTablePromise,
      },
    });
  });
};
