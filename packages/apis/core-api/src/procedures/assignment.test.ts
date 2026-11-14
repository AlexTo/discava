/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { submit, uploadUrl } from './assignment.js';

// What the mocked table holds for this test; each entity's `get` reads it.
const {
  db,
  transactionGo,
  scheduleOrThrow,
  schedule,
  headUpload,
  presign,
  copyTo,
  deleteFolder,
} = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  transactionGo: vi.fn(),
  scheduleOrThrow: vi.fn(),
  schedule: vi.fn(),
  headUpload: vi.fn(),
  presign: vi.fn(),
  copyTo: vi.fn(),
  deleteFolder: vi.fn(),
}));

// A transaction item as the code built it, with its condition rendered as a
// string.
interface TransactionItem {
  entity: string;
  op: 'check' | 'update' | 'patch' | 'create';
  key?: Record<string, unknown>;
  data?: Record<string, unknown>;
  set?: Record<string, unknown>;
  add?: Record<string, unknown>;
  condition?: string;
}

const attr = new Proxy({}, { get: (_, name) => name });
const ops = {
  eq: (name: string, value: unknown) => `${name} = ${value}`,
  ne: (name: string, value: unknown) => `${name} <> ${value}`,
  lte: (name: string, value: unknown) => `${name} <= ${value}`,
  exists: (name: string) => `exists(${name})`,
  notExists: (name: string) => `notExists(${name})`,
};

const transactionEntity = (entity: string) => {
  const chain = (item: TransactionItem) => ({
    set: (set: Record<string, unknown>) => chain({ ...item, set }),
    add: (add: Record<string, unknown>) => chain({ ...item, add }),
    where: (build: (a: unknown, o: typeof ops) => string) =>
      chain({ ...item, condition: build(attr, ops) }),
    commit: () => item,
  });
  return {
    check: (key: Record<string, unknown>) =>
      chain({ entity, op: 'check', key }),
    update: (key: Record<string, unknown>) =>
      chain({ entity, op: 'update', key }),
    patch: (key: Record<string, unknown>) =>
      chain({ entity, op: 'patch', key }),
    create: (data: Record<string, unknown>) =>
      chain({ entity, op: 'create', data }),
  };
};

// `db[name]` may be a function, for a record that changes between reads.
const stored = (name: string) => ({
  get: vi.fn(() => ({
    go: vi.fn(async () => {
      const value = db[name];
      return { data: (typeof value === 'function' ? value() : value) ?? null };
    }),
  })),
});

const entities = {
  course: stored('course'),
  module: stored('module'),
  lesson: stored('lesson'),
  contentItem: stored('contentItem'),
  enrolment: stored('enrolment'),
  assignmentSubmission: stored('assignmentSubmission'),
  itemCompletion: stored('itemCompletion'),
};

const transactions: TransactionItem[][] = [];

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities,
    transaction: {
      write: (build: (e: unknown) => TransactionItem[]) => {
        transactions.push(
          build(
            Object.fromEntries(
              [
                'course',
                'module',
                'lesson',
                'contentItem',
                'enrolment',
                'assignmentSubmission',
                'itemCompletion',
              ].map((name) => [name, transactionEntity(name)]),
            ),
          ),
        );
        return { go: transactionGo };
      },
    },
  })),
}));

vi.mock(
  '@discava/common-server-utils/lesson-files',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@discava/common-server-utils/lesson-files')
    >()),
    headLessonFileUpload: headUpload,
    presignLessonFileUpload: presign,
    copyLessonFileUploadTo: copyTo,
    deleteLessonMediaFolder: deleteFolder,
  }),
);

vi.mock('@discava/common-server-utils/cleanup-scheduler', () => ({
  scheduleTranscodeCleanupOrThrow: scheduleOrThrow,
  scheduleTranscodeCleanup: schedule,
}));

const router = t.router({ uploadUrl, submit });
const caller = t.createCallerFactory(router);

const USER_SUB = 'student-1';

const callAs = (sub?: string) =>
  caller({
    event: {
      requestContext: { authorizer: { claims: sub ? { sub } : {} } },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};
const ITEM_PREFIX = `courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/`;
const UPLOAD_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_KEY = `${ITEM_PREFIX}submissions/${USER_SUB}/${UPLOAD_ID}/My-Essay.pdf`;
const MB = 1024 * 1024;

const submitInput = (overrides: Record<string, unknown> = {}) => ({
  ...ref,
  objectKey: OBJECT_KEY,
  fileName: 'My Essay.pdf',
  ...overrides,
});

const itemOf = (transaction: TransactionItem[], entity: string) =>
  transaction.find((item) => item.entity === entity)!;

const cancelledWith = (codes: string[]) => ({
  canceled: true,
  data: codes.map((code) => ({ code })),
});

const folderOfCopy = () => {
  const [, target] = copyTo.mock.calls[0]!;
  return (target as string).slice(0, (target as string).lastIndexOf('/') + 1);
};

beforeEach(() => {
  vi.clearAllMocks();
  transactions.length = 0;
  for (const key of Object.keys(db)) {
    delete db[key];
  }
  db.course = { courseId: 'course-1', title: 'AWS', status: 'published' };
  db.module = { ...ref, visibility: 'visible' };
  db.lesson = { ...ref, visibility: 'visible', kind: 'assignment' };
  db.contentItem = {
    ...ref,
    type: 'assignment',
    visibility: 'visible',
    studentActivityCount: 0,
    maxPoints: 10,
  };
  db.enrolment = {
    courseId: 'course-1',
    userId: USER_SUB,
    status: 'active',
    progressPercent: 0,
  };
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  scheduleOrThrow.mockResolvedValue(undefined);
  schedule.mockResolvedValue(undefined);
  deleteFolder.mockResolvedValue(undefined);
  copyTo.mockResolvedValue(undefined);
  presign.mockResolvedValue({
    uploadUrl: 'https://upload.example/put',
    headers: { 'Content-Type': 'application/pdf' },
  });
  headUpload.mockResolvedValue({
    contentType: 'application/pdf',
    contentLength: 2048,
  });
});

describe('uploadUrl', () => {
  const input = { ...ref, fileName: 'My Essay.pdf', fileSize: 2048 };

  it('rejects unauthenticated callers', async () => {
    await expect(callAs().uploadUrl(input)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('presigns one PUT bound to the type and exact length, under the student’s folder', async () => {
    const result = await callAs(USER_SUB).uploadUrl(input);

    expect(result.uploadUrl).toBe('https://upload.example/put');
    expect(result.objectKey).toMatch(
      new RegExp(
        `^${ITEM_PREFIX}submissions/${USER_SUB}/[0-9a-f-]{36}/My-Essay\\.pdf$`,
      ),
    );
    expect(presign).toHaveBeenCalledWith(
      result.objectKey,
      'application/pdf',
      2048,
    );
  });

  it('refuses a student who isn’t enrolled', async () => {
    delete db.enrolment;
    await expect(callAs(USER_SUB).uploadUrl(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it.each([
    ['a hidden assignment', () => (db.contentItem.visibility = 'hidden')],
    [
      'an archived assignment',
      () => (db.contentItem.archivedAt = '2026-01-01T00:00:00.000Z'),
    ],
    ['a hidden lesson', () => (db.lesson.visibility = 'hidden')],
    ['an item that isn’t an assignment', () => (db.contentItem.type = 'text')],
  ])('refuses %s: NOT_FOUND', async (_label, change) => {
    change();
    await expect(callAs(USER_SUB).uploadUrl(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an archived course: PRECONDITION_FAILED', async () => {
    db.course.status = 'archived';
    await expect(callAs(USER_SUB).uploadUrl(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('refuses once the submission was returned: PRECONDITION_FAILED', async () => {
    db.assignmentSubmission = { status: 'returned', version: 1 };
    await expect(callAs(USER_SUB).uploadUrl(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('refuses a type that isn’t allowed, listing the allowed ones: BAD_REQUEST', async () => {
    await expect(
      callAs(USER_SUB).uploadUrl({ ...input, fileName: 'run.exe' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('pdf'),
    });
    expect(presign).not.toHaveBeenCalled();
  });

  it.each([
    ['over 100 MB', 100 * MB + 1],
    ['empty', 0],
  ])('refuses a file that is %s: BAD_REQUEST', async (_label, fileSize) => {
    await expect(
      callAs(USER_SUB).uploadUrl({ ...input, fileSize }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(presign).not.toHaveBeenCalled();
  });

  it('accepts a file of exactly 100 MB', async () => {
    await expect(
      callAs(USER_SUB).uploadUrl({ ...input, fileSize: 100 * MB }),
    ).resolves.toMatchObject({ uploadUrl: 'https://upload.example/put' });
  });
});

describe('submit (first submission)', () => {
  const submitNow = () => callAs(USER_SUB).submit(submitInput());

  it('rejects unauthenticated callers', async () => {
    await expect(callAs().submit(submitInput())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('stores one file and returns the submission, with no key', async () => {
    const result = await submitNow();

    expect(result).toEqual({
      version: 1,
      status: 'submitted',
      submittedAt: expect.any(String),
      late: false,
      file: {
        fileName: 'My Essay.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
      },
    });
    expect(JSON.stringify(result)).not.toContain('submissions/');
  });

  it('counts the student once and writes the submission and completion in one transaction', async () => {
    const result = await submitNow();

    expect(transactions).toHaveLength(1);
    const [transaction] = transactions;
    expect(itemOf(transaction, 'contentItem')).toMatchObject({
      op: 'update',
      add: { studentActivityCount: 1 },
    });
    expect(itemOf(transaction, 'assignmentSubmission')).toMatchObject({
      op: 'create',
      data: expect.objectContaining({
        userId: USER_SUB,
        version: 1,
        status: 'submitted',
        submittedAt: result.submittedAt,
        late: false,
      }),
    });
    expect(itemOf(transaction, 'itemCompletion')).toMatchObject({
      op: 'create',
      data: expect.objectContaining({
        userId: USER_SUB,
        completedAt: result.submittedAt,
      }),
    });
  });

  it('puts the file under a folder of this request, copied once', async () => {
    await submitNow();

    expect(copyTo).toHaveBeenCalledTimes(1);
    expect(copyTo).toHaveBeenCalledWith(
      OBJECT_KEY,
      expect.stringMatching(
        new RegExp(
          `^${ITEM_PREFIX}submissions/${USER_SUB}/[0-9a-f-]{36}/My-Essay\\.pdf$`,
        ),
      ),
      { contentType: 'application/pdf', fileName: 'My Essay.pdf' },
    );
    const stored = itemOf(transactions[0], 'assignmentSubmission').data!
      .file as { key: string };
    expect(stored.key).toBe(copyTo.mock.calls[0]![1]);
    expect(deleteFolder).not.toHaveBeenCalled();
  });

  it('schedules the attempt guard before copying anything', async () => {
    await submitNow();

    const folder = folderOfCopy();
    expect(scheduleOrThrow).toHaveBeenCalledWith(
      {
        ...ref,
        submissionNonce: folder.slice(ITEM_PREFIX.length, -1),
      },
      60,
      expect.objectContaining({
        keepIfCurrentFor: USER_SUB,
        purpose: 'attempt',
        localDelaySeconds: 60,
      }),
    );
    expect(scheduleOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
      copyTo.mock.invocationCallOrder[0]!,
    );
  });

  it('stops with INTERNAL_SERVER_ERROR before copying when the guard can’t be scheduled', async () => {
    scheduleOrThrow.mockRejectedValue(new Error('scheduler down'));

    await expect(submitNow()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(copyTo).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
  });

  describe('late', () => {
    const due = '2026-11-14T09:00:00.000Z';

    afterEach(() => vi.useRealTimers());

    it('is false at exactly the due date', async () => {
      vi.useFakeTimers({ now: new Date(due), toFake: ['Date'] });
      db.contentItem.dueAt = due;
      await expect(submitNow()).resolves.toMatchObject({ late: false });
    });

    it('is true after it', async () => {
      vi.useFakeTimers({
        now: new Date('2026-11-14T09:00:01.000Z'),
        toFake: ['Date'],
      });
      db.contentItem.dueAt = due;
      await expect(submitNow()).resolves.toMatchObject({ late: true });
      expect(
        itemOf(transactions[0], 'assignmentSubmission').data,
      ).toMatchObject({ late: true });
    });

    it('is never true without a due date', async () => {
      await expect(submitNow()).resolves.toMatchObject({ late: false });
    });

    it('follows the activity time when the enrolment’s last activity is ahead of the clock', async () => {
      vi.useFakeTimers({
        now: new Date('2026-11-14T08:00:00.000Z'),
        toFake: ['Date'],
      });
      db.contentItem.dueAt = due;
      db.enrolment.lastActivityAt = '2026-11-14T09:30:00.000Z';

      const result = await submitNow();

      expect(result).toMatchObject({
        late: true,
        submittedAt: '2026-11-14T09:30:00.000Z',
      });
    });
  });

  describe('refuses', () => {
    it('a student who isn’t enrolled', async () => {
      delete db.enrolment;
      await expect(submitNow()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(copyTo).not.toHaveBeenCalled();
    });

    it.each([
      ['hidden', () => (db.contentItem.visibility = 'hidden')],
      [
        'archived',
        () => (db.contentItem.archivedAt = '2026-01-01T00:00:00.000Z'),
      ],
      [
        'under an archived module',
        () => (db.module.archivedAt = '2026-01-01T00:00:00.000Z'),
      ],
    ])('an assignment that is %s: NOT_FOUND', async (_label, change) => {
      change();
      await expect(submitNow()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(copyTo).not.toHaveBeenCalled();
    });

    it('an archived course: PRECONDITION_FAILED', async () => {
      db.course.status = 'archived';
      await expect(submitNow()).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });

    it('a returned submission: PRECONDITION_FAILED', async () => {
      db.assignmentSubmission = { status: 'returned', version: 1 };
      await expect(submitNow()).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });
  });

  describe('BAD_REQUEST for', () => {
    const refused = async (input: Record<string, unknown>) => {
      await expect(
        callAs(USER_SUB).submit(submitInput(input)),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(scheduleOrThrow).not.toHaveBeenCalled();
      expect(copyTo).not.toHaveBeenCalled();
      expect(transactions).toHaveLength(0);
    };

    it('a type that isn’t allowed', () =>
      refused({
        fileName: 'run.exe',
        objectKey: `${ITEM_PREFIX}submissions/${USER_SUB}/${UPLOAD_ID}/run.exe`,
      }));

    it('a key issued for another student', () =>
      refused({
        objectKey: `${ITEM_PREFIX}submissions/someone-else/${UPLOAD_ID}/My-Essay.pdf`,
      }));

    it('a key issued for another item', () =>
      refused({
        objectKey: `courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-2/submissions/${USER_SUB}/${UPLOAD_ID}/My-Essay.pdf`,
      }));

    it('a key that is not an upload’s at all', () =>
      refused({ objectKey: `${ITEM_PREFIX}anything.pdf` }));

    it('a key issued for another file name', () =>
      refused({ fileName: 'Other.pdf' }));

    it('an upload that does not exist', async () => {
      headUpload.mockResolvedValue(undefined);
      await refused({});
    });

    it('an upload of another type than its name allows', async () => {
      headUpload.mockResolvedValue({
        contentType: 'application/zip',
        contentLength: 10,
      });
      await refused({});
    });

    it.each([
      ['empty', 0],
      ['over 100 MB', 100 * MB + 1],
    ])('an upload that is %s', async (_label, contentLength) => {
      headUpload.mockResolvedValue({
        contentType: 'application/pdf',
        contentLength,
      });
      await refused({});
    });
  });

  describe('a transaction that is cancelled', () => {
    it('retries with the same copy when an unrelated write got in the way', async () => {
      transactionGo
        .mockResolvedValueOnce(
          cancelledWith([
            'None',
            'None',
            'None',
            'None',
            'ConditionalCheckFailed',
          ]),
        )
        .mockResolvedValueOnce({ canceled: false, data: [] });

      await expect(submitNow()).resolves.toMatchObject({ version: 1 });

      expect(transactions).toHaveLength(2);
      expect(copyTo).toHaveBeenCalledTimes(1);
      expect(scheduleOrThrow).toHaveBeenCalledTimes(1);
      expect(deleteFolder).not.toHaveBeenCalled();
    });

    it('is a CONFLICT, deleting its folder, when another request submitted first', async () => {
      transactionGo.mockResolvedValue(
        cancelledWith([
          'None',
          'None',
          'None',
          'None',
          'None',
          'ConditionalCheckFailed',
        ]),
      );
      // The re-read finds a submission that wasn't there.
      let reads = 0;
      db.assignmentSubmission = () =>
        reads++ < 1 ? undefined : { status: 'submitted', version: 1 };

      await expect(submitNow()).rejects.toMatchObject({ code: 'CONFLICT' });

      expect(transactions).toHaveLength(1);
      expect(deleteFolder).toHaveBeenCalledWith(
        expect.anything(),
        folderOfCopy(),
      );
    });

    it('gives the precise error when the course was archived meanwhile', async () => {
      transactionGo.mockResolvedValue(
        cancelledWith(['ConditionalCheckFailed']),
      );
      let reads = 0;
      db.course = () => ({
        courseId: 'course-1',
        status: reads++ < 1 ? 'published' : 'archived',
      });

      await expect(submitNow()).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      expect(deleteFolder).toHaveBeenCalledWith(
        expect.anything(),
        folderOfCopy(),
      );
    });

    it('is a CONFLICT, deleting its folder, after three cancelled tries', async () => {
      transactionGo.mockResolvedValue(
        cancelledWith([
          'None',
          'None',
          'None',
          'None',
          'ConditionalCheckFailed',
        ]),
      );

      await expect(submitNow()).rejects.toMatchObject({ code: 'CONFLICT' });

      expect(transactions).toHaveLength(3);
      expect(copyTo).toHaveBeenCalledTimes(1);
      expect(deleteFolder).toHaveBeenCalledWith(
        expect.anything(),
        folderOfCopy(),
      );
    });

    it('is an INTERNAL_SERVER_ERROR for any other cancellation, deleting its folder', async () => {
      transactionGo.mockResolvedValue(cancelledWith(['ValidationError']));

      await expect(submitNow()).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
      });
      expect(deleteFolder).toHaveBeenCalledWith(
        expect.anything(),
        folderOfCopy(),
      );
    });
  });

  it('deletes its folder when the copy fails', async () => {
    copyTo.mockRejectedValue(new Error('S3 down'));

    await expect(submitNow()).rejects.toThrow();
    expect(deleteFolder).toHaveBeenCalledTimes(1);
    expect(transactions).toHaveLength(0);
  });

  it('counts a student a completion already counted only once, writing no second completion', async () => {
    db.itemCompletion = {
      userId: USER_SUB,
      ...ref,
      completedAt: '2026-01-01T00:00:00.000Z',
    };

    await submitNow();

    const [transaction] = transactions;
    expect(itemOf(transaction, 'contentItem').op).toBe('check');
    expect(itemOf(transaction, 'itemCompletion').op).toBe('check');
  });
});
