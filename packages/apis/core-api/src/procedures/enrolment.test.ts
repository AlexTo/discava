/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { enrol, myEnrolment } from './enrolment.js';

const {
  enrolmentGet,
  enrolmentCreate,
  courseCheck,
  courseCheckWhere,
  transactionWrite,
  transactionGo,
  courseGet,
  restoreFreeEnrolment,
} = vi.hoisted(() => ({
  enrolmentGet: vi.fn(),
  enrolmentCreate: vi.fn(),
  courseCheck: vi.fn(),
  courseCheckWhere: vi.fn(),
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  courseGet: vi.fn(),
  restoreFreeEnrolment: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  restoreFreeEnrolment,
  createCoreTableService: vi.fn(async () => ({
    entities: { enrolment: { get: enrolmentGet }, course: { get: courseGet } },
    transaction: { write: transactionWrite },
  })),
}));

const router = t.router({ enrol, myEnrolment });
const caller = t.createCallerFactory(router);

const USER_SUB = 'student-1';

const callAsUser = () =>
  caller({
    event: {
      requestContext: { authorizer: { claims: { sub: USER_SUB } } },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const callAnonymously = () =>
  caller({
    event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

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
    expect(result).toEqual(enrolment);
    expect(result).not.toHaveProperty('orderId');
  });
});

describe('myEnrolment', () => {
  it('returns the caller’s enrolment in the course', async () => {
    await expect(
      callAsUser().myEnrolment({ courseId: 'course-1' }),
    ).resolves.toEqual(enrolment);
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
