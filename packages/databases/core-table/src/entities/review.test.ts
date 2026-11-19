/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createAssignmentSubmissionEntity } from './assignment-submission.js';
import { createReviewEntity } from './review.js';

// The requests ElectroDB would send, checked without a table.

let review: Awaited<ReturnType<typeof createReviewEntity>>;
let submission: Awaited<ReturnType<typeof createAssignmentSubmissionEntity>>;
beforeAll(async () => {
  review = await createReviewEntity();
  submission = await createAssignmentSubmissionEntity();
});

const record = {
  courseId: 'course-1',
  userId: 'user-1',
  rating: 4,
  reviewerName: 'Alex T.',
};

describe('review', () => {
  it('is created with its defaults', () => {
    const { Item } = review.create(record).params();

    expect(Item).toMatchObject({ ...record, status: 'visible', version: 1 });
    expect(Item).toHaveProperty('createdAt');
  });

  it.each(['courseId', 'userId', 'rating', 'reviewerName'])(
    'is refused without its %s',
    (field) => {
      const { [field as keyof typeof record]: _, ...rest } = record;
      expect(() => review.create(rest as never).params()).toThrow();
    },
  );

  it.each([0, 6, 3.5, -1])('is refused with a rating of %s', (rating) => {
    expect(() => review.create({ ...record, rating }).params()).toThrow();
  });

  it.each([1, 2, 3, 4, 5])('takes a rating of %s', (rating) => {
    expect(() => review.create({ ...record, rating }).params()).not.toThrow();
  });

  it('takes 2,000 characters of text and refuses more', () => {
    expect(() =>
      review.create({ ...record, text: 'a'.repeat(2000) }).params(),
    ).not.toThrow();
    expect(() =>
      review.create({ ...record, text: 'a'.repeat(2001) }).params(),
    ).toThrow();
  });

  it('refuses a removal reason over 200 characters', () => {
    expect(() =>
      review
        .patch({ courseId: 'c', userId: 'u' })
        .set({ removedReason: 'a'.repeat(201) })
        .params(),
    ).toThrow();
  });

  it('refuses a response of 0 or over 1,000 characters', () => {
    const patch = (responseText: string) =>
      review.patch({ courseId: 'c', userId: 'u' }).set({ responseText });
    expect(() => patch('').params()).toThrow();
    expect(() => patch('a'.repeat(1001)).params()).toThrow();
    expect(() => patch('Thank you').params()).not.toThrow();
  });

  it('refuses a change to the reviewer name', () => {
    expect(() =>
      review
        .patch({ courseId: 'c', userId: 'u' })
        .set({ reviewerName: 'Someone Else' } as never)
        .params(),
    ).toThrow();
  });

  // Plan risk R2: byCourse shares gsi2pk-gsi2sk-index with other entities.
  it('lists a course’s reviews on gsi2pk-gsi2sk-index, apart from every submission', () => {
    const query = review.query.byCourse({ courseId: 'course-1' }).params() as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    const submissionQuery = submission.query
      .byUser({ userId: 'course-1' })
      .params() as typeof query;
    const keys = (q: typeof query) =>
      Object.values(q.ExpressionAttributeValues);

    expect(query.IndexName).toBe('gsi2pk-gsi2sk-index');
    // The partition is the same string for a user id equal to a course id, so
    // the sort key's entity name must keep the two apart.
    expect(keys(query).some((v) => v.includes('review'))).toBe(true);
    expect(keys(query).some((v) => v.includes('assignmentsubmission'))).toBe(
      false,
    );
    expect(keys(submissionQuery).some((v) => v.includes('review'))).toBe(false);
  });
});
