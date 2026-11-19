/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LOCAL_PORTAL_URLS } from '@discava/common-server-utils/local-dev';
import { startLocalServer } from '@discava/common-server-utils/trpc-local-server';
import { resolveUnsubscribeSecret } from '@discava/common-server-utils/unsubscribe-token';
import {
  createCoreTableService,
  NOTIFICATION_TYPES,
  setNotificationPreference,
} from '@discava/core-table';
import { unsubscribeMiddleware } from './local-unsubscribe.js';
import { appRouter } from './router.js';

const PORT = 2022;

// The public unsubscribe route (not tRPC), as the deployed function serves it.
const unsubscribe = unsubscribeMiddleware(async () => {
  const [secret, service] = await Promise.all([
    resolveUnsubscribeSecret(),
    createCoreTableService(),
  ]);
  return {
    secret,
    setEmailEnabled: (userId, type, enabled) =>
      setNotificationPreference(service, userId, type, enabled),
    typeInfo: (type) =>
      Object.hasOwn(NOTIFICATION_TYPES, type)
        ? NOTIFICATION_TYPES[type]
        : undefined,
  };
}, LOCAL_PORTAL_URLS.student);

startLocalServer({
  router: appRouter,
  port: PORT,
  extraMiddleware: unsubscribe,
});
