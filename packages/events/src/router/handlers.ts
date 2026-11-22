/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { handler as analyticsUpdate } from '../analytics/analytics-update.js';
import { handler as brandPublishing } from '../branding/brand-publishing.js';
import { handler as earningsRecording } from '../earnings/earnings-recording.js';
import { handler as captionTranslation } from '../media/caption-translation.js';
import { handler as notificationDelivery } from '../notifications/notification-delivery.js';
import { handler as progressRecalculation } from '../progress/progress-recalculation.js';
import { handler as searchIndexing } from '../search/search-indexing.js';
import { handler as transcriptIndexing } from '../search/transcript-indexing.js';

/**
 * The handler each registered feature invokes, by the registration's
 * `handler` name. A feature whose handler is missing here fails the test in
 * `handlers.test.ts`, so a registration can't name a function that doesn't
 * exist.
 */
export const HANDLERS = {
  'analytics-update': analyticsUpdate,
  'brand-publishing': brandPublishing,
  'caption-translation': captionTranslation,
  'earnings-recording': earningsRecording,
  'notification-delivery': notificationDelivery,
  'progress-recalculation': progressRecalculation,
  'search-indexing': searchIndexing,
  'transcript-indexing': transcriptIndexing,
} as const;
