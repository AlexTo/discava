/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which of the core table's stream records change what the instructor
 * dashboard shows: enrolments, lesson progress and quiz summaries as they are
 * created or change, new item completions and quiz attempts, and the removal
 * of an enrolment or progress record. The aggregates and their markers are
 * not in the list, so the handler's own writes never trigger it.
 *
 * The one definition the `analytics-update` entry in STREAM_FEATURES (and so
 * the deployed router and local dev's event runner) is built from.
 */
export const ANALYTICS_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  {
    eventName: 'INSERT',
    image: 'NewImage',
    entities: [
      'enrolment',
      'progress',
      'quizSummary',
      'itemCompletion',
      'quizAttempt',
    ],
  },
  {
    eventName: 'MODIFY',
    image: 'NewImage',
    entities: ['enrolment', 'progress', 'quizSummary'],
  },
  {
    eventName: 'REMOVE',
    image: 'OldImage',
    entities: ['enrolment', 'progress'],
  },
];

/** A stream record, as GetRecords returns it and a Lambda receives it. */
export interface AnalyticsStreamRecord {
  eventName?: string;
  dynamodb?: {
    NewImage?: Record<string, { S?: string } | undefined>;
    OldImage?: Record<string, { S?: string } | undefined>;
  };
}

/** Whether a stream record passes ANALYTICS_STREAM_FILTERS. */
export const matchesAnalyticsStreamFilters = (
  record: AnalyticsStreamRecord,
): boolean =>
  ANALYTICS_STREAM_FILTERS.some(
    ({ eventName, image, entities }) =>
      record.eventName === eventName &&
      entities.includes(record.dynamodb?.[image]?.__edb_e__?.S ?? ''),
  );
