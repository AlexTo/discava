/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// The entities the courses index is built from: the course's own record and
// its rating tally. No curriculum edit (module, lesson or content item) and
// no individual review can change a document, only the tally the review
// writer keeps, which is why `review` is not here.
const SEARCHABLE_ENTITIES = ['course'] as const;
const RATED_ENTITIES = ['course', 'courseRating'] as const;

/**
 * Which of the core table's stream records can change what's searchable: a
 * course's or its rating's. Every INSERT/MODIFY (the indexing Lambda reads
 * the course and its rating, and decides whether the course is still
 * published) and, for a course only, REMOVE (the doc is always deleted then,
 * since a removed course can never be published; a rating is never removed
 * on its own).
 * ElectroDB stores each record's entity name in `__edb_e__`.
 *
 * The one definition both the deployed stream router's `search-indexing`
 * feature and local dev's event runner (#137) are built from, the same
 * pattern as PROGRESS_STREAM_FILTERS.
 */
export const SEARCH_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: RATED_ENTITIES },
  { eventName: 'MODIFY', image: 'NewImage', entities: RATED_ENTITIES },
  { eventName: 'REMOVE', image: 'OldImage', entities: SEARCHABLE_ENTITIES },
];

/** A stream record, as GetRecords returns it and a Lambda receives it. */
export interface SearchStreamRecord {
  eventName?: string;
  dynamodb?: {
    NewImage?: Record<string, { S?: string } | undefined>;
    OldImage?: Record<string, { S?: string } | undefined>;
  };
}

/** Whether a stream record passes SEARCH_STREAM_FILTERS. */
export const matchesSearchStreamFilters = (
  record: SearchStreamRecord,
): boolean =>
  SEARCH_STREAM_FILTERS.some(
    ({ eventName, image, entities }) =>
      record.eventName === eventName &&
      entities.includes(record.dynamodb?.[image]?.__edb_e__?.S ?? ''),
  );
