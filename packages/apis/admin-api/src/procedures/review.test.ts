/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { listAdminReviews, listReviewCourses, removeReview } from './review.js';

const {
  courseGet,
  courseByStatus,
  courseRatingGet,
  reviewGet,
  reviewByCourse,
  reviewWrites,
  transactionWrite,
} = vi.hoisted(() => ({
  courseGet: vi.fn(),
  courseByStatus: vi.fn(),
  courseRatingGet: vi.fn(),
  reviewGet: vi.fn(),
  reviewByCourse: vi.fn(),
  reviewWrites: vi.fn(),
  transactionWrite: vi.fn(),
}));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  reviewWrites,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet, query: { byStatus: courseByStatus } },
      courseRating: { get: courseRatingGet },
      review: { get: reviewGet, query: { byCourse: reviewByCourse } },
    },
    transaction: { write: transactionWrite },
  })),
}));

const router = t.router({
  courses: listReviewCourses,
  list: listAdminReviews,
  remove: removeReview,
});
const caller = t.createCallerFactory(router);

const callAs = (groups: string[] | null = ['admin']) =>
  caller({
    event: {
      requestContext: {
        authorizer: groups
          ? { claims: { sub: 'admin-1', 'cognito:groups': groups } }
          : { claims: {} },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const resolves = (data: unknown, cursor: string | null = null) => ({
  go: vi.fn().mockResolvedValue({ data, cursor }),
});

const visible = {
  courseId: 'course-1',
  userId: 'student-1',
  reviewerName: 'Sam L.',
  rating: 4,
  text: 'Clear.',
  status: 'visible',
  version: 3,
  createdAt: '2026-11-17T10:00:00.000Z',
  email: 'sam@example.com',
};
const removed = {
  ...visible,
  status: 'removed',
  removedAt: '2026-11-18T10:00:00.000Z',
  removedBy: 'admin-1',
  removedReason: 'Abusive language',
};

const written = { canceled: false, data: [] };
const cancelled = (...codes: string[]) => ({
  canceled: true,
  data: codes.map((code) => ({ code })),
});

const input = { courseId: 'course-1', reviewerId: 'student-1' };

beforeEach(() => {
  vi.clearAllMocks();
  courseGet.mockReturnValue(
    resolves({ courseId: 'course-1', status: 'published' }),
  );
  reviewWrites.mockReturnValue([]);
});

describe('every procedure', () => {
  it.each([
    ['courses', (c: ReturnType<typeof callAs>) => c.courses({})],
    [
      'list',
      (c: ReturnType<typeof callAs>) => c.list({ courseId: 'course-1' }),
    ],
    [
      'remove',
      (c: ReturnType<typeof callAs>) => c.remove({ ...input, reason: 'Spam' }),
    ],
  ])('%s refuses an instructor or a student', async (_, call) => {
    await expect(call(callAs(['instructor']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(call(callAs(['student']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses an anonymous caller', async () => {
    await expect(callAs(null).courses({})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(
      callAs(null).remove({ ...input, reason: 'Spam' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('courses', () => {
  it('lists published courses then archived, with rating counts', async () => {
    courseByStatus
      .mockReturnValueOnce(
        resolves([{ courseId: 'c2', title: 'Two', status: 'published' }]),
      )
      .mockReturnValueOnce(
        resolves([{ courseId: 'c1', title: 'One', status: 'archived' }]),
      );
    courseRatingGet.mockReturnValue(
      resolves([{ courseId: 'c2', stars4: 2, stars5: 1 }]),
    );

    const result = await callAs().courses({});

    expect(result).toEqual({
      items: [
        { courseId: 'c2', title: 'Two', status: 'published', ratingCount: 3 },
        { courseId: 'c1', title: 'One', status: 'archived', ratingCount: 0 },
      ],
    });
    expect(courseByStatus).toHaveBeenNthCalledWith(1, { status: 'published' });
    expect(courseByStatus).toHaveBeenNthCalledWith(2, { status: 'archived' });
    expect(courseRatingGet).toHaveBeenCalledTimes(1);
  });

  it('returns a cursor naming the query it stopped in', async () => {
    courseByStatus.mockReturnValueOnce(
      resolves([{ courseId: 'c2', title: 'Two' }], 'next-page'),
    );
    courseRatingGet.mockReturnValue(resolves([]));

    const result = await callAs().courses({ limit: 1 });

    expect(result.cursor).toBe('published:next-page');
    expect(courseByStatus).toHaveBeenCalledTimes(1);
  });

  it('resumes from a cursor in the archived query', async () => {
    courseByStatus.mockReturnValueOnce(resolves([]));
    courseRatingGet.mockReturnValue(resolves([]));

    await callAs().courses({ cursor: 'archived:abc' });

    expect(courseByStatus).toHaveBeenCalledWith({ status: 'archived' });
    expect(courseByStatus).toHaveBeenCalledTimes(1);
  });

  it('refuses a cursor it did not make', async () => {
    await expect(callAs().courses({ cursor: 'draft:x' })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
  });
});

describe('list', () => {
  it('shows removed reviews with their reason, and no email or version', async () => {
    reviewByCourse.mockReturnValue(
      resolves([
        {
          ...visible,
          responseText: 'Thanks',
          responseByName: 'Alice S.',
          responseAt: 'then',
        },
        removed,
      ]),
    );

    const { items } = await callAs().list({ courseId: 'course-1' });

    expect(items[0]).toMatchObject({
      reviewerId: 'student-1',
      status: 'visible',
      response: { text: 'Thanks', byName: 'Alice S.', at: 'then' },
    });
    expect(items[1]).toMatchObject({
      status: 'removed',
      removedAt: '2026-11-18T10:00:00.000Z',
      removedBy: 'admin-1',
      removedReason: 'Abusive language',
    });
    expect(JSON.stringify(items)).not.toContain('sam@example.com');
    expect(items[0]).not.toHaveProperty('version');
  });

  it('is NOT_FOUND for a draft or unknown course', async () => {
    courseGet.mockReturnValue(
      resolves({ courseId: 'course-1', status: 'draft' }),
    );
    await expect(callAs().list({ courseId: 'course-1' })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );

    courseGet.mockReturnValue(resolves(null));
    await expect(callAs().list({ courseId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('remove', () => {
  it('removes a review as the admin, with the trimmed reason', async () => {
    reviewGet
      .mockReturnValueOnce(resolves(visible))
      .mockReturnValueOnce(resolves(removed));
    transactionWrite.mockReturnValue({
      go: vi.fn().mockResolvedValue(written),
    });

    const result = await callAs().remove({ ...input, reason: '  Spam  ' });

    expect(reviewWrites).not.toHaveBeenCalled();
    const build = transactionWrite.mock.calls[0]![0];
    build({});
    expect(reviewWrites).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'remove',
        courseId: 'course-1',
        userId: 'student-1',
        removedBy: 'admin-1',
        reason: 'Spam',
        existing: { version: 3, rating: 4 },
      }),
    );
    expect(result).toMatchObject({ status: 'removed', removedBy: 'admin-1' });
  });

  it.each(['', '   ', 'x'.repeat(201)])(
    'refuses a reason of %s characters',
    async (reason) => {
      await expect(callAs().remove({ ...input, reason })).rejects.toMatchObject(
        { code: 'BAD_REQUEST' },
      );
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  it('accepts a reason of 200 characters', async () => {
    reviewGet
      .mockReturnValueOnce(resolves(visible))
      .mockReturnValueOnce(resolves(removed));
    transactionWrite.mockReturnValue({
      go: vi.fn().mockResolvedValue(written),
    });

    await expect(
      callAs().remove({ ...input, reason: 'x'.repeat(200) }),
    ).resolves.toBeDefined();
  });

  it('changes nothing when the review is already removed', async () => {
    reviewGet.mockReturnValue(resolves(removed));

    const result = await callAs().remove({ ...input, reason: 'Again' });

    expect(transactionWrite).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'removed',
      removedReason: 'Abusive language',
    });
  });

  it('is NOT_FOUND for a missing review or a draft course', async () => {
    reviewGet.mockReturnValue(resolves(null));
    await expect(
      callAs().remove({ ...input, reason: 'Spam' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    courseGet.mockReturnValue(
      resolves({ courseId: 'course-1', status: 'draft' }),
    );
    await expect(
      callAs().remove({ ...input, reason: 'Spam' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('reads again and retries once after a stale version', async () => {
    const edited = { ...visible, rating: 2, version: 4 };
    reviewGet
      .mockReturnValueOnce(resolves(visible))
      .mockReturnValueOnce(resolves(edited))
      .mockReturnValueOnce(resolves({ ...edited, ...removed, rating: 2 }));
    transactionWrite
      .mockReturnValueOnce({
        go: vi
          .fn()
          .mockResolvedValue(cancelled('ConditionalCheckFailed', 'None')),
      })
      .mockReturnValueOnce({ go: vi.fn().mockResolvedValue(written) });

    const result = await callAs().remove({ ...input, reason: 'Spam' });

    expect(transactionWrite).toHaveBeenCalledTimes(2);
    transactionWrite.mock.calls[1]![0]({});
    expect(reviewWrites).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({ existing: { version: 4, rating: 2 } }),
    );
    expect(result).toMatchObject({ status: 'removed', rating: 2 });
  });

  it('returns the review when a racing admin removed it first', async () => {
    reviewGet
      .mockReturnValueOnce(resolves(visible))
      .mockReturnValueOnce(resolves(removed));
    transactionWrite.mockReturnValue({
      go: vi
        .fn()
        .mockResolvedValue(cancelled('ConditionalCheckFailed', 'None')),
    });

    const result = await callAs().remove({ ...input, reason: 'Spam' });

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'removed' });
  });

  it('gives up with CONFLICT after a second stale version', async () => {
    reviewGet.mockReturnValue(resolves(visible));
    transactionWrite.mockReturnValue({
      go: vi
        .fn()
        .mockResolvedValue(cancelled('ConditionalCheckFailed', 'None')),
    });

    await expect(
      callAs().remove({ ...input, reason: 'Spam' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transactionWrite).toHaveBeenCalledTimes(2);
  });
});
