/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CURRICULUM_ENTITIES } from './curriculum.js';

/**
 * Which of the core table's stream records can change a student's progress
 * or certificate, and so reach the progress recalculation: a new item
 * completion, an edit to or removal of a module, lesson or content item, a
 * quiz summary written (a pass is one of them), a graded submission, a course edit (its
 * certificate criteria) and an enrolment change (a dropped enrolment becoming
 * active again). Its own writes (progress, enrolment, certificate) are
 * discarded by the recalculation, which only acts on a re-activation, so it
 * never triggers itself. ElectroDB
 * stores each record's entity name in `__edb_e__`; a filter can't compare the
 * old and new images, so the recalculation itself checks that a curriculum
 * edit changed what students see.
 *
 * The one definition the `progress-recalculation` entry in STREAM_FEATURES
 * (and so the deployed stream router and local dev's event runner) is built
 * from.
 */
export const PROGRESS_STREAM_FILTERS: readonly {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  image: 'NewImage' | 'OldImage';
  entities: readonly string[];
}[] = [
  { eventName: 'INSERT', image: 'NewImage', entities: ['itemCompletion'] },
  { eventName: 'MODIFY', image: 'NewImage', entities: CURRICULUM_ENTITIES },
  { eventName: 'REMOVE', image: 'OldImage', entities: CURRICULUM_ENTITIES },
  { eventName: 'INSERT', image: 'NewImage', entities: ['quizSummary'] },
  {
    eventName: 'MODIFY',
    image: 'NewImage',
    entities: ['quizSummary', 'course', 'assignmentSubmission'],
  },
  // An enrolment change: only a drop followed by a re-activation matters
  // (the recalculation skips a dropped enrolment), and the recalculation
  // checks for that itself.
  { eventName: 'MODIFY', image: 'NewImage', entities: ['enrolment'] },
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
