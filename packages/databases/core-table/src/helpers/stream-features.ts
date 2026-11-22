/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ANALYTICS_STREAM_FILTERS,
  matchesAnalyticsStreamFilters,
} from './analytics-stream.js';
import {
  BRAND_STREAM_FILTERS,
  matchesBrandStreamFilters,
} from './brand-stream.js';
import {
  CAPTION_TRANSLATION_STREAM_FILTERS,
  matchesCaptionTranslationStreamFilters,
} from './caption-translation-stream.js';
import {
  EARNINGS_STREAM_FILTERS,
  matchesEarningsStreamFilters,
} from './earnings-stream.js';
import {
  matchesNotificationStreamFilters,
  NOTIFICATION_STREAM_FILTERS,
} from './notification-stream.js';
import {
  matchesProgressStreamFilters,
  PROGRESS_STREAM_FILTERS,
} from './progress-stream.js';
import {
  matchesSearchStreamFilters,
  SEARCH_STREAM_FILTERS,
} from './search-stream.js';
import {
  matchesTranscriptStreamFilters,
  TRANSCRIPT_STREAM_FILTERS,
} from './transcript-stream.js';

/** Which records of the core table's stream a feature reacts to. */
export interface StreamFilter {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}

/** A stream record, as GetRecords returns it and a Lambda receives it. */
export interface StreamRecordLike {
  eventName?: string;
  dynamodb?: {
    NewImage?: Record<string, { S?: string } | undefined>;
    OldImage?: Record<string, { S?: string } | undefined>;
  };
}

export interface StreamFeature {
  /** Unique, kebab-case. Names the queue, failure queue, alarm and handler. */
  name: string;
  /** Records that pass any of these go to this feature. */
  filters: readonly StreamFilter[];
  /** The handler the feature's mapping invokes (an `events-*` function). */
  handler: string;
  batch: { maxRecords: number; windowSeconds: number };
  /** Receives before a message goes to the failure queue. */
  maxReceiveCount: number;
  /** Optional cap on concurrent handler runs. */
  maxConcurrency?: number;
}

type Matcher = (record: StreamRecordLike) => boolean;

/**
 * The features that react to the core table's stream. The one definition the
 * deployed StreamRouter and local dev's event runner both read: a new feature
 * adds an entry here, a handler and its tests, and nothing else.
 */
export const STREAM_FEATURES: readonly StreamFeature[] = [
  {
    name: 'progress-recalculation',
    filters: PROGRESS_STREAM_FILTERS,
    handler: 'progress-recalculation',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
  },
  {
    name: 'search-indexing',
    filters: SEARCH_STREAM_FILTERS,
    handler: 'search-indexing',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
    // The event source mapping's minimum.
    maxConcurrency: 2,
  },
  {
    name: 'analytics-update',
    filters: ANALYTICS_STREAM_FILTERS,
    handler: 'analytics-update',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
    // Every change of a course writes its summary item, so batches in
    // parallel conflict; a few at a time keeps that rare, and the writes
    // retry a conflict (see analytics-writes). The mapping's minimum.
    maxConcurrency: 2,
  },
  {
    name: 'notification-delivery',
    filters: NOTIFICATION_STREAM_FILTERS,
    handler: 'notification-delivery',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
  },
  {
    name: 'earnings-recording',
    filters: EARNINGS_STREAM_FILTERS,
    handler: 'earnings-recording',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
    // Sales of one course share an `earningDay` row, so batches in parallel
    // conflict (plan risk R6); a few at a time keeps that rare. The
    // mapping's minimum.
    maxConcurrency: 2,
  },
  {
    name: 'transcript-indexing',
    filters: TRANSCRIPT_STREAM_FILTERS,
    handler: 'transcript-indexing',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
    // The event source mapping's minimum. Two batches can still sync the same
    // item at once; syncItemTranscripts' re-check (step 5) makes the one that
    // finishes last write the newest state.
    maxConcurrency: 2,
  },
  {
    name: 'caption-translation',
    filters: CAPTION_TRANSLATION_STREAM_FILTERS,
    handler: 'caption-translation',
    // Small batches: a video's translation can take minutes.
    batch: { maxRecords: 5, windowSeconds: 5 },
    maxReceiveCount: 5,
    // The event source mapping's minimum.
    maxConcurrency: 2,
  },
  {
    name: 'brand-publishing',
    filters: BRAND_STREAM_FILTERS,
    handler: 'brand-publishing',
    // Each batch publishes the current record once, however many saves it holds.
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
    // The event source mapping's minimum. The handler reads the current
    // record, so two batches at once still leave the latest brand.json: the
    // one that reads last writes last.
    maxConcurrency: 2,
  },
];

// The features with their own filter module keep their own matchers, so they stay the one
// implementation of those filters; a feature registered later is matched on
// its `filters` the same way they are.
const MATCHERS: Readonly<Record<string, Matcher>> = {
  'progress-recalculation': matchesProgressStreamFilters,
  'search-indexing': matchesSearchStreamFilters,
  'analytics-update': matchesAnalyticsStreamFilters,
  'notification-delivery': matchesNotificationStreamFilters,
  'earnings-recording': matchesEarningsStreamFilters,
  'transcript-indexing': matchesTranscriptStreamFilters,
  'caption-translation': matchesCaptionTranslationStreamFilters,
  'brand-publishing': matchesBrandStreamFilters,
};

const matchesFilters = (
  filters: readonly StreamFilter[],
  record: StreamRecordLike,
): boolean =>
  filters.some(
    ({ eventName, image, entities }) =>
      record.eventName === eventName &&
      entities.includes(record.dynamodb?.[image]?.__edb_e__?.S ?? ''),
  );

/**
 * The names of the features a record is routed to: every feature with a
 * matching filter, and none when no filter matches. The only matching logic;
 * the router and the local runner both call it, so they cannot disagree.
 */
export const featuresFor = (
  record: StreamRecordLike,
  features: readonly StreamFeature[] = STREAM_FEATURES,
): readonly string[] =>
  features
    .filter((feature) =>
      (MATCHERS[feature.name] ?? ((r) => matchesFilters(feature.filters, r)))(
        record,
      ),
    )
    .map((feature) => feature.name);
