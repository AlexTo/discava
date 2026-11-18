/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { REVIEW_RESPONSE_MAX, REVIEW_TEXT_MAX } from '../entities/review.js';
import type { createCoreTableService } from '../service.js';
import { starField } from './review-rating.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];

const FALLBACK_NAME = 'Discava learner';

/**
 * How a review's author is shown: the given name and the first letter of the
 * family name with a full stop ("Alex T."), the given name alone, or
 * "Discava learner". Never the email.
 */
export const reviewerName = (
  user:
    | { givenName?: string | null; familyName?: string | null }
    | null
    | undefined,
): string => {
  const given = user?.givenName?.trim();
  const initial = Array.from(user?.familyName?.trim() ?? '')[0];
  if (given) {
    return initial ? `${given} ${initial.toLocaleUpperCase()}.` : given;
  }
  return initial ? `${initial.toLocaleUpperCase()}.` : FALLBACK_NAME;
};

// A student's review of a course: a rating, and optionally some text. Every
// writer builds its transaction from reviewWrites, so the rules that span
// records are kept in one place:
// - a course's courseRating tally counts exactly its visible reviews: every
//   write that adds, moves or removes one changes the tally in the same
//   transaction;
// - DynamoDB rejects two operations on one item in a transaction, so a
//   rating change is ONE courseRating update that moves a count between two
//   counters, never a decrement and an increment;
// - a review is posted only by an enrolled (not dropped) student of a
//   published course, once; a removed review stays and blocks a new one;
// - an edit or delete only affects the version it read, while it is visible;
// - the review's times all come from the one `at` the caller passes.

interface ReviewWriteBase {
  courseId: string;
  userId: string;
  /** The time of the request: createdAt for a post, editedAt for an edit. */
  at: string;
}

export interface ReviewPost extends ReviewWriteBase {
  action: 'post';
  /** From reviewerName, read from the student's user record. */
  reviewerName: string;
  rating: number;
  text?: string;
}

export interface ReviewEdit extends ReviewWriteBase {
  action: 'edit';
  rating: number;
  text?: string;
  /** The review as read. */
  existing: { version: number; rating: number };
}

export interface ReviewDelete extends ReviewWriteBase {
  action: 'delete';
  /** The review as read. */
  existing: { version: number; rating: number };
}

/** An instructor's answer to a review; replaces any earlier answer. */
export interface ReviewRespond extends ReviewWriteBase {
  action: 'respond';
  /** `userId` is the reviewer; this is the answering instructor. */
  instructorId: string;
  /** From reviewerName, read from the instructor's user record. */
  instructorName: string;
  text: string;
}

export interface ReviewDeleteResponse extends ReviewWriteBase {
  action: 'deleteResponse';
  instructorId: string;
}

export type ReviewWrite =
  | ReviewPost
  | ReviewEdit
  | ReviewDelete
  | ReviewRespond
  | ReviewDeleteResponse;

/** Response text as stored: trimmed, 1 to REVIEW_RESPONSE_MAX characters. */
export const responseText = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new RangeError('response text is empty');
  }
  if (trimmed.length > REVIEW_RESPONSE_MAX) {
    throw new RangeError(`response is over ${REVIEW_RESPONSE_MAX} characters`);
  }
  return trimmed;
};

/** Review text as stored: trimmed, and absent when nothing is left. */
export const reviewText = (text: string | undefined): string | undefined => {
  const trimmed = text?.trim();
  if (trimmed === undefined || trimmed === '') {
    return undefined;
  }
  if (trimmed.length > REVIEW_TEXT_MAX) {
    throw new RangeError(`text is over ${REVIEW_TEXT_MAX} characters`);
  }
  return trimmed;
};

/**
 * The checks and writes of one post, edit or delete. The items are in a fixed
 * order, which classifyReviewCancellation reads: a post's are the review,
 * the enrolment, the course and the tally; an edit's and a delete's are the
 * review, then the tally when it changes. A failed condition cancels the
 * whole transaction; the caller reads again and decides.
 */
export const reviewWrites = (
  {
    review,
    courseRating,
    enrolment,
    course,
    courseInstructor,
  }: TransactionEntities,
  write: ReviewWrite,
): ReturnType<TransactionWrites> => {
  const { courseId, userId, at } = write;
  const key = { courseId, userId };

  // An answer touches neither the version nor the tally, so a student's edit
  // from the version it read still goes through. It needs the review to be
  // visible and the caller to still teach the course.
  if (write.action === 'respond' || write.action === 'deleteResponse') {
    const visible = (attr: any, op: any) => op.eq(attr.status, 'visible');
    const patch = review.patch(key);
    const answer =
      write.action === 'respond'
        ? patch.set({
            responseText: responseText(write.text),
            responseAt: at,
            responseById: write.instructorId,
            responseByName: write.instructorName,
          })
        : patch.remove([
            'responseText',
            'responseAt',
            'responseById',
            'responseByName',
          ]);
    return [
      answer.where(visible).commit(),
      courseInstructor
        .check({ courseId, instructorId: write.instructorId })
        .where((attr, op) => op.exists(attr.instructorId))
        .commit(),
    ];
  }

  if (write.action === 'post') {
    const text = reviewText(write.text);
    return [
      review
        .create({
          ...key,
          rating: write.rating,
          ...(text === undefined ? {} : { text }),
          reviewerName: write.reviewerName,
          status: 'visible',
          version: 1,
          createdAt: at,
        })
        .commit(),
      enrolment
        .check(key)
        .where(
          (attr, op) =>
            `${op.exists(attr.userId)} AND ${op.ne(attr.status, 'dropped')}`,
        )
        .commit(),
      course
        .check({ courseId })
        .where((attr, op) => op.eq(attr.status, 'published'))
        .commit(),
      courseRating
        .update({ courseId })
        .add({ [starField(write.rating)]: 1 })
        .commit(),
    ];
  }

  const { existing } = write;
  const unchanged = (attr: any, op: any) =>
    `${op.eq(attr.version, existing.version)} AND ${op.eq(attr.status, 'visible')}`;

  if (write.action === 'delete') {
    const field = starField(existing.rating);
    return [
      review.delete(key).where(unchanged).commit(),
      courseRating
        .update({ courseId })
        .add({ [field]: -1 })
        .where((attr, op) => op.gte(attr[field], 1))
        .commit(),
    ];
  }

  const text = reviewText(write.text);
  const changes = review.patch(key).set({
    rating: write.rating,
    editedAt: at,
    version: existing.version + 1,
    ...(text === undefined ? {} : { text }),
  });
  const items = [
    (text === undefined ? changes.remove(['text']) : changes)
      .where(unchanged)
      .commit(),
  ];
  if (write.rating !== existing.rating) {
    const from = starField(existing.rating);
    const to = starField(write.rating);
    items.push(
      courseRating
        .update({ courseId })
        .add({ [from]: -1, [to]: 1 })
        .where((attr, op) => op.gte(attr[from], 1))
        .commit(),
    );
  }
  return items;
};

export type ReviewCancellation =
  | 'already-reviewed'
  | 'not-enrolled'
  | 'course-closed'
  | 'stale'
  | 'not-instructor'
  | 'unavailable';

/**
 * What cancelled a review transaction, from the reason DynamoDB gave for each
 * of its items (in the order reviewWrites built them); undefined when no
 * condition failed (e.g. a TransactionConflict, which is safe to retry).
 * 'already-reviewed' covers a removed review too: the caller reads the
 * review to tell them apart.
 */
export const classifyReviewCancellation = (
  action: ReviewWrite['action'],
  reasons: ({ code?: string } | undefined)[],
): ReviewCancellation | undefined => {
  const failed = (index: number) =>
    reasons[index]?.code === 'ConditionalCheckFailed';
  if (action === 'respond' || action === 'deleteResponse') {
    // The review is missing or removed (the caller reads it to tell which),
    // or the caller no longer teaches the course.
    if (failed(1)) {
      return 'not-instructor';
    }
    return failed(0) ? 'unavailable' : undefined;
  }
  if (action === 'post') {
    if (failed(0)) {
      return 'already-reviewed';
    }
    if (failed(1)) {
      return 'not-enrolled';
    }
    if (failed(2)) {
      return 'course-closed';
    }
    return undefined;
  }
  // The review's version or status moved, or the tally has no count to move:
  // either way the caller's read is out of date.
  return failed(0) || failed(1) ? 'stale' : undefined;
};
