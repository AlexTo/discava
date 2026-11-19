/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type IdTimeCheck,
  type IdTimeProblem,
  idTimeWithin,
  uuidV7Time,
} from './uuid-v7.js';

// The pure rules of a lesson's discussion (data-model.md "Rules"): limits,
// text and id checks, and whether a question counts as unanswered. Nothing
// here reads or writes the table; the write helper and the invariants both
// call these, so they cannot disagree.

export const DISCUSSION_TITLE_MAX = 120;
export const DISCUSSION_BODY_MAX = 4000;
export const DISCUSSION_MAX_VISIBLE_REPLIES = 500;
export const DISCUSSION_MAX_REPORTERS = 20;
export const DISCUSSION_POST_ID_WINDOW_MS = 600_000;

export type DiscussionTextProblem = 'empty' | 'too-long';

export type NormalisedDiscussionText =
  | { text: string; reason?: undefined }
  | { text?: undefined; reason: DiscussionTextProblem };

/**
 * The text trimmed, or why it can't be used. Length is counted in characters
 * as written (an emoji or an accented letter is one), not in UTF-16 units.
 */
export const normaliseDiscussionText = (
  text: string,
  { min, max }: { min: number; max: number },
): NormalisedDiscussionText => {
  const trimmed = text.trim();
  const length = [...trimmed].length;
  if (length < min) {
    return { reason: 'empty' };
  }
  if (length > max) {
    return { reason: 'too-long' };
  }
  return { text: trimmed };
};

/** Milliseconds since the epoch in a UUID v7's time part, else undefined. */
export const postIdTime = (id: string): number | undefined => {
  const time = uuidV7Time(id);
  return time === undefined ? undefined : new Date(time).getTime();
};

export type PostIdProblem = IdTimeProblem;

export type PostIdCheck = IdTimeCheck;

/**
 * Whether `id` is a UUID v7 minted within 10 minutes of `now` (either side),
 * with its ISO time (the post's createdAt) when it is.
 */
export const checkPostId = (id: string, now: Date): PostIdCheck =>
  idTimeWithin(
    id,
    now,
    DISCUSSION_POST_ID_WINDOW_MS,
    DISCUSSION_POST_ID_WINDOW_MS,
  );

export type AnsweredState = 'unanswered' | 'answered' | 'not-open';

/**
 * Whether a question is waiting for an answer: only a shown question with no
 * accepted answer and no instructor reply is `unanswered`. A hidden or deleted
 * one is `not-open`.
 */
export const answeredState = ({
  state,
  acceptedPostId,
  instructorReplyCount,
}: {
  state: 'shown' | 'hidden' | 'deleted';
  acceptedPostId?: string;
  instructorReplyCount?: number;
}): AnsweredState => {
  if (state !== 'shown') {
    return 'not-open';
  }
  return acceptedPostId === undefined && (instructorReplyCount ?? 0) === 0
    ? 'unanswered'
    : 'answered';
};
