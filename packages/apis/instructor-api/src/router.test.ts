/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { describe, expect, it, vi } from 'vitest';
import { appRouter } from './router.js';

// Callers refused before any table access never reach the table; one that
// got past the check would fail here, which the tests below would not accept.
vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => {
    throw new Error('no table in this test');
  }),
}));

const codeOf = async (
  options: Parameters<typeof callerFor>[1],
  path: 'coupon.create' | 'coupon.list' | 'coupon.update' | 'coupon.delete',
  input: object,
) => {
  const call = path
    .split('.')
    .reduce<any>(
      (node, segment) => node[segment],
      callerFor(appRouter, options),
    );
  try {
    await call(input);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

const createInput = { courseId: 'course-1', type: 'percent', value: 10 };
const listInput = { courseId: 'course-1' };
const updateInput = { courseId: 'course-1', code: 'SPRING-25', enabled: false };
const deleteInput = { courseId: 'course-1', code: 'SPRING-25' };

describe('coupon router', () => {
  it.each([
    ['coupon.create', createInput],
    ['coupon.list', listInput],
    ['coupon.update', updateInput],
    ['coupon.delete', deleteInput],
  ] as const)('%s refuses an anonymous caller', async (path, input) => {
    expect(await codeOf(undefined, path, input)).toBe('UNAUTHORIZED');
  });

  it.each([
    ['coupon.create', createInput],
    ['coupon.list', listInput],
    ['coupon.update', updateInput],
    ['coupon.delete', deleteInput],
  ] as const)(
    '%s refuses a caller outside the instructor group',
    async (path, input) => {
      expect(
        await codeOf({ sub: 'user-1', groups: ['student'] }, path, input),
      ).toBe('FORBIDDEN');
    },
  );

  it('mounts the coupon procedures', () => {
    expect(Object.keys(appRouter._def.procedures)).toEqual(
      expect.arrayContaining([
        'coupon.create',
        'coupon.list',
        'coupon.update',
        'coupon.delete',
      ]),
    );
  });
});
