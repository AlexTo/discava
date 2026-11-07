/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// The entities v1's search index (courses) is built from. A course's
// document depends only on its own record, so no curriculum edit (module,
// lesson or content item) can change it.
const SEARCHABLE_ENTITIES = ['course'] as const;

/**
 * Which of the core table's stream records can change what's searchable: a
 * course's. Every INSERT/MODIFY (the indexing Lambda decides whether the new
 * image is still published) and REMOVE (the doc is always deleted then,
 * since a removed course can never be published).
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
