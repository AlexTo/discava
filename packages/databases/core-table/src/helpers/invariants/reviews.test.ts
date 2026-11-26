/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TableSnapshot } from './snapshot.js';
import { consistentTable, T, testHelpers } from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { broken, expectOnly } = testHelpers(() => table);

describe('review-shape, review-has-enrolment and course-rating-matches-reviews', () => {
  const REVIEWED = '2026-11-18T10:00:00.000Z';
  const review = (
    over: Partial<TableSnapshot['reviews'][number]> = {},
  ): TableSnapshot['reviews'][number] => ({
    courseId: 'c1',
    userId: 'student',
    rating: 4,
    reviewerName: 'Alex T.',
    status: 'visible',
    version: 1,
    ...over,
  });
  // Holds one review and the tally that counts it.
  const hold = (r = review(), tally?: Record<string, number>) => {
    table.reviews = [r];
    table.courseRatings = [
      { courseId: r.courseId, [`stars${r.rating}`]: 1, ...tally },
    ];
  };

  it('passes a consistent review and tally', () => {
    hold();
    expect(broken().invariants).toEqual([]);
  });

  it('passes the cases that are not violations', () => {
    // A review in an archived course, by a student who has since dropped.
    table.courses[0].status = 'archived';
    table.enrolments[0].status = 'dropped';
    hold();
    expect(broken().invariants).not.toContain('review-shape');
    expect(broken().invariants).not.toContain('review-has-enrolment');
    expect(broken().invariants).not.toContain('course-rating-matches-reviews');
  });

  it('passes an all-zero tally, and a removed review with a response', () => {
    table.reviews = [
      review({
        status: 'removed',
        removedAt: REVIEWED,
        removedBy: 'admin',
        removedReason: 'Spam',
        responseText: 'Thank you',
        responseAt: REVIEWED,
        responseById: 'teacher',
        responseByName: 'Teacher',
      }),
    ];
    table.courseRatings = [
      {
        courseId: 'c1',
        stars1: 0,
        stars2: 0,
        stars3: 0,
        stars4: 0,
        stars5: 0,
      },
    ];
    expect(broken().invariants).toEqual([]);
  });

  it('lets a student whose only record is a review keep every student-record rule', () => {
    table.enrolments.push({
      courseId: 'c1',
      userId: 'reviewer',
      status: 'active',
      progressPercent: 0,
      createdAt: T,
    });
    table.reviews = [review({ userId: 'reviewer' })];
    table.courseRatings = [{ courseId: 'c1', stars4: 1 }];

    // No student-records-* or activity-count violation, and the item counts
    // are unchanged by the review.
    expect(broken().invariants).toEqual([]);
  });

  it('leaves instructor-course-updated-at satisfied by a review and its rating', () => {
    hold();
    expect(broken().invariants).not.toContain('instructor-course-updated-at');
    expect(table.courses[0].updatedAt).toBe(T);
  });

  describe('review-shape', () => {
    it.each([
      ['a rating of 0', { rating: 0 }, /rating 0/],
      ['a rating of 6', { rating: 6 }, /rating 6/],
      ['a rating of 3.5', { rating: 3.5 }, /rating 3.5/],
      ['a version of 0', { version: 0 }, /version/],
      ['text over 2,000 characters', { text: 'a'.repeat(2001) }, /text/],
      ['no reviewer name', { reviewerName: '' }, /reviewerName/],
      [
        'a removal reason with no removal',
        { removedReason: 'Spam' },
        /removal/,
      ],
      [
        'a removed review with no reason',
        { status: 'removed' as const },
        /removed without/,
      ],
      [
        'a half-set response',
        { responseText: 'Thanks', responseAt: REVIEWED },
        /response/,
      ],
      [
        'a response over 1,000 characters',
        {
          responseText: 'a'.repeat(1001),
          responseAt: REVIEWED,
          responseById: 't',
          responseByName: 'T',
        },
        /responseText/,
      ],
      [
        'a visible review with removal fields',
        { removedAt: REVIEWED, removedBy: 'a', removedReason: 'Spam' },
        /visible but/,
      ],
    ])('reports %s', (_, over, message) => {
      table.reviews = [review(over as never)];
      // Keep the tally agreeing, so only the shape is wrong.
      table.courseRatings = [];
      const found = broken();
      expect(found.invariants).toContain('review-shape');
      expect(found.messages).toContainEqual(expect.stringMatching(message));
    });
  });

  describe('review-has-enrolment', () => {
    it('reports a review whose student has no enrolment', () => {
      hold(review({ userId: 'stranger' }));
      expectOnly('review-has-enrolment', /no enrolment/);
    });

    it('reports a review whose course does not exist', () => {
      table.enrolments.push({ ...table.enrolments[0], courseId: 'gone' });
      hold(review({ courseId: 'gone' }));
      const found = broken();
      expect(found.invariants).toContain('review-has-enrolment');
      expect(found.messages).toContainEqual(
        expect.stringMatching(/course does not exist/),
      );
    });
  });

  describe('course-rating-matches-reviews', () => {
    it('reports a counter one too high', () => {
      hold(review(), { stars4: 2 });
      expectOnly('course-rating-matches-reviews', /stars4 is 2, but 1/);
    });

    it('reports a counter one too low', () => {
      hold(review(), { stars4: 0 });
      expectOnly('course-rating-matches-reviews', /stars4 is 0, but 1/);
    });

    it('reports a visible review with no tally at all', () => {
      table.reviews = [review()];
      expectOnly('course-rating-matches-reviews', /stars4 is 0, but 1/);
    });

    it('reports a counter that counts a removed review', () => {
      table.reviews = [
        review({
          status: 'removed',
          removedAt: REVIEWED,
          removedBy: 'admin',
          removedReason: 'Spam',
        }),
      ];
      table.courseRatings = [{ courseId: 'c1', stars4: 1 }];
      expectOnly('course-rating-matches-reviews', /stars4 is 1, but 0/);
    });

    it('reports a tally for a course that does not exist', () => {
      table.courseRatings = [{ courseId: 'gone' }];
      expectOnly('course-rating-matches-reviews', /does not exist/);
    });

    it('holds on a table with a review and the notification it caused', () => {
      hold();
      table.users.push({ userId: 'teacher' } as never);
      table.notifications = [
        {
          userId: 'teacher',
          occurredAt: REVIEWED,
          id: 'a1b2c3d4e5f60718',
          type: 'review.received',
          title: 'New review for Course',
          link: { portal: 'instructor', path: '/my-courses/c1/reviews' },
          email: { state: 'skipped', reason: 'never' },
          createdAt: REVIEWED,
        } as never,
      ];
      table.notificationStates = [{ userId: 'teacher', unreadCount: 1 }];

      expect(broken().invariants).toEqual([]);
    });

    it('does not take a notification for a review, or its sender for a reviewer', () => {
      hold();
      table.notifications = [
        {
          userId: 'student',
          occurredAt: REVIEWED,
          id: 'a1b2c3d4e5f60718',
          type: 'review.received',
          link: { portal: 'instructor', path: '/my-courses/c1/reviews' },
          email: { state: 'skipped', reason: 'never' },
          createdAt: REVIEWED,
        } as never,
      ];
      table.notificationStates = [{ userId: 'student', unreadCount: 1 }];

      const names = broken().invariants;
      expect(names).not.toContain('review-shape');
      expect(names).not.toContain('review-has-enrolment');
      expect(names).not.toContain('course-rating-matches-reviews');
    });
  });
});
