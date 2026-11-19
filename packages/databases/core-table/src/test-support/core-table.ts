/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: a test helper, like the *.test.ts files
import { beforeAll } from 'vitest';
import { createCoreTableService } from '../service.js';

export type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

/**
 * The core table service, built once before the file's tests run (the config
 * sets `LOCAL_DEV`, so it resolves its table as local dev does). Call it at the
 * top of a test file and use the result like the service itself.
 */
export const useCoreTable = (): CoreTable => {
  let service: CoreTable | undefined;
  beforeAll(async () => {
    service = await createCoreTableService();
  });
  return new Proxy({} as CoreTable, {
    get: (_target, name) => Reflect.get(service!, name),
  });
};
