/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ANALYTICS_STREAM_FILTERS,
  matchesAnalyticsStreamFilters,
} from './analytics-stream.js';
import {
  matchesProgressStreamFilters,
  PROGRESS_STREAM_FILTERS,
} from './progress-stream.js';
import {
  matchesSearchStreamFilters,
  SEARCH_STREAM_FILTERS,
} from './search-stream.js';

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
  },
];

// The features with their own filter module keep their own matchers, so they stay the one
// implementation of those filters; a feature registered later is matched on
// its `filters` the same way they are.
const MATCHERS: Readonly<Record<string, Matcher>> = {
  'progress-recalculation': matchesProgressStreamFilters,
  'search-indexing': matchesSearchStreamFilters,
  'analytics-update': matchesAnalyticsStreamFilters,
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
