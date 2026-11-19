/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { startLocalServer } from '@discava/common-server-utils/trpc-local-server';
import { appRouter } from './router.js';

startLocalServer({ router: appRouter, port: 2023 });
