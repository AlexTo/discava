/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  createCoupon,
  deleteCoupon,
  listCoupons,
  updateCoupon,
} from './coupon.js';

const {
  courseGet,
  coursePatch,
  courseInstructorGet,
  couponCreate,
  couponGet,
  couponPatch,
  couponDelete,
  couponQueryPrimary,
  mockModule,
} = await vi.hoisted(async () =>
  (await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    course: ['get', 'patch'],
    courseInstructor: ['get'],
    coupon: ['create', 'get', 'patch', 'delete', 'query.primary'],
  }),
);

vi.mock('@discava/core-table', async (importActual) =>
  mockModule(await importActual()),
);

const router = t.router({
  createCoupon,
  listCoupons,
  updateCoupon,
  deleteCoupon,
});

const INSTRUCTOR_SUB = 'instructor-1';
const callAs = (sub = INSTRUCTOR_SUB, groups = ['instructor']) =>
  callerFor(router, { sub, groups });

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

const conditionalCheckFailed = () =>
  Object.assign(new Error('The conditional request failed'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

const paidCourse = {
  courseId: 'course-1',
  status: 'draft',
  priceAmount: 5000,
  priceCurrency: 'USD',
};

const NOW = new Date('2026-11-20T10:00:00.000Z');

// Echoes what was written, as ElectroDB's create does.
const echoCreate = () =>
  couponCreate.mockImplementation((item: Record<string, unknown>) => ({
    go: vi.fn().mockResolvedValue({
      data: { redeemedCount: 0, enabled: true, ...item },
    }),
  }));

const created = () => couponCreate.mock.calls[0]![0];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  courseInstructorGet.mockReturnValue(
    resolves({ courseId: 'course-1', instructorId: INSTRUCTOR_SUB }),
  );
  courseGet.mockReturnValue(resolves(paidCourse));
  echoCreate();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('coupon.create', () => {
  const input = { courseId: 'course-1', type: 'percent' as const, value: 25 };

  it('stores a typed code in upper case, trimmed', async () => {
    const result = await callAs().createCoupon({
      ...input,
      code: '  spring-25 ',
    });

    expect(created()).toMatchObject({
      courseId: 'course-1',
      code: 'SPRING-25',
      type: 'percent',
      value: 25,
      createdBy: INSTRUCTOR_SUB,
    });
    expect(result).toMatchObject({
      code: 'SPRING-25',
      redeemedCount: 0,
      enabled: true,
      status: 'active',
    });
  });

  it('generates a code when none is given', async () => {
    const result = await callAs().createCoupon(input);

    expect(result.code).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
    );
    expect(created().code).toBe(result.code);
  });

  it('draws another generated code when one is taken', async () => {
    couponCreate
      .mockReturnValueOnce({
        go: vi.fn().mockRejectedValue(conditionalCheckFailed()),
      })
      .mockImplementationOnce((item: Record<string, unknown>) => ({
        go: vi.fn().mockResolvedValue({
          data: { redeemedCount: 0, enabled: true, ...item },
        }),
      }));

    await callAs().createCoupon(input);

    expect(couponCreate).toHaveBeenCalledTimes(2);
    expect(couponCreate.mock.calls[1]![0].code).not.toBe(
      couponCreate.mock.calls[0]![0].code,
    );
  });

  it('gives up after five generated codes are all taken', async () => {
    couponCreate.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailed()),
    });

    await expect(callAs().createCoupon(input)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(couponCreate).toHaveBeenCalledTimes(5);
  });

  it('copies the course currency onto a fixed coupon', async () => {
    await callAs().createCoupon({ ...input, type: 'fixed', value: 1500 });

    expect(created()).toMatchObject({ type: 'fixed', currency: 'USD' });
  });

  it('stores no currency on a percent coupon', async () => {
    await callAs().createCoupon(input);

    expect(created()).not.toHaveProperty('currency');
  });

  it('stores the end of the expiry day, UTC, and the limit', async () => {
    const result = await callAs().createCoupon({
      ...input,
      expiresOn: '2026-11-20',
      maxRedemptions: 10,
    });

    expect(created()).toMatchObject({
      expiresAt: '2026-11-20T23:59:59.999Z',
      maxRedemptions: 10,
    });
    expect(result).toMatchObject({
      expiresAt: '2026-11-20T23:59:59.999Z',
      maxRedemptions: 10,
    });
  });

  it.each([
    ['code too short', { code: 'ABC' }, 'code'],
    ['code too long', { code: 'A'.repeat(25) }, 'code'],
    ['code with a space', { code: 'AB CD' }, 'code'],
    ['code with punctuation', { code: 'AB_CD!' }, 'code'],
    ['percent 0', { value: 0 }, 'value'],
    ['percent 101', { value: 101 }, 'value'],
    ['fractional percent', { value: 12.5 }, 'value'],
    ['fixed 0', { type: 'fixed' as const, value: 0 }, 'value'],
    ['fixed above the price', { type: 'fixed' as const, value: 5001 }, 'value'],
    ['expiry yesterday', { expiresOn: '2026-11-19' }, 'expiresOn'],
    ['malformed expiry', { expiresOn: '20/11/2026' }, 'expiresOn'],
    ['impossible expiry date', { expiresOn: '2026-02-31' }, 'expiresOn'],
    ['limit 0', { maxRedemptions: 0 }, 'maxRedemptions'],
    ['fractional limit', { maxRedemptions: 1.5 }, 'maxRedemptions'],
  ])(
    'refuses %s, naming the field, and writes nothing',
    async (_, extra, field) => {
      await expect(
        callAs().createCoupon({ ...input, ...extra }),
      ).rejects.toThrow(new RegExp(field));
      expect(couponCreate).not.toHaveBeenCalled();
    },
  );

  it('accepts a fixed discount equal to the price', async () => {
    await callAs().createCoupon({ ...input, type: 'fixed', value: 5000 });

    expect(couponCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses a free course', async () => {
    courseGet.mockReturnValue(resolves({ ...paidCourse, priceAmount: 0 }));

    await expect(callAs().createCoupon(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Coupons need a paid course',
    });
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('refuses a duplicate code in the course', async () => {
    couponCreate.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailed()),
    });

    await expect(
      callAs().createCoupon({ ...input, code: 'SPRING-25' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This code already exists for the course',
    });
    expect(couponCreate).toHaveBeenCalledTimes(1);
  });

  it('allows the same code in another course', async () => {
    courseInstructorGet.mockReturnValue(
      resolves({ courseId: 'course-2', instructorId: INSTRUCTOR_SUB }),
    );
    courseGet.mockReturnValue(
      resolves({ ...paidCourse, courseId: 'course-2' }),
    );

    await callAs().createCoupon({
      ...input,
      courseId: 'course-2',
      code: 'SPRING-25',
    });

    expect(created()).toMatchObject({
      courseId: 'course-2',
      code: 'SPRING-25',
    });
  });

  it.each(['draft', 'published', 'archived'])(
    'accepts a %s course',
    async (status) => {
      courseGet.mockReturnValue(resolves({ ...paidCourse, status }));

      await callAs().createCoupon(input);

      expect(couponCreate).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses an instructor who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue(resolves(null));

    await expect(callAs().createCoupon(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the instructor group', async () => {
    await expect(
      callAs('student-1', ['student']).createCoupon(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('reports a missing course as not found', async () => {
    courseGet.mockReturnValue(resolves(null));

    await expect(callAs().createCoupon(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never writes the course', async () => {
    await callAs().createCoupon(input);

    expect(coursePatch).not.toHaveBeenCalled();
  });
});

describe('coupon.list', () => {
  const coupon = (overrides: Record<string, unknown>) => ({
    courseId: 'course-1',
    code: 'CODE-0001',
    type: 'percent',
    value: 10,
    redeemedCount: 0,
    enabled: true,
    createdBy: INSTRUCTOR_SUB,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  });

  it('queries only the course asked for', async () => {
    couponQueryPrimary.mockReturnValue(resolves([coupon({})]));

    await callAs().listCoupons({ courseId: 'course-1' });

    expect(couponQueryPrimary).toHaveBeenCalledWith({ courseId: 'course-1' });
  });

  it('lists the newest first', async () => {
    couponQueryPrimary.mockReturnValue(
      resolves([
        coupon({ code: 'AAAA', createdAt: '2026-11-01T00:00:00.000Z' }),
        coupon({ code: 'CCCC', createdAt: '2026-11-03T00:00:00.000Z' }),
        coupon({ code: 'BBBB', createdAt: '2026-11-02T00:00:00.000Z' }),
      ]),
    );

    const { items } = await callAs().listCoupons({ courseId: 'course-1' });

    expect(items.map((item) => item.code)).toEqual(['CCCC', 'BBBB', 'AAAA']);
  });

  it('derives each coupon status', async () => {
    couponQueryPrimary.mockReturnValue(
      resolves([
        coupon({ code: 'ACTIVE' }),
        coupon({ code: 'OFF', enabled: false }),
        coupon({ code: 'OLD', expiresAt: '2026-11-19T23:59:59.999Z' }),
        coupon({ code: 'FULL', maxRedemptions: 3, redeemedCount: 3 }),
        coupon({
          code: 'OFFOLD',
          enabled: false,
          expiresAt: '2026-11-01T23:59:59.999Z',
        }),
      ]),
    );

    const { items } = await callAs().listCoupons({ courseId: 'course-1' });

    const status = Object.fromEntries(items.map((i) => [i.code, i.status]));
    expect(status).toEqual({
      ACTIVE: 'active',
      OFF: 'disabled',
      OLD: 'expired',
      FULL: 'used up',
      OFFOLD: 'disabled',
    });
    expect(items.find((i) => i.code === 'FULL')).toMatchObject({
      redeemedCount: 3,
      maxRedemptions: 3,
    });
  });

  it('returns an empty list for a course with no coupons', async () => {
    couponQueryPrimary.mockReturnValue(resolves([]));

    await expect(
      callAs().listCoupons({ courseId: 'course-1' }),
    ).resolves.toEqual({ items: [] });
  });

  it('refuses an instructor who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue(resolves(null));

    await expect(
      callAs().listCoupons({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(couponQueryPrimary).not.toHaveBeenCalled();
  });
});

// A stored coupon the fake enforces conditions against, as DynamoDB does: the
// `where` callback is run with attribute and operator stand-ins that build the
// condition as text, and the write fails unless the stored item meets it.
const storedCoupon = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'course-1',
  code: 'SPRING-25',
  type: 'percent',
  value: 10,
  redeemedCount: 0,
  enabled: true,
  createdBy: INSTRUCTOR_SUB,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

type Stored = ReturnType<typeof storedCoupon>;

const conditionHolds = (
  where: ((attr: any, op: any) => string) | undefined,
  item: Stored | undefined,
) => {
  if (!item) {
    return false;
  }
  if (!where) {
    return true;
  }
  const attr = new Proxy({}, { get: (_, name) => name });
  const op = {
    exists: (name: string) => `exists:${name}`,
    eq: (name: string, value: unknown) => `eq:${name}:${value}`,
    lte: (name: string, value: unknown) => `lte:${name}:${value}`,
  };
  return where(attr, op)
    .split(' AND ')
    .every((clause) => {
      const [kind, name, value] = clause.split(':') as [string, string, string];
      const actual = (item as Record<string, unknown>)[name];
      if (kind === 'exists') {
        return actual !== undefined;
      }
      if (kind === 'eq') {
        return actual === Number(value);
      }
      return (actual as number) <= Number(value);
    });
};

// `store.item` is what the table holds; a test changes it to model a claim
// landing between the procedure's read and its write.
const store: { item: Stored | undefined } = { item: undefined };

const installFakeTable = (item: Stored | undefined) => {
  store.item = item;
  couponGet.mockImplementation(() => ({
    go: vi.fn(async () => ({ data: store.item ?? null })),
  }));
  couponPatch.mockImplementation(() => {
    let set: Record<string, unknown> = {};
    let removed: string[] = [];
    let where: ((attr: any, op: any) => string) | undefined;
    const chain = {
      set: (values: Record<string, unknown>) => {
        set = values;
        return chain;
      },
      remove: (names: string[]) => {
        removed = names;
        return chain;
      },
      where: (callback: typeof where) => {
        where = callback;
        return chain;
      },
      go: vi.fn(async () => {
        if (!conditionHolds(where, store.item)) {
          throw conditionalCheckFailed();
        }
        const next: Record<string, unknown> = { ...store.item, ...set };
        for (const name of removed) {
          delete next[name];
        }
        store.item = next as Stored;
        return { data: store.item };
      }),
    };
    return chain;
  });
  couponDelete.mockImplementation(() => {
    let where: ((attr: any, op: any) => string) | undefined;
    const chain = {
      where: (callback: typeof where) => {
        where = callback;
        return chain;
      },
      go: vi.fn(async () => {
        if (!conditionHolds(where, store.item)) {
          throw conditionalCheckFailed();
        }
        store.item = undefined;
        return { data: null };
      }),
    };
    return chain;
  });
};

const patched = () => couponPatch.mock.calls[0]![0];

describe('coupon.update', () => {
  const key = { courseId: 'course-1', code: 'SPRING-25' };

  it('disables and enables a code', async () => {
    installFakeTable(storedCoupon());

    await expect(
      callAs().updateCoupon({ ...key, enabled: false }),
    ).resolves.toMatchObject({ enabled: false, status: 'disabled' });
    await expect(
      callAs().updateCoupon({ ...key, enabled: true }),
    ).resolves.toMatchObject({ enabled: true, status: 'active' });
  });

  it('writes the key with the code normalised', async () => {
    installFakeTable(storedCoupon());

    await callAs().updateCoupon({
      ...key,
      code: ' spring-25 ',
      enabled: false,
    });

    expect(patched()).toEqual(key);
  });

  it('sets the end of the expiry day, UTC, and clears it with null', async () => {
    installFakeTable(storedCoupon());

    await expect(
      callAs().updateCoupon({ ...key, expiresOn: '2026-12-01' }),
    ).resolves.toMatchObject({ expiresAt: '2026-12-01T23:59:59.999Z' });
    const cleared = await callAs().updateCoupon({ ...key, expiresOn: null });

    expect(cleared).not.toHaveProperty('expiresAt');
    expect(store.item).not.toHaveProperty('expiresAt');
  });

  it('accepts an expiry of today', async () => {
    installFakeTable(storedCoupon());

    await expect(
      callAs().updateCoupon({ ...key, expiresOn: '2026-11-20' }),
    ).resolves.toMatchObject({ expiresAt: '2026-11-20T23:59:59.999Z' });
  });

  it('sets the limit and clears it with null', async () => {
    installFakeTable(storedCoupon({ redeemedCount: 2 }));

    await expect(
      callAs().updateCoupon({ ...key, maxRedemptions: 2 }),
    ).resolves.toMatchObject({ maxRedemptions: 2, status: 'used up' });
    const cleared = await callAs().updateCoupon({
      ...key,
      maxRedemptions: null,
    });

    expect(cleared).not.toHaveProperty('maxRedemptions');
    expect(cleared.status).toBe('active');
  });

  it('leaves what the call does not mention alone', async () => {
    installFakeTable(
      storedCoupon({
        expiresAt: '2026-12-01T23:59:59.999Z',
        maxRedemptions: 5,
      }),
    );

    await callAs().updateCoupon({ ...key, enabled: false });

    expect(store.item).toMatchObject({
      expiresAt: '2026-12-01T23:59:59.999Z',
      maxRedemptions: 5,
    });
  });

  it('refuses a limit below the redemptions held, with the count', async () => {
    installFakeTable(storedCoupon({ redeemedCount: 4, maxRedemptions: 10 }));

    await expect(
      callAs().updateCoupon({ ...key, maxRedemptions: 3 }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'The limit cannot be below the 4 redemptions already held',
    });
    expect(store.item).toMatchObject({ maxRedemptions: 10 });
  });

  it('refuses a limit a claim undercuts between the read and the write', async () => {
    installFakeTable(storedCoupon({ redeemedCount: 2, maxRedemptions: 10 }));
    // The claim lands as the update is built, after any read it might do.
    const realPatch = couponPatch.getMockImplementation()!;
    couponPatch.mockImplementationOnce((...args: unknown[]) => {
      store.item = { ...store.item!, redeemedCount: 5 };
      return realPatch(...args);
    });

    await expect(
      callAs().updateCoupon({ ...key, maxRedemptions: 3 }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'The limit cannot be below the 5 redemptions already held',
    });
    expect(store.item).toMatchObject({ maxRedemptions: 10 });
  });

  it('allows a limit equal to the redemptions held', async () => {
    installFakeTable(storedCoupon({ redeemedCount: 4 }));

    await expect(
      callAs().updateCoupon({ ...key, maxRedemptions: 4 }),
    ).resolves.toMatchObject({ maxRedemptions: 4 });
  });

  it('reports a missing code as not found, and creates nothing', async () => {
    installFakeTable(undefined);

    await expect(
      callAs().updateCoupon({ ...key, enabled: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store.item).toBeUndefined();
  });

  it('reports a malformed code as not found without writing', async () => {
    installFakeTable(storedCoupon());

    await expect(
      callAs().updateCoupon({ ...key, code: 'no', enabled: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(couponPatch).not.toHaveBeenCalled();
  });

  it.each([
    ['yesterday', { expiresOn: '2026-11-19' }],
    ['a malformed date', { expiresOn: '20/11/2026' }],
    ['a limit of 0', { maxRedemptions: 0 }],
    ['a fractional limit', { maxRedemptions: 1.5 }],
    ['nothing to change', {}],
  ])('refuses %s without writing', async (_, extra) => {
    installFakeTable(storedCoupon());

    await expect(callAs().updateCoupon({ ...key, ...extra })).rejects.toThrow();
    expect(couponPatch).not.toHaveBeenCalled();
  });

  it.each([
    ['type', { type: 'fixed' }],
    ['value', { value: 99 }],
  ])('rejects %s, which a code never changes', async (_, extra) => {
    installFakeTable(storedCoupon());

    await expect(
      callAs().updateCoupon({ ...key, enabled: false, ...extra } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(couponPatch).not.toHaveBeenCalled();
  });

  it('refuses an instructor who does not teach the course', async () => {
    installFakeTable(storedCoupon());
    courseInstructorGet.mockReturnValue(resolves(null));

    await expect(
      callAs().updateCoupon({ ...key, enabled: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(couponPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the instructor group', async () => {
    installFakeTable(storedCoupon());

    await expect(
      callAs('student-1', ['student']).updateCoupon({ ...key, enabled: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(couponPatch).not.toHaveBeenCalled();
  });

  it('never writes the course', async () => {
    installFakeTable(storedCoupon());

    await callAs().updateCoupon({ ...key, enabled: false });

    expect(coursePatch).not.toHaveBeenCalled();
  });
});

describe('coupon.delete', () => {
  const key = { courseId: 'course-1', code: 'SPRING-25' };

  it('deletes an unused code', async () => {
    installFakeTable(storedCoupon());

    await expect(callAs().deleteCoupon(key)).resolves.toEqual({
      success: true,
    });
    expect(store.item).toBeUndefined();
  });

  it('normalises the code it deletes', async () => {
    installFakeTable(storedCoupon());

    await callAs().deleteCoupon({ ...key, code: ' spring-25 ' });

    expect(couponDelete).toHaveBeenCalledWith(key);
  });

  it('refuses a code with a redemption and keeps it', async () => {
    installFakeTable(storedCoupon({ redeemedCount: 1 }));

    await expect(callAs().deleteCoupon(key)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This code has redemptions; disable it instead',
    });
    expect(store.item).toBeDefined();
  });

  it('keeps a code a claim reached between the read and the delete', async () => {
    installFakeTable(storedCoupon());
    const realDelete = couponDelete.getMockImplementation()!;
    couponDelete.mockImplementationOnce((...args: unknown[]) => {
      store.item = { ...store.item!, redeemedCount: 1 };
      return realDelete(...args);
    });

    await expect(callAs().deleteCoupon(key)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(store.item).toBeDefined();
  });

  it('reports a missing code as not found', async () => {
    installFakeTable(undefined);

    await expect(callAs().deleteCoupon(key)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an instructor who does not teach the course', async () => {
    installFakeTable(storedCoupon());
    courseInstructorGet.mockReturnValue(resolves(null));

    await expect(callAs().deleteCoupon(key)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(store.item).toBeDefined();
  });

  it('refuses a caller outside the instructor group', async () => {
    installFakeTable(storedCoupon());

    await expect(
      callAs('student-1', ['student']).deleteCoupon(key),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.item).toBeDefined();
  });
});
