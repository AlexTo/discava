/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { handler as analyticsUpdate } from '../analytics/analytics-update.js';
import { handler as notificationDelivery } from '../notifications/delivery.js';
import { handler as progressRecalculation } from '../progress/progress-recalculation.js';
import { handler as searchIndexing } from '../search/index-content.js';

/**
 * The handler each registered feature invokes, by the registration's
 * `handler` name. A feature whose handler is missing here fails the test in
 * `handlers.test.ts`, so a registration can't name a function that doesn't
 * exist.
 */
export const HANDLERS = {
  'analytics-update': analyticsUpdate,
  'notification-delivery': notificationDelivery,
  'progress-recalculation': progressRecalculation,
  'search-indexing': searchIndexing,
} as const;
