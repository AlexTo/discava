/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SearchStreamRecord } from './search-stream.js';

// The entities the transcripts index is built from: a content item, and the
// lesson and module above it, whose visibility decides whether its passages
// are searchable. A lesson or module is never inserted with videos under it,
// so only its changes and removal count.
const TRANSCRIPT_ENTITIES = ['contentItem'] as const;
const VISIBILITY_ENTITIES = ['contentItem', 'lesson', 'module'] as const;

/**
 * Which of the core table's stream records can change what's in the
 * transcripts index: a video item's captions, version or visibility, or its lesson's or module's
 * visibility. Every
 * INSERT and MODIFY (read through its NewImage) and every REMOVE (read through
 * its OldImage, which still names the item whose passages must go).
 * ElectroDB stores each record's entity name in `__edb_e__`.
 *
 * The one definition both the deployed stream router's `transcript-indexing`
 * feature and local dev's event runner are built from, the same pattern as
 * SEARCH_STREAM_FILTERS.
 */
export const TRANSCRIPT_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: TRANSCRIPT_ENTITIES },
  { eventName: 'MODIFY', image: 'NewImage', entities: VISIBILITY_ENTITIES },
  { eventName: 'REMOVE', image: 'OldImage', entities: VISIBILITY_ENTITIES },
];

/** Whether a stream record passes TRANSCRIPT_STREAM_FILTERS. */
export const matchesTranscriptStreamFilters = (
  record: SearchStreamRecord,
): boolean =>
  TRANSCRIPT_STREAM_FILTERS.some(
    ({ eventName, image, entities }) =>
      record.eventName === eventName &&
      entities.includes(record.dynamodb?.[image]?.__edb_e__?.S ?? ''),
  );
