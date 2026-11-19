/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  deleteReviewResponse,
  listReviews,
  respondToReview,
} from './review.js';

const {
  courseInstructorGet,
  reviewGet,
  reviewByCourse,
  userGet,
  reviewWrites,
  transactionWrite,
  transactionGo,
} = vi.hoisted(() => ({
  courseInstructorGet: vi.fn(),
  reviewGet: vi.fn(),
  reviewByCourse: vi.fn(),
  userGet: vi.fn(),
  reviewWrites: vi.fn(),
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
}));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  reviewWrites,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      courseInstructor: { get: courseInstructorGet },
      review: { get: reviewGet, query: { byCourse: reviewByCourse } },
      user: { get: userGet },
    },
    transaction: { write: transactionWrite },
  })),
}));

const router = t.router({
  list: listReviews,
  respond: respondToReview,
  deleteResponse: deleteReviewResponse,
});

const INSTRUCTOR_SUB = 'instructor-1';

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

const stored = {
  courseId: 'course-1',
  userId: 'student-1',
  reviewerName: 'Sam L.',
  rating: 4,
  text: 'Clear.',
  status: 'visible',
  version: 3,
  createdAt: '2026-11-17T10:00:00.000Z',
  editedAt: '2026-11-17T11:00:00.000Z',
  email: 'sam@example.com',
  removedBy: 'admin-1',
};
const answered = {
  ...stored,
  responseText: 'Thank you',
  responseAt: '2026-11-18T10:00:00.000Z',
  responseById: 'instructor-2',
  responseByName: 'Alice S.',
};

const cancelled = (...codes: string[]) => ({
  canceled: true,
  data: codes.map((code) => ({ code })),
});

beforeEach(() => {
  vi.resetAllMocks();
  courseInstructorGet.mockReturnValue(
    resolves({ courseId: 'course-1', instructorId: INSTRUCTOR_SUB }),
  );
  reviewGet.mockReturnValue(resolves(stored));
  userGet.mockReturnValue(
    resolves({
      userId: INSTRUCTOR_SUB,
      givenName: 'Alice',
      familyName: 'Smith',
    }),
  );
  reviewWrites.mockReturnValue(['patch', 'check']);
  transactionWrite.mockImplementation((fn) => {
    fn({});
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

const respondInput = {
  courseId: 'course-1',
  reviewerId: 'student-1',
  text: '  Thank you  ',
};
const clearInput = { courseId: 'course-1', reviewerId: 'student-1' };

describe.each([
  ['list', (c: ReturnType<typeof callAs>) => c.list({ courseId: 'course-1' })],
  ['respond', (c: ReturnType<typeof callAs>) => c.respond(respondInput)],
  [
    'deleteResponse',
    (c: ReturnType<typeof callAs>) => c.deleteResponse(clearInput),
  ],
])('%s access', (_, call) => {
  it.each([
    ['a user outside the instructor group', ['student']],
    ['a caller in no group', []],
  ])('refuses %s', async (_name, groups) => {
    await expect(call(callAs(groups))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses an instructor of a different course', async () => {
    courseInstructorGet.mockReturnValue(resolves(null));

    await expect(call(callAs())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).toHaveBeenCalledWith({
      courseId: 'course-1',
      instructorId: INSTRUCTOR_SUB,
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  const page = (data: unknown[], cursor: string | null) => ({
    go: vi.fn().mockResolvedValue({ data, cursor }),
  });

  it('returns visible reviews newest first with the reviewer ID and no email', async () => {
    const byCourse = page([answered], null);
    reviewByCourse.mockReturnValue(byCourse);

    const result = await callAs().list({ courseId: 'course-1' });

    expect(reviewByCourse).toHaveBeenCalledWith({ courseId: 'course-1' });
    expect(byCourse.go).toHaveBeenCalledWith(
      expect.objectContaining({ order: 'desc', limit: 20 }),
    );
    expect(result).toEqual({
      items: [
        {
          reviewerId: 'student-1',
          reviewerName: 'Sam L.',
          rating: 4,
          text: 'Clear.',
          createdAt: stored.createdAt,
          editedAt: stored.editedAt,
          response: {
            text: 'Thank you',
            byName: 'Alice S.',
            at: '2026-11-18T10:00:00.000Z',
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('example.com');
  });

  it('reads on past removed reviews until the page is full', async () => {
    const removed = { ...stored, userId: 'gone', status: 'removed' };
    const go = vi
      .fn()
      .mockResolvedValueOnce({ data: [removed], cursor: 'c1' })
      .mockResolvedValueOnce({ data: [stored], cursor: 'c2' });
    reviewByCourse.mockReturnValue({ go });

    const result = await callAs().list({ courseId: 'course-1', limit: 1 });

    expect(go).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'c1', limit: 1 }),
    );
    expect(result.items.map((item) => item.reviewerId)).toEqual(['student-1']);
    expect(result.cursor).toBe('c2');
  });
});

describe('respond', () => {
  it('writes the trimmed answer under the calling instructor, and returns the review', async () => {
    reviewGet
      .mockReturnValueOnce(resolves(stored))
      .mockReturnValueOnce(resolves(answered));

    const result = await callAs().respond(respondInput);

    expect(reviewWrites).toHaveBeenCalledWith(
      {},
      {
        action: 'respond',
        courseId: 'course-1',
        userId: 'student-1',
        at: expect.any(String),
        instructorId: INSTRUCTOR_SUB,
        instructorName: 'Alice S.',
        text: 'Thank you',
      },
    );
    expect(result.response?.text).toBe('Thank you');
    expect(result).not.toHaveProperty('version');
    expect(result).not.toHaveProperty('email');
  });

  it('leaves the rating, text and version out of the write', async () => {
    reviewGet.mockReturnValue(resolves(stored));

    await callAs().respond(respondInput);

    const write = reviewWrites.mock.calls[0]![1];
    for (const key of ['rating', 'version', 'existing', 'editedAt']) {
      expect(write).not.toHaveProperty(key);
    }
  });

  it("may replace another instructor's response", async () => {
    reviewGet.mockReturnValue(resolves(answered));

    await expect(callAs().respond(respondInput)).resolves.toBeDefined();
    expect(transactionWrite).toHaveBeenCalledOnce();
  });

  it.each(['', '   ', 'a'.repeat(1001)])(
    'refuses a response of %#',
    async (text) => {
      await expect(
        callAs().respond({ ...respondInput, text }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  it('answers NOT_FOUND for a missing review', async () => {
    reviewGet.mockReturnValue(resolves(null));

    await expect(callAs().respond(respondInput)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses a removed review', async () => {
    reviewGet.mockReturnValue(resolves({ ...stored, status: 'removed' }));

    await expect(callAs().respond(respondInput)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This review was removed',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses a review removed while the response was written', async () => {
    reviewGet
      .mockReturnValueOnce(resolves(stored))
      .mockReturnValueOnce(resolves({ ...stored, status: 'removed' }));
    transactionGo.mockResolvedValue(
      cancelled('ConditionalCheckFailed', 'None'),
    );

    await expect(callAs().respond(respondInput)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('refuses when the instructor was taken off the course meanwhile', async () => {
    transactionGo.mockResolvedValue(
      cancelled('None', 'ConditionalCheckFailed'),
    );

    await expect(callAs().respond(respondInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('answers CONFLICT for a transaction conflict', async () => {
    transactionGo.mockResolvedValue(cancelled('TransactionConflict', 'None'));

    await expect(callAs().respond(respondInput)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('deleteResponse', () => {
  it("removes the response, including another instructor's, and returns the review", async () => {
    reviewGet
      .mockReturnValueOnce(resolves(answered))
      .mockReturnValueOnce(resolves(stored));

    const result = await callAs().deleteResponse(clearInput);

    expect(reviewWrites).toHaveBeenCalledWith(
      {},
      {
        action: 'deleteResponse',
        courseId: 'course-1',
        userId: 'student-1',
        at: expect.any(String),
        instructorId: INSTRUCTOR_SUB,
      },
    );
    expect(result.response).toBeUndefined();
    expect(result.reviewerId).toBe('student-1');
  });

  it('writes nothing when there is no response', async () => {
    reviewGet.mockReturnValue(resolves(stored));

    const result = await callAs().deleteResponse(clearInput);

    expect(result.reviewerId).toBe('student-1');
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for a missing review and refuses a removed one', async () => {
    reviewGet.mockReturnValue(resolves(null));
    await expect(callAs().deleteResponse(clearInput)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    reviewGet.mockReturnValue(resolves({ ...answered, status: 'removed' }));
    await expect(callAs().deleteResponse(clearInput)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This review was removed',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});
