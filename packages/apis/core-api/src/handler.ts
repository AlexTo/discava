/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHandler } from '@discava/common-server-utils/trpc-handler';
import { appRouter } from './router.js';

export const handler: ReturnType<typeof createHandler> =
  createHandler(appRouter);
