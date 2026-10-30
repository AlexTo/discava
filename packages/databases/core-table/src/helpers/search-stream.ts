/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which of the core table's stream records can change what a search shows, and
 * so reach the OpenSearch indexer: an insert, edit or removal of any of the
 * indexed content types (course, module, lesson, content item) or a user.
 * Modules have no index of their own, but a module's edit changes its lessons'
 * and content items' documents (their moduleTitle and moduleVisibility), so
 * module records reindex the whole course. The indexer's own writes go to
 * OpenSearch, not the table, so it never triggers itself. ElectroDB stores
 * each record's entity name in `__edb_e__`.
 *
 * The indexer re-reads the current record (or removes it), so it is idempotent
 * and safe to over- or under-filter; the set is kept to exactly the indexed
 * types plus modules only so the event source mapping and local dev's event
 * runner stay cheap.
 *
 * The one definition both the deployed event source mapping's filters
 * (CoreApiStack) and local dev's event runner (#137) are built from.
 */
export const SEARCH_ENTITIES = [
  'course',
  'module',
  'lesson',
  'contentItem',
  'user',
] as const;

export const SEARCH_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: SEARCH_ENTITIES },
  { eventName: 'MODIFY', image: 'NewImage', entities: SEARCH_ENTITIES },
  { eventName: 'REMOVE', image: 'OldImage', entities: SEARCH_ENTITIES },
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
