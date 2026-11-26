/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createSubmissionFeedbackEntity } from './submission-feedback.js';

// The requests ElectroDB would send, checked without a table.

let feedback: Awaited<ReturnType<typeof createSubmissionFeedbackEntity>>;
beforeAll(async () => {
  feedback = await createSubmissionFeedbackEntity();
});

const round = {
  courseId: 'course-1',
  contentItemId: 'item-1',
  userId: 'user-1',
  feedbackId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  kind: 'returned',
  points: 8,
  pointsOutOf: 10,
  version: 1,
  givenAt: '2026-11-20T10:00:00.000Z',
  givenBy: 'instructor-1',
} as const;

describe('submissionFeedback', () => {
  it('stores a round with its submission and time in the key', () => {
    const { Item } = feedback.create(round).params() as {
      Item: Record<string, unknown>;
    };

    expect(Item).toMatchObject(round);
    expect(Item.pk).toContain('course-1');
    expect(Item.pk).toContain('item-1');
    expect(Item.pk).toContain('user-1');
    expect(Item.sk).toContain(round.givenAt.toLowerCase());
    expect(Item.sk).toContain(round.feedbackId.toLowerCase());
  });

  it.each(['resubmission_requested', 'returned', 'amended'] as const)(
    'accepts the %s kind',
    (kind) => {
      expect(() => feedback.create({ ...round, kind }).params()).not.toThrow();
    },
  );

  it('refuses another kind', () => {
    expect(() =>
      feedback.create({ ...round, kind: 'graded' } as never).params(),
    ).toThrow();
  });

  it.each(['feedbackId', 'kind', 'version', 'givenAt', 'givenBy'])(
    'is refused without its %s',
    (field) => {
      const { [field as keyof typeof round]: _, ...rest } = round;
      expect(() => feedback.create(rest as never).params()).toThrow();
    },
  );

  it('may have no feedback or points', () => {
    const { points, pointsOutOf, ...request } = round;
    expect(() =>
      feedback.create({ ...request, kind: 'resubmission_requested' }).params(),
    ).not.toThrow();
  });

  it('queries one submission newest first', () => {
    const params = feedback.query
      .primary({
        courseId: 'course-1',
        contentItemId: 'item-1',
        userId: 'user-1',
      })
      .params({ order: 'desc' }) as { ScanIndexForward: boolean };

    expect(params.ScanIndexForward).toBe(false);
  });
});
