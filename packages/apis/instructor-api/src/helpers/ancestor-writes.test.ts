/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  writeInActiveCourse,
  writeUnderActiveAncestors,
} from './ancestor-writes.js';

const ancestors = { courseId: 'c', moduleId: 'm', lessonId: 'l' };

// A coreTable whose transaction resolves as given. Only the transaction's
// shape matters here: `data` holds one result per item, ancestor checks first.
const coreTableWith = (
  result: {
    canceled: boolean;
    data?: { code?: string }[];
  },
  // `null` is a course that no longer exists.
  course: { courseId: string; status: string } | null = {
    courseId: 'c',
    status: 'published',
  },
) => {
  const check = () => ({ where: () => ({ commit: () => ({}) }) });
  const coreTable = {
    transaction: {
      write: vi.fn((build: (entities: unknown) => unknown) => {
        build({ course: { check }, module: { check }, lesson: { check } });
        return { go: vi.fn().mockResolvedValue(result) };
      }),
    },
    entities: {
      // Re-read to name an archived ancestor precisely: all still active.
      course: {
        get: () => ({ go: async () => ({ data: course ?? undefined }) }),
      },
      module: {
        get: () => ({ go: async () => ({ data: { moduleId: 'm' } }) }),
      },
      lesson: {
        get: () => ({ go: async () => ({ data: { lessonId: 'l' } }) }),
      },
    },
  };
  return coreTable as never;
};

const run = (
  result: Parameters<typeof coreTableWith>[0],
  onWrite?: () => never,
  course?: Parameters<typeof coreTableWith>[1],
) =>
  writeUnderActiveAncestors(
    coreTableWith(result, course),
    ancestors,
    () => [],
    onWrite,
  );

const CCF = { code: 'ConditionalCheckFailed' };
const TC = { code: 'TransactionConflict' };

// The transaction's results, in order: the course check, the module check, the
// lesson check, then the caller's writes.
describe('writeUnderActiveAncestors', () => {
  it('resolves when the transaction commits', async () => {
    await expect(run({ canceled: false, data: [] })).resolves.toBeUndefined();
  });

  it('reports CONFLICT when an ancestor check failed but nothing is archived any more', async () => {
    await expect(
      run({ canceled: true, data: [{}, CCF, {}, {}] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // An archived course is read-only. Its check is the first in the
  // transaction, and the precise error is found by re-reading.
  it('names the course when the course check failed because it is archived', async () => {
    await expect(
      run({ canceled: true, data: [CCF, {}, {}, {}] }, undefined, {
        courseId: 'c',
        status: 'archived',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
  });

  it('reports NOT_FOUND when the course check failed because the course is gone', async () => {
    await expect(
      run({ canceled: true, data: [CCF, {}, {}, {}] }, undefined, null),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("calls the caller's own error when one of the writes failed its condition", async () => {
    const onWriteConflict = vi.fn(() => {
      throw new Error('caller error');
    });

    await expect(
      run({ canceled: true, data: [{}, {}, {}, CCF] }, onWriteConflict),
    ).rejects.toThrow('caller error');
  });

  // DynamoDB cancels one of two transactions that touch the same records at
  // once with TransactionConflict rather than a failed condition. Nothing was
  // written, so it's a retryable conflict, not a server error.
  it.each([[[TC, {}, {}, {}]], [[{}, {}, {}, TC]], [[TC, {}, {}, TC]]])(
    'reports CONFLICT, not a server error, for a transaction conflict %j',
    async (data) => {
      await expect(run({ canceled: true, data })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('Please retry'),
      });
    },
  );

  it('still reports a failed condition in preference to a transaction conflict', async () => {
    const onWriteConflict = vi.fn(() => {
      throw new Error('caller error');
    });

    await expect(
      run({ canceled: true, data: [TC, {}, {}, CCF] }, onWriteConflict),
    ).rejects.toThrow('caller error');
  });

  it('reports INTERNAL_SERVER_ERROR when the cancellation has no recognised reason', async () => {
    await expect(
      run({ canceled: true, data: [{}, {}, {}, {}] }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});

const runInCourse = (
  result: Parameters<typeof coreTableWith>[0],
  onWrite?: () => never,
  course?: Parameters<typeof coreTableWith>[1],
) => writeInActiveCourse(coreTableWith(result, course), 'c', () => [], onWrite);

// A write that sits directly under the course: the course check is first, then
// the caller's writes.
describe('writeInActiveCourse', () => {
  it('resolves when the transaction commits', async () => {
    await expect(
      runInCourse({ canceled: false, data: [] }),
    ).resolves.toBeUndefined();
  });

  it('names the course when it is archived', async () => {
    await expect(
      runInCourse({ canceled: true, data: [CCF, {}] }, undefined, {
        courseId: 'c',
        status: 'archived',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
  });

  it('reports NOT_FOUND when the course no longer exists', async () => {
    await expect(
      runInCourse({ canceled: true, data: [CCF, {}] }, undefined, null),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports CONFLICT when the course check failed but the course is no longer archived', async () => {
    await expect(
      runInCourse({ canceled: true, data: [CCF, {}] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("calls the caller's own error when a write failed its condition", async () => {
    const onWriteConflict = vi.fn(() => {
      throw new Error('caller error');
    });

    await expect(
      runInCourse({ canceled: true, data: [{}, CCF] }, onWriteConflict),
    ).rejects.toThrow('caller error');
  });

  it.each([[[TC, {}]], [[{}, TC]]])(
    'reports CONFLICT, not a server error, for a transaction conflict %j',
    async (data) => {
      await expect(runInCourse({ canceled: true, data })).rejects.toMatchObject(
        {
          code: 'CONFLICT',
          message: expect.stringContaining('Please retry'),
        },
      );
    },
  );

  it('reports INTERNAL_SERVER_ERROR when the cancellation has no recognised reason', async () => {
    await expect(
      runInCourse({ canceled: true, data: [{}, {}] }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});
