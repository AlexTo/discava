/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// The entities v1's search indices (courses, lessons) are built from. A
// content item change can't affect either: course and lesson visibility
// never depend on their content items (see filterEffectivelyVisible), so
// there's nothing for the indexer to recompute.
const SEARCHABLE_ENTITIES = ['course', 'module', 'lesson'] as const;

/**
 * Which of the core table's stream records can change what's searchable: a
 * course, or a curriculum edit that can change a lesson's effective
 * visibility (its own module or lesson record). Every INSERT/MODIFY (the
 * indexing Lambda decides whether the new image is still effectively
 * visible and published, same as a student-facing read) and REMOVE (the doc
 * is always deleted then, since a removed record can never be visible).
 * ElectroDB stores each record's entity name in `__edb_e__`.
 *
 * The one definition both the deployed event source mapping's filters
 * (CoreApiStack) and local dev's event runner (#137) are built from, the
 * same pattern as PROGRESS_STREAM_FILTERS.
 */
export const SEARCH_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: SEARCHABLE_ENTITIES },
  { eventName: 'MODIFY', image: 'NewImage', entities: SEARCHABLE_ENTITIES },
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
