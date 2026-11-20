/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import {
  DISCUSSION_TITLE_MAX,
  normaliseDiscussionText,
} from './discussion-text.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];

// The rules of the first-lesson prompt (data-model.md "Rules"): the default
// text, the limit on a course's own text, the title of an answer's post, and
// the one writer of `enrolment.firstLessonPromptState`.

export const DEFAULT_FIRST_LESSON_PROMPT =
  'What do you want to be able to do with what this course teaches? Tell the class in a sentence or two.';

export const FIRST_LESSON_PROMPT_MAX = 200;

export type FirstLessonPromptState = 'answered' | 'dismissed';

/** The prompt text trimmed, or why it can't be used. */
export const normaliseFirstLessonPrompt = (text: string) =>
  normaliseDiscussionText(text, { min: 1, max: FIRST_LESSON_PROMPT_MAX });

/** The text to show for a course: its own, else the default. */
export const resolveFirstLessonPrompt = (course: {
  firstLessonPrompt?: string;
}): string => course.firstLessonPrompt ?? DEFAULT_FIRST_LESSON_PROMPT;

/**
 * The title of an answer's post: the body's first non-empty line, trimmed, cut
 * to DISCUSSION_TITLE_MAX characters with a trailing "…" when longer.
 */
export const promptAnswerTitle = (body: string): string => {
  const line =
    body
      .split(/\r\n|\r|\n/)
      .map((text) => text.trim())
      .find((text) => text !== '') ?? '';
  const characters = [...line];
  return characters.length <= DISCUSSION_TITLE_MAX
    ? line
    : `${characters.slice(0, DISCUSSION_TITLE_MAX - 1).join('')}…`;
};

/**
 * The one item that sets an enrolment's state: it applies only while the
 * enrolment exists, is not `dropped` and has no state, so the state is set
 * once and never changed.
 */
export const firstLessonPromptStateWrites = (
  { enrolment }: TransactionEntities,
  {
    courseId,
    userId,
    state,
  }: { courseId: string; userId: string; state: FirstLessonPromptState },
) =>
  enrolment
    .patch({ courseId, userId })
    .set({ firstLessonPromptState: state })
    .where(
      (attr, op) =>
        `${op.exists(attr.userId)} AND ${op.ne(attr.status, 'dropped')} AND ${op.notExists(attr.firstLessonPromptState)}`,
    )
    .commit();

// The learner has no enrolment in the course, or it has ended.
export class NotEnrolledError extends Error {
  constructor(message = 'Not enrolled in this course') {
    super(message);
    this.name = 'NotEnrolledError';
  }
}

/**
 * Closes the prompt without answering. Returns the enrolment: with the state
 * set by this call, or already set (by an answer, or an earlier dismissal),
 * which is success. Throws NotEnrolledError for a missing or `dropped`
 * enrolment.
 */
export const dismissFirstLessonPrompt = async (
  coreTable: CoreTable,
  { courseId, userId }: { courseId: string; userId: string },
) => {
  const { canceled } = await coreTable.transaction
    .write((entities) => [
      firstLessonPromptStateWrites(entities, {
        courseId,
        userId,
        state: 'dismissed',
      }),
    ])
    .go();
  const { data: enrolment } = await coreTable.entities.enrolment
    .get({ courseId, userId })
    .go();
  // A failed condition means the state was already set, or there is nobody to
  // set it for.
  if (
    !enrolment ||
    enrolment.status === 'dropped' ||
    (canceled && !enrolment.firstLessonPromptState)
  ) {
    throw new NotEnrolledError();
  }
  return enrolment;
};
