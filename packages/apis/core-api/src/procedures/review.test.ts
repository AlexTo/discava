/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  deleteReview,
  editReview,
  listReviews,
  myReview,
  postReview,
  reviewSummary,
} from './review.js';

const {
  reviewGet,
  reviewQueryByCourse,
  userGet,
  courseRatingGet,
  transactionWrite,
  transactionGo,
  reviewWrites,
  reviewNotifications,
  courseGet,
  courseInstructorQueryPrimary,
  mockModule,
} = await vi.hoisted(async () => ({
  transactionGo: vi.fn(),
  reviewWrites: vi.fn(),
  reviewNotifications: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    review: ['get', 'query.byCourse'],
    user: ['get'],
    course: ['get'],
    courseInstructor: ['query.primary'],
    courseRating: ['get'],
    transaction: ['write'],
  }),
}));

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal(), { reviewWrites, reviewNotifications }),
);

const router = t.router({
  myReview,
  postReview,
  editReview,
  deleteReview,
  reviewSummary,
  listReviews,
});

const USER_SUB = 'student-1';

const callAsUser = () => callerFor(router, { sub: USER_SUB });

const callAnonymously = () => callerFor(router);

const stored = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'course-1',
  userId: USER_SUB,
  rating: 4,
  text: 'Good course',
  reviewerName: 'Alex T.',
  status: 'visible',
  version: 1,
  createdAt: '2024-01-02T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
  ...overrides,
});

const reviewRecord = (...records: (ReturnType<typeof stored> | null)[]) => {
  for (const record of records) {
    reviewGet.mockReturnValueOnce({
      go: vi.fn().mockResolvedValue({ data: record }),
    });
  }
};

// The transaction is cancelled with these reasons for its items.
const cancelled = (...codes: string[]) =>
  transactionGo.mockResolvedValue({
    canceled: true,
    data: codes.map((code) => ({ code })),
  });

const writeArg = () => reviewWrites.mock.calls[0][1];

beforeEach(() => {
  vi.resetAllMocks();
  reviewWrites.mockReturnValue('review-items');
  transactionWrite.mockImplementation((build) => ({
    items: build({}),
    go: transactionGo,
  }));
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { title: 'Intro to Rust' } }),
  });
  courseInstructorQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  reviewNotifications.mockResolvedValue([]);
  userGet.mockReturnValue({
    go: vi
      .fn()
      .mockResolvedValue({ data: { givenName: 'Alex', familyName: 'Tran' } }),
  });
});

describe('every student procedure', () => {
  it.each([
    ['myReview', (c: any) => c.myReview({ courseId: 'course-1' })],
    [
      'postReview',
      (c: any) => c.postReview({ courseId: 'course-1', rating: 5 }),
    ],
    [
      'editReview',
      (c: any) => c.editReview({ courseId: 'course-1', rating: 5, version: 1 }),
    ],
    [
      'deleteReview',
      (c: any) => c.deleteReview({ courseId: 'course-1', version: 1 }),
    ],
  ])('%s rejects unauthenticated callers', async (_name, call) => {
    await expect(call(callAnonymously())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('myReview', () => {
  it('returns null when the caller has not reviewed the course', async () => {
    reviewRecord(null);

    expect(await callAsUser().myReview({ courseId: 'course-1' })).toBeNull();
    expect(reviewGet).toHaveBeenCalledWith({
      courseId: 'course-1',
      userId: USER_SUB,
    });
  });

  it('returns the caller’s review without its userId', async () => {
    reviewRecord(
      stored({
        editedAt: '2024-01-03T00:00:00.000Z',
        responseText: 'Thanks!',
        responseAt: '2024-01-04T00:00:00.000Z',
        responseById: 'instructor-1',
        responseByName: 'Sam I.',
      }),
    );

    expect(await callAsUser().myReview({ courseId: 'course-1' })).toEqual({
      rating: 4,
      text: 'Good course',
      createdAt: '2024-01-02T00:00:00.000Z',
      editedAt: '2024-01-03T00:00:00.000Z',
      version: 1,
      status: 'visible',
      response: {
        text: 'Thanks!',
        byName: 'Sam I.',
        at: '2024-01-04T00:00:00.000Z',
      },
    });
  });

  it('returns a removed review with its status and reason', async () => {
    reviewRecord(
      stored({
        status: 'removed',
        removedAt: '2024-01-05T00:00:00.000Z',
        removedBy: 'admin-1',
        removedReason: 'Abusive language',
      }),
    );

    const result = await callAsUser().myReview({ courseId: 'course-1' });

    expect(result).toMatchObject({
      status: 'removed',
      removedReason: 'Abusive language',
    });
    expect(result).not.toHaveProperty('removedBy');
  });
});

describe('postReview', () => {
  it('writes the review for the caller with the name from their user record', async () => {
    reviewRecord(stored());

    const result = await callAsUser().postReview({
      courseId: 'course-1',
      rating: 4,
      text: '  Good course  ',
    });

    expect(userGet).toHaveBeenCalledWith({ userId: USER_SUB });
    expect(transactionWrite.mock.results[0].value.items).toBe('review-items');
    expect(writeArg()).toMatchObject({
      action: 'post',
      courseId: 'course-1',
      userId: USER_SUB,
      reviewerName: 'Alex T.',
      rating: 4,
      text: 'Good course',
    });
    expect(writeArg().at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(result).toMatchObject({ rating: 4, version: 1, status: 'visible' });
  });

  it('passes whitespace-only text on as absent', async () => {
    reviewRecord(stored({ text: undefined }));

    const result = await callAsUser().postReview({
      courseId: 'course-1',
      rating: 5,
      text: '   \n ',
    });

    expect(writeArg().text).toBeUndefined();
    expect(result.text).toBeUndefined();
  });

  it('names the caller "Discava learner" when they have no user record', async () => {
    userGet.mockReturnValue({ go: vi.fn().mockResolvedValue({ data: null }) });
    reviewRecord(stored());

    await callAsUser().postReview({ courseId: 'course-1', rating: 4 });

    expect(writeArg().reviewerName).toBe('Discava learner');
  });

  it.each([0, 6, 3.5])('refuses a rating of %s', async (rating) => {
    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses text over 2,000 characters', async () => {
    await expect(
      callAsUser().postReview({
        courseId: 'course-1',
        rating: 4,
        text: 'x'.repeat(2001),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('answers CONFLICT when the caller already reviewed the course', async () => {
    cancelled('ConditionalCheckFailed', 'None', 'None', 'None');
    reviewRecord(stored());

    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating: 4 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'You already reviewed this course',
    });
  });

  it('says so when the review that is in the way was removed', async () => {
    cancelled('ConditionalCheckFailed', 'None', 'None', 'None');
    reviewRecord(stored({ status: 'removed' }));

    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating: 4 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Your review of this course was removed',
    });
  });

  it('answers FORBIDDEN when the caller is not enrolled', async () => {
    cancelled('None', 'ConditionalCheckFailed', 'None', 'None');

    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating: 4 }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Enrol in the course to review it',
    });
  });

  it('answers PRECONDITION_FAILED for a course that is a draft or archived', async () => {
    cancelled('None', 'None', 'ConditionalCheckFailed', 'None');

    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating: 4 }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This course is not open for new reviews',
    });
  });

  it('answers CONFLICT, asking for a retry, when another transaction held the records', async () => {
    cancelled('TransactionConflict', 'None', 'None', 'TransactionConflict');

    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating: 4 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('answers INTERNAL_SERVER_ERROR when nothing explains the cancellation', async () => {
    cancelled('None', 'None', 'None', 'None');

    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating: 4 }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});

describe('postReview notifications', () => {
  const instructors = (...ids: string[]) =>
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: ids.map((instructorId) => ({ instructorId })),
      }),
    });

  it('tells every instructor of the course, with the course title and rating', async () => {
    instructors('teacher-1', 'teacher-2');
    reviewNotifications.mockResolvedValue(['notice-items']);
    reviewRecord(stored());

    await callAsUser().postReview({ courseId: 'course-1', rating: 4 });

    expect(courseInstructorQueryPrimary).toHaveBeenCalledWith({
      courseId: 'course-1',
    });
    expect(reviewNotifications).toHaveBeenCalledWith(expect.anything(), {
      courseId: 'course-1',
      courseTitle: 'Intro to Rust',
      studentId: USER_SUB,
      rating: 4,
      createdAt: writeArg().at,
      instructorIds: ['teacher-1', 'teacher-2'],
    });
    expect(writeArg().notifications).toEqual(['notice-items']);
  });

  it('posts without notification items for a course with no instructor record', async () => {
    reviewRecord(stored());

    await callAsUser().postReview({ courseId: 'course-1', rating: 4 });

    expect(reviewNotifications).not.toHaveBeenCalled();
    expect(writeArg().notifications).toEqual([]);
  });

  it('answers CONFLICT, not a second notice, when a retried post commits twice', async () => {
    instructors('teacher-1');
    reviewNotifications.mockResolvedValue(['notice-items']);
    cancelled('ConditionalCheckFailed', 'None', 'None', 'None', 'None');
    reviewRecord(stored());

    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating: 4 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transactionGo).toHaveBeenCalledTimes(1);
  });

  it('posts the review without notices when only the notices cancelled the transaction', async () => {
    instructors('teacher-1');
    reviewNotifications.mockResolvedValue(['notice-items']);
    transactionGo
      .mockResolvedValueOnce({
        canceled: true,
        data: ['None', 'None', 'None', 'None', 'ConditionalCheckFailed'].map(
          (code) => ({ code }),
        ),
      })
      .mockResolvedValueOnce({ canceled: false, data: [] });
    reviewRecord(stored());

    const result = await callAsUser().postReview({
      courseId: 'course-1',
      rating: 4,
    });

    expect(result).toMatchObject({ rating: 4 });
    expect(reviewWrites.mock.calls[0][1].notifications).toEqual([
      'notice-items',
    ]);
    expect(reviewWrites.mock.calls[1][1].notifications).toBeUndefined();
  });

  it('posts the review without notices when a notice item was held by another transaction', async () => {
    instructors('teacher-1');
    reviewNotifications.mockResolvedValue(['notice-items']);
    transactionGo
      .mockResolvedValueOnce({
        canceled: true,
        data: ['None', 'None', 'None', 'None', 'TransactionConflict'].map(
          (code) => ({ code }),
        ),
      })
      .mockResolvedValueOnce({ canceled: false, data: [] });
    reviewRecord(stored());

    const result = await callAsUser().postReview({
      courseId: 'course-1',
      rating: 4,
    });

    expect(result).toMatchObject({ rating: 4 });
    expect(transactionGo).toHaveBeenCalledTimes(2);
    expect(reviewWrites.mock.calls[1][1].notifications).toBeUndefined();
  });

  it('still answers CONFLICT when the retry without notices is held too', async () => {
    instructors('teacher-1');
    reviewNotifications.mockResolvedValue(['notice-items']);
    cancelled('TransactionConflict', 'None', 'None', 'TransactionConflict');

    await expect(
      callAsUser().postReview({ courseId: 'course-1', rating: 4 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transactionGo).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['an edit', 'editReview', { courseId: 'course-1', rating: 5, version: 1 }],
    ['a delete', 'deleteReview', { courseId: 'course-1', version: 1 }],
  ])('%s reads no instructors and adds no notices', async (_, name, input) => {
    reviewRecord(stored(), stored({ rating: 5, version: 2 }));

    await (callAsUser() as any)[name](input);

    expect(courseInstructorQueryPrimary).not.toHaveBeenCalled();
    expect(reviewNotifications).not.toHaveBeenCalled();
    expect(writeArg().notifications).toBeUndefined();
  });
});

describe('editReview', () => {
  it('writes the change against the version and rating it read', async () => {
    reviewRecord(stored(), stored({ rating: 5, version: 2, editedAt: 'now' }));

    const result = await callAsUser().editReview({
      courseId: 'course-1',
      rating: 5,
      text: ' Great ',
      version: 1,
    });

    expect(writeArg()).toMatchObject({
      action: 'edit',
      courseId: 'course-1',
      userId: USER_SUB,
      rating: 5,
      text: 'Great',
      existing: { version: 1, rating: 4 },
    });
    expect(result).toMatchObject({ rating: 5, version: 2 });
  });

  it('stores whitespace-only text as absent', async () => {
    reviewRecord(stored(), stored({ text: undefined, version: 2 }));

    await callAsUser().editReview({
      courseId: 'course-1',
      rating: 4,
      text: '  ',
      version: 1,
    });

    expect(writeArg().text).toBeUndefined();
  });

  it('answers NOT_FOUND when the caller has no review', async () => {
    reviewRecord(null);

    await expect(
      callAsUser().editReview({ courseId: 'course-1', rating: 4, version: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('answers FORBIDDEN for a removed review', async () => {
    reviewRecord(stored({ status: 'removed' }));

    await expect(
      callAsUser().editReview({ courseId: 'course-1', rating: 4, version: 1 }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'This review was removed',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('answers CONFLICT for a version older than the review’s, without writing', async () => {
    reviewRecord(stored({ version: 3 }));

    await expect(
      callAsUser().editReview({ courseId: 'course-1', rating: 4, version: 2 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Your review changed; reload it',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('answers CONFLICT when the review changes between the read and the write', async () => {
    cancelled('ConditionalCheckFailed');
    reviewRecord(stored(), stored({ version: 2 }));

    await expect(
      callAsUser().editReview({ courseId: 'course-1', rating: 4, version: 1 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Your review changed; reload it',
    });
  });

  it('answers FORBIDDEN when the review is removed between the read and the write', async () => {
    cancelled('ConditionalCheckFailed');
    reviewRecord(stored(), stored({ status: 'removed' }));

    await expect(
      callAsUser().editReview({ courseId: 'course-1', rating: 4, version: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers NOT_FOUND when the review is deleted between the read and the write', async () => {
    cancelled('ConditionalCheckFailed');
    reviewRecord(stored(), null);

    await expect(
      callAsUser().editReview({ courseId: 'course-1', rating: 4, version: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never looks at the course, so an archived course can be edited', async () => {
    reviewRecord(stored(), stored({ version: 2 }));

    await expect(
      callAsUser().editReview({ courseId: 'archived', rating: 4, version: 1 }),
    ).resolves.toMatchObject({ version: 2 });
  });
});

describe('deleteReview', () => {
  it('deletes the version it read', async () => {
    reviewRecord(stored());

    expect(
      await callAsUser().deleteReview({ courseId: 'course-1', version: 1 }),
    ).toEqual({ deleted: true });
    expect(writeArg()).toMatchObject({
      action: 'delete',
      courseId: 'course-1',
      userId: USER_SUB,
      existing: { version: 1, rating: 4 },
    });
  });

  it('answers NOT_FOUND when the caller has no review', async () => {
    reviewRecord(null);

    await expect(
      callAsUser().deleteReview({ courseId: 'course-1', version: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers FORBIDDEN for a removed review', async () => {
    reviewRecord(stored({ status: 'removed' }));

    await expect(
      callAsUser().deleteReview({ courseId: 'course-1', version: 1 }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'This review was removed',
    });
  });

  it('answers CONFLICT for a stale version', async () => {
    reviewRecord(stored({ version: 2 }));

    await expect(
      callAsUser().deleteReview({ courseId: 'course-1', version: 1 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Your review changed; reload it',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('answers CONFLICT when the review changes between the read and the write', async () => {
    cancelled('ConditionalCheckFailed', 'None');
    reviewRecord(stored(), stored({ version: 2 }));

    await expect(
      callAsUser().deleteReview({ courseId: 'course-1', version: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('the caller is the only student', () => {
  // Whatever the input says, the only user key is the caller's `sub`.
  it('ignores a userId in the input of every procedure', async () => {
    const other = { userId: 'student-2' };
    reviewRecord(stored(), stored(), stored(), stored(), stored(), stored());

    await callAsUser().myReview({ courseId: 'course-1', ...other } as any);
    await callAsUser().postReview({
      courseId: 'course-1',
      rating: 4,
      ...other,
    } as any);
    await callAsUser().editReview({
      courseId: 'course-1',
      rating: 4,
      version: 1,
      ...other,
    } as any);
    await callAsUser().deleteReview({
      courseId: 'course-1',
      version: 1,
      ...other,
    } as any);

    for (const [key] of reviewGet.mock.calls) {
      expect(key.userId).toBe(USER_SUB);
    }
    expect(userGet).toHaveBeenCalledWith({ userId: USER_SUB });
    for (const [, write] of reviewWrites.mock.calls) {
      expect(write.userId).toBe(USER_SUB);
    }
  });
});

describe('reviewSummary', () => {
  const summary = (data: unknown) =>
    courseRatingGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data }),
    });

  it('allows unauthenticated callers, with one keyed get', async () => {
    summary(null);

    await callAnonymously().reviewSummary({ courseId: 'course-1' });

    expect(courseRatingGet).toHaveBeenCalledTimes(1);
    expect(courseRatingGet).toHaveBeenCalledWith({ courseId: 'course-1' });
  });

  it('is empty for a course with no tally', async () => {
    summary(null);

    const result = await callAnonymously().reviewSummary({
      courseId: 'course-1',
    });

    expect(result).toEqual({
      count: 0,
      stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
    expect(result.average).toBeUndefined();
  });

  it('counts the stars, reading an absent counter as 0', async () => {
    summary({ courseId: 'course-1', stars5: 2, stars4: 1 });

    expect(
      await callAnonymously().reviewSummary({ courseId: 'course-1' }),
    ).toEqual({
      count: 3,
      average: 4.7,
      stars: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 },
    });
  });

  it.each([
    [{ stars1: 1, stars2: 1 }, 1.5],
    [{ stars1: 1, stars2: 2 }, 1.7],
    [{ stars5: 1, stars4: 2 }, 4.3],
    [{ stars3: 1, stars4: 1 }, 3.5],
    [{ stars5: 200, stars4: 1 }, 5],
  ])('rounds %j to one decimal: %s', async (tally, average) => {
    summary({ courseId: 'course-1', ...tally });

    expect(
      (await callAnonymously().reviewSummary({ courseId: 'course-1' })).average,
    ).toBe(average);
  });
});

describe('listReviews', () => {
  const page = (data: unknown[], cursor: string | null) => ({
    go: vi.fn().mockResolvedValue({ data, cursor }),
  });
  const at = (n: number, overrides: Record<string, unknown> = {}) =>
    stored({
      userId: `student-${n}`,
      reviewerName: `Student ${n}.`,
      text: `Review ${n}`,
      createdAt: `2024-01-${String(10 - n).padStart(2, '0')}T00:00:00.000Z`,
      ...overrides,
    });

  it('allows unauthenticated callers and lists newest first, 10 by default', async () => {
    reviewQueryByCourse.mockReturnValue(page([], null));

    const result = await callAnonymously().listReviews({
      courseId: 'course-1',
    });

    expect(result).toEqual({ items: [], cursor: null });
    expect(reviewQueryByCourse).toHaveBeenCalledWith({ courseId: 'course-1' });
    expect(reviewQueryByCourse.mock.results[0].value.go).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      order: 'desc',
    });
  });

  it('refuses a limit over 20', async () => {
    await expect(
      callAnonymously().listReviews({ courseId: 'course-1', limit: 21 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('returns exactly the public keys, however much is stored', async () => {
    reviewQueryByCourse.mockReturnValue(
      page(
        [
          at(1, {
            editedAt: '2024-01-12T00:00:00.000Z',
            removedReason: 'left over',
            responseText: 'Thanks',
            responseAt: '2024-01-13T00:00:00.000Z',
            responseById: 'instructor-1',
            responseByName: 'Sam I.',
          }),
        ],
        null,
      ),
    );

    const result = await callAnonymously().listReviews({
      courseId: 'course-1',
    });

    expect(result.items).toEqual([
      {
        reviewerName: 'Student 1.',
        rating: 4,
        text: 'Review 1',
        createdAt: '2024-01-09T00:00:00.000Z',
        editedAt: '2024-01-12T00:00:00.000Z',
        response: {
          text: 'Thanks',
          byName: 'Sam I.',
          at: '2024-01-13T00:00:00.000Z',
        },
      },
    ]);
    for (const key of ['userId', 'version', 'status', 'removedReason']) {
      expect(result.items[0]).not.toHaveProperty(key);
    }
  });

  it('keeps reviews in the order of the index', async () => {
    reviewQueryByCourse.mockReturnValue(page([at(1), at(2), at(3)], 'next'));

    const result = await callAnonymously().listReviews({
      courseId: 'course-1',
      limit: 3,
    });

    expect(result.items.map((item) => item.reviewerName)).toEqual([
      'Student 1.',
      'Student 2.',
      'Student 3.',
    ]);
    expect(result.cursor).toBe('next');
  });

  it('reads on past removed reviews until the page is full, across a page boundary', async () => {
    const removed = (n: number) => at(n, { status: 'removed' });
    reviewQueryByCourse
      .mockReturnValueOnce(page([at(1), removed(2)], 'cursor-1'))
      .mockReturnValueOnce(page([removed(3)], 'cursor-2'))
      .mockReturnValueOnce(page([at(4)], 'cursor-3'));

    const result = await callAnonymously().listReviews({
      courseId: 'course-1',
      cursor: 'cursor-0',
      limit: 2,
    });

    expect(result.items.map((item) => item.reviewerName)).toEqual([
      'Student 1.',
      'Student 4.',
    ]);
    // Resumes after the last item read.
    expect(result.cursor).toBe('cursor-3');
    const calls = reviewQueryByCourse.mock.results.map(
      (r) => r.value.go.mock.calls[0][0],
    );
    expect(calls).toEqual([
      { cursor: 'cursor-0', limit: 2, order: 'desc' },
      { cursor: 'cursor-1', limit: 1, order: 'desc' },
      { cursor: 'cursor-2', limit: 1, order: 'desc' },
    ]);
  });

  it('stops when the index ends, however few were kept', async () => {
    reviewQueryByCourse
      .mockReturnValueOnce(page([at(1, { status: 'removed' })], 'cursor-1'))
      .mockReturnValueOnce(page([at(2)], null));

    const result = await callAnonymously().listReviews({
      courseId: 'course-1',
    });

    expect(result.items).toHaveLength(1);
    expect(result.cursor).toBeNull();
    expect(reviewQueryByCourse).toHaveBeenCalledTimes(2);
  });

  it('lists nothing for a course with no reviews, such as a draft', async () => {
    reviewQueryByCourse.mockReturnValue(page([], null));

    expect(
      await callAnonymously().listReviews({ courseId: 'draft-course' }),
    ).toEqual({ items: [], cursor: null });
  });
});
