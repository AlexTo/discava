/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { EnrolmentPaidForError, NotEnrolledError } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  dismissFirstLessonPrompt,
  enrol,
  myEnrolment,
  unenrol,
} from './enrolment.js';

const {
  enrolmentGet,
  enrolmentCreate,
  courseCheck,
  courseCheckWhere,
  transactionWrite,
  transactionGo,
  courseGet,
  restoreFreeEnrolment,
  unenrolFromCourse,
  dismissPrompt,
  readRefundedBefore,
  mockModule,
} = await vi.hoisted(async () => ({
  enrolmentCreate: vi.fn(),
  courseCheck: vi.fn(),
  courseCheckWhere: vi.fn(),
  transactionGo: vi.fn(),
  restoreFreeEnrolment: vi.fn(),
  unenrolFromCourse: vi.fn(),
  dismissPrompt: vi.fn(),
  readRefundedBefore: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    enrolment: ['get'],
    course: ['get'],
    transaction: ['write'],
  }),
}));

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal(), {
    restoreFreeEnrolment,
    unenrolFromCourse,
    dismissFirstLessonPrompt: dismissPrompt,
    readRefundedBefore,
  }),
);

const router = t.router({
  enrol,
  myEnrolment,
  unenrol,
  dismissFirstLessonPrompt,
});

const USER_SUB = 'student-1';

const callAsUser = () => callerFor(router, { sub: USER_SUB });

const callAnonymously = () => callerFor(router);

const enrolment = {
  courseId: 'course-1',
  userId: USER_SUB,
  status: 'active' as const,
  progressPercent: 0,
  createdAt: '2024-01-02T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

const storedEnrolment = (data: unknown) =>
  enrolmentGet.mockReturnValue({ go: vi.fn().mockResolvedValue({ data }) });

const storedCourse = (data: unknown) =>
  courseGet.mockReturnValue({ go: vi.fn().mockResolvedValue({ data }) });

// The transaction is cancelled, with these reasons for its two items: the
// course's status check, then the enrolment write.
const cancelled = (
  courseReason: string | undefined,
  enrolmentReason: string | undefined,
) =>
  transactionGo.mockResolvedValue({
    canceled: true,
    data: [
      courseReason ? { code: courseReason } : { code: 'None' },
      enrolmentReason ? { code: enrolmentReason } : { code: 'None' },
    ],
  });

beforeEach(() => {
  vi.clearAllMocks();
  readRefundedBefore.mockResolvedValue(false);
  courseCheck.mockReturnValue({
    where: courseCheckWhere.mockReturnValue({ commit: () => 'course-check' }),
  });
  enrolmentCreate.mockReturnValue({ commit: () => 'enrolment-create' });
  transactionWrite.mockImplementation((build) => ({
    items: build({
      course: { check: courseCheck },
      enrolment: { create: enrolmentCreate },
    }),
    go: transactionGo,
  }));
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  storedEnrolment(enrolment);
  storedCourse({ status: 'published', priceAmount: 0 });
});

describe('enrol', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      callAnonymously().enrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  // Invariant: a new enrolment only lands while the course is published, so a
  // course archived mid-request can't take one.
  it('creates the enrolment in one transaction with a check that the course is published', async () => {
    const result = await callAsUser().enrol({ courseId: 'course-1' });

    expect(transactionWrite.mock.results[0].value.items).toEqual([
      'course-check',
      'enrolment-create',
    ]);
    expect(courseCheck).toHaveBeenCalledWith({ courseId: 'course-1' });
    // Published and free: a priced course is entered by a paid order only.
    const eq = vi.fn((name: string, value: unknown) => `${name} = ${value}`);
    const condition = courseCheckWhere.mock.calls[0][0](
      { status: 'status', priceAmount: 'priceAmount' },
      { eq },
    );
    expect(eq).toHaveBeenCalledWith('status', 'published');
    expect(eq).toHaveBeenCalledWith('priceAmount', 0);
    expect(condition).toBe('status = published AND priceAmount = 0');
    // For the caller, never for a user named in the input.
    expect(enrolmentCreate).toHaveBeenCalledWith({
      courseId: 'course-1',
      userId: USER_SUB,
    });
    expect(result).toEqual(enrolment);
  });

  // Invariant: enrolling is idempotent.
  it('returns the existing enrolment when the caller is already enrolled', async () => {
    cancelled(undefined, 'ConditionalCheckFailed');

    await expect(callAsUser().enrol({ courseId: 'course-1' })).resolves.toEqual(
      enrolment,
    );
  });

  it('returns the existing enrolment even once the course is archived', async () => {
    cancelled('ConditionalCheckFailed', 'ConditionalCheckFailed');

    await expect(callAsUser().enrol({ courseId: 'course-1' })).resolves.toEqual(
      enrolment,
    );
  });

  // Invariant: only a published course can be enrolled in, and a draft's
  // existence isn't leaked.
  it('is NOT_FOUND when the course isn’t published (draft, archived or missing)', async () => {
    cancelled('ConditionalCheckFailed', undefined);
    storedEnrolment(null);

    await expect(
      callAsUser().enrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // A priced course is entered by a paid order, never by this route.
  it('is PRECONDITION_FAILED for a published course with a price, and writes nothing', async () => {
    cancelled('ConditionalCheckFailed', undefined);
    storedEnrolment(null);
    storedCourse({ status: 'published', priceAmount: 4900 });

    await expect(
      callAsUser().enrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This course must be purchased',
    });
    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(restoreFreeEnrolment).not.toHaveBeenCalled();
  });

  it.each(['draft', 'archived'])(
    'is still NOT_FOUND for a priced %s course',
    async (status) => {
      cancelled('ConditionalCheckFailed', undefined);
      storedEnrolment(null);
      storedCourse({ status, priceAmount: 4900 });

      await expect(
        callAsUser().enrol({ courseId: 'course-1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it('returns the existing enrolment of a student who enrolled before the course was priced', async () => {
    cancelled('ConditionalCheckFailed', 'ConditionalCheckFailed');
    storedCourse({ status: 'published', priceAmount: 4900 });

    await expect(callAsUser().enrol({ courseId: 'course-1' })).resolves.toEqual(
      enrolment,
    );
    expect(restoreFreeEnrolment).not.toHaveBeenCalled();
  });

  describe('a dropped enrolment', () => {
    const dropped = { ...enrolment, status: 'dropped' as const };
    const readAfter = (...reads: unknown[]) => {
      for (const data of reads) {
        enrolmentGet.mockReturnValueOnce({
          go: vi.fn().mockResolvedValue({ data }),
        });
      }
    };

    beforeEach(() => cancelled(undefined, 'ConditionalCheckFailed'));

    it('is restored in a free published course and returned', async () => {
      readAfter(dropped, enrolment);
      restoreFreeEnrolment.mockResolvedValue('restored');

      await expect(
        callAsUser().enrol({ courseId: 'course-1' }),
      ).resolves.toEqual(enrolment);
      expect(restoreFreeEnrolment).toHaveBeenCalledWith({
        coreTable: expect.anything(),
        courseId: 'course-1',
        userId: USER_SUB,
      });
    });

    it('is PRECONDITION_FAILED in a priced published course', async () => {
      readAfter(dropped);
      restoreFreeEnrolment.mockResolvedValue('course-unavailable');
      storedCourse({ status: 'published', priceAmount: 4900 });

      await expect(
        callAsUser().enrol({ courseId: 'course-1' }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    });

    it.each(['draft', 'archived'])(
      'is NOT_FOUND in a %s course',
      async (status) => {
        readAfter(dropped);
        restoreFreeEnrolment.mockResolvedValue('course-unavailable');
        storedCourse({ status, priceAmount: 0 });

        await expect(
          callAsUser().enrol({ courseId: 'course-1' }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      },
    );

    it('is read again and returned when it is no longer dropped', async () => {
      readAfter(dropped, enrolment);
      restoreFreeEnrolment.mockResolvedValue('not-dropped');

      await expect(
        callAsUser().enrol({ courseId: 'course-1' }),
      ).resolves.toEqual(enrolment);
    });
  });

  it('is a CONFLICT when another transaction touched the same records', async () => {
    cancelled('TransactionConflict', undefined);
    storedEnrolment(null);

    await expect(
      callAsUser().enrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('is an INTERNAL_SERVER_ERROR for any other cancellation', async () => {
    cancelled('ValidationError', undefined);

    await expect(
      callAsUser().enrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});

// An enrolment bought through a Stripe checkout names its order; no output
// carries it.
describe('an enrolment with an orderId', () => {
  const paid = { ...enrolment, orderId: 'order-secret' };

  it('is returned without the orderId by enrol', async () => {
    storedEnrolment(paid);
    const result = await callAsUser().enrol({ courseId: 'course-1' });
    expect(result).toEqual(enrolment);
    expect(result).not.toHaveProperty('orderId');
  });

  it('is returned without the orderId by myEnrolment', async () => {
    storedEnrolment(paid);
    const result = await callAsUser().myEnrolment({ courseId: 'course-1' });
    expect(result).toEqual({
      ...enrolment,
      paidFor: true,
      refundedBefore: false,
    });
    expect(result).not.toHaveProperty('orderId');
  });
});

describe('myEnrolment', () => {
  it('says whether an earlier order was refunded at the caller’s request, and nothing more', async () => {
    readRefundedBefore.mockResolvedValue(true);
    const result = await callAsUser().myEnrolment({ courseId: 'course-1' });
    expect(result).toEqual({
      ...enrolment,
      paidFor: false,
      refundedBefore: true,
    });
    expect(readRefundedBefore).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_SUB, courseId: 'course-1' }),
    );
  });

  it('returns the caller’s enrolment in the course', async () => {
    await expect(
      callAsUser().myEnrolment({ courseId: 'course-1' }),
    ).resolves.toEqual({ ...enrolment, paidFor: false, refundedBefore: false });
    expect(enrolmentGet).toHaveBeenCalledWith({
      courseId: 'course-1',
      userId: USER_SUB,
    });
  });

  it('returns null when the caller isn’t enrolled', async () => {
    storedEnrolment(null);

    await expect(
      callAsUser().myEnrolment({ courseId: 'course-1' }),
    ).resolves.toBeNull();
  });

  it('rejects unauthenticated callers', async () => {
    await expect(
      callAnonymously().myEnrolment({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('first-lesson prompt state', () => {
  it('is returned by enrol and myEnrolment, still without the orderId', async () => {
    const answered = {
      ...enrolment,
      firstLessonPromptState: 'answered' as const,
      orderId: 'order-secret',
    };
    storedEnrolment(answered);
    transactionGo.mockResolvedValue({ canceled: false, data: [] });
    const enrolled = await callAsUser().enrol({ courseId: 'course-1' });
    const mine = await callAsUser().myEnrolment({ courseId: 'course-1' });
    for (const result of [enrolled, mine]) {
      expect(result).toMatchObject({ firstLessonPromptState: 'answered' });
      expect(result).not.toHaveProperty('orderId');
    }
  });

  it('is absent while the prompt is open', async () => {
    expect(
      await callAsUser().myEnrolment({ courseId: 'course-1' }),
    ).not.toHaveProperty('firstLessonPromptState');
  });
});

describe('dismissFirstLessonPrompt', () => {
  const dismissed = {
    ...enrolment,
    firstLessonPromptState: 'dismissed' as const,
    orderId: 'order-secret',
  };

  it('rejects unauthenticated callers', async () => {
    await expect(
      callAnonymously().dismissFirstLessonPrompt({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(dismissPrompt).not.toHaveBeenCalled();
  });

  it('dismisses for the caller and returns the enrolment without the orderId', async () => {
    dismissPrompt.mockResolvedValue(dismissed);
    const result = await callAsUser().dismissFirstLessonPrompt({
      courseId: 'course-1',
    });
    expect(dismissPrompt).toHaveBeenCalledWith(expect.anything(), {
      courseId: 'course-1',
      userId: USER_SUB,
    });
    expect(result).toMatchObject({ firstLessonPromptState: 'dismissed' });
    expect(result).not.toHaveProperty('orderId');
  });

  it('succeeds again, and after an answer returns the answered enrolment', async () => {
    dismissPrompt.mockResolvedValue({
      ...enrolment,
      firstLessonPromptState: 'answered',
    });
    const first = await callAsUser().dismissFirstLessonPrompt({
      courseId: 'course-1',
    });
    const second = await callAsUser().dismissFirstLessonPrompt({
      courseId: 'course-1',
    });
    expect(first).toEqual(second);
    expect(second.firstLessonPromptState).toBe('answered');
  });

  it.each([
    ['a published course', { status: 'published' }, 'FORBIDDEN'],
    ['an archived course', { status: 'archived' }, 'NOT_FOUND'],
    ['a draft course', { status: 'draft' }, 'NOT_FOUND'],
    ['a missing course', null, 'NOT_FOUND'],
  ])(
    'refuses a caller who is not enrolled in %s',
    async (_name, course, code) => {
      dismissPrompt.mockRejectedValue(new NotEnrolledError());
      storedCourse(course);
      await expect(
        callAsUser().dismissFirstLessonPrompt({ courseId: 'course-1' }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("works whatever the course's status", async () => {
    storedCourse({ status: 'archived' });
    dismissPrompt.mockResolvedValue(dismissed);
    await expect(
      callAsUser().dismissFirstLessonPrompt({ courseId: 'course-1' }),
    ).resolves.toMatchObject({ firstLessonPromptState: 'dismissed' });
  });
});

describe('unenrol', () => {
  const left = { ...enrolment, status: 'dropped' as const };
  const reads = (...stored: unknown[]) => {
    for (const data of stored) {
      enrolmentGet.mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({ data }),
      });
    }
  };

  it('rejects unauthenticated callers', async () => {
    await expect(
      callAnonymously().unenrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('ends the caller’s own enrolment and returns it', async () => {
    reads(enrolment, left);
    unenrolFromCourse.mockResolvedValue(true);

    await expect(
      callAsUser().unenrol({ courseId: 'course-1' }),
    ).resolves.toEqual({ ...left, paidFor: false, refundedBefore: false });
    expect(unenrolFromCourse).toHaveBeenCalledWith({
      coreTable: expect.anything(),
      userId: USER_SUB,
      courseId: 'course-1',
      now: expect.any(String),
    });
  });

  it('is NOT_FOUND without an enrolment', async () => {
    storedEnrolment(null);
    await expect(
      callAsUser().unenrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(unenrolFromCourse).not.toHaveBeenCalled();
  });

  it('returns an already dropped enrolment as it is', async () => {
    storedEnrolment(left);
    await expect(
      callAsUser().unenrol({ courseId: 'course-1' }),
    ).resolves.toEqual({ ...left, paidFor: false, refundedBefore: false });
    expect(unenrolFromCourse).not.toHaveBeenCalled();
  });

  it('refuses a paid enrolment with the refund message', async () => {
    reads({ ...enrolment, orderId: 'order-secret' });
    unenrolFromCourse.mockRejectedValue(new EnrolmentPaidForError());

    await expect(
      callAsUser().unenrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'You bought this course; request a refund instead',
    });
  });

  it('leaving a free course then enrolling restores the same enrolment', async () => {
    reads(enrolment, left);
    unenrolFromCourse.mockResolvedValue(true);
    await callAsUser().unenrol({ courseId: 'course-1' });

    cancelled(undefined, 'ConditionalCheckFailed');
    reads(left, { ...enrolment, progressPercent: 0 });
    restoreFreeEnrolment.mockResolvedValue('restored');
    await expect(
      callAsUser().enrol({ courseId: 'course-1' }),
    ).resolves.toMatchObject({ status: 'active', courseId: 'course-1' });
  });

  it('leaving a grandfathered enrolment in a now priced course, then enrolling, must be purchased', async () => {
    reads(enrolment, left);
    unenrolFromCourse.mockResolvedValue(true);
    await callAsUser().unenrol({ courseId: 'course-1' });

    cancelled(undefined, 'ConditionalCheckFailed');
    reads(left);
    restoreFreeEnrolment.mockResolvedValue('course-unavailable');
    storedCourse({ status: 'published', priceAmount: 4900 });
    await expect(
      callAsUser().enrol({ courseId: 'course-1' }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This course must be purchased',
    });
  });
});
