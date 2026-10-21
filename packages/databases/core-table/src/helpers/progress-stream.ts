/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CURRICULUM_ENTITIES } from './curriculum.js';

/**
 * Which of the core table's stream records can change a student's progress,
 * and so reach the progress recalculation: a new item completion, and an edit
 * to or removal of a module, lesson or content item. Its own writes (progress,
 * enrolment) match none of these, so it never triggers itself. ElectroDB
 * stores each record's entity name in `__edb_e__`; a filter can't compare the
 * old and new images, so the recalculation itself checks that a curriculum
 * edit changed what students see.
 *
 * The one definition both the deployed event source mapping's filters
 * (CoreApiStack) and local dev's event runner (#137) are built from.
 */
export const PROGRESS_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: ['itemCompletion'] },
  { eventName: 'MODIFY', image: 'NewImage', entities: CURRICULUM_ENTITIES },
  { eventName: 'REMOVE', image: 'OldImage', entities: CURRICULUM_ENTITIES },
];

/** A stream record, as GetRecords returns it and a Lambda receives it. */
export interface ProgressStreamRecord {
  eventName?: string;
  dynamodb?: {
    NewImage?: Record<string, { S?: string } | undefined>;
    OldImage?: Record<string, { S?: string } | undefined>;
  };
}

/** Whether a stream record passes PROGRESS_STREAM_FILTERS. */
export const matchesProgressStreamFilters = (
  record: ProgressStreamRecord,
): boolean =>
  PROGRESS_STREAM_FILTERS.some(
    ({ eventName, image, entities }) =>
      record.eventName === eventName &&
      entities.includes(record.dynamodb?.[image]?.__edb_e__?.S ?? ''),
  );
