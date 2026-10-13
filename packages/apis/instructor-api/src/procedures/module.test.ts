/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { createModule, deleteModule, updateModule } from './module.js';

const {
  courseGet,
  courseInstructorGet,
  moduleQueryPrimary,
  moduleCreate,
  moduleGet,
  moduleDelete,
  modulePatch,
  modulePatchSet,
  lessonQueryPrimary,
  lessonDelete,
  contentItemQueryPrimary,
  contentItemDelete,
  contentItemDeleteWhere,
  transactionWrite,
  transactionGo,
  bestEffortDeleteContentItemVideos,
  bestEffortCancelTranscodeJobs,
} = vi.hoisted(() => ({
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  moduleQueryPrimary: vi.fn(),
  moduleCreate: vi.fn(),
  moduleGet: vi.fn(),
  moduleDelete: vi.fn(),
  modulePatch: vi.fn(),
  modulePatchSet: vi.fn(),
  lessonQueryPrimary: vi.fn(),
  lessonDelete: vi.fn(),
  contentItemQueryPrimary: vi.fn(),
  contentItemDelete: vi.fn(),
  contentItemDeleteWhere: vi.fn(),
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  bestEffortDeleteContentItemVideos: vi.fn(),
  bestEffortCancelTranscodeJobs: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: {
        get: courseInstructorGet,
      },
      module: {
        query: {
          primary: moduleQueryPrimary,
        },
        create: moduleCreate,
        get: moduleGet,
        delete: moduleDelete,
        patch: modulePatch,
      },
      lesson: {
        query: {
          primary: lessonQueryPrimary,
        },
        delete: lessonDelete,
      },
      contentItem: {
        query: {
          primary: contentItemQueryPrimary,
        },
        delete: contentItemDelete,
      },
    },
    transaction: {
      write: transactionWrite,
    },
  })),
}));

vi.mock('../lib/s3-client.js', () => ({ bestEffortDeleteContentItemVideos }));

// bestEffortCancelTranscodeJobs's own status/job-id filtering is covered
// directly in lib/mediaconvert-client.test.ts; here it's just a mock so
// these tests can assert module.ts calls it correctly.
vi.mock('../lib/mediaconvert-client.js', () => ({
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({ createModule, updateModule, deleteModule });
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const module = {
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: 'Introduction',
  order: 1,
  visibility: 'visible' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const lesson = {
  lessonId: 'lesson-1',
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: 'Welcome',
  order: 1,
  visibility: 'visible' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const contentItem = {
  contentItemId: 'content-item-1',
  lessonId: 'lesson-1',
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'video' as const,
  title: 'Intro video',
  s3Key: 'lessons/lesson-1/content-item-1.mp4',
  mimeType: 'video/mp4',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();

  // A draft course, so delete here is the permanent, cascading delete. What
  // changes outside a draft course (archive instead) is covered in
  // curriculum-lifecycle.test.ts.
  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { status: 'draft' } }),
  });

  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB },
    }),
  });
  moduleQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  moduleGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: module }),
  });
  moduleDelete.mockImplementation((attrs) => ({
    commit: () => ({ item: null, attrs }),
  }));
  lessonQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  lessonDelete.mockImplementation((attrs) => ({
    commit: () => ({ item: null, attrs }),
  }));
  contentItemQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  contentItemDeleteWhere.mockImplementation(() => ({
    commit: () => ({ item: null }),
  }));
  contentItemDelete.mockImplementation((attrs) => ({
    where: contentItemDeleteWhere,
    commit: () => ({ item: null, attrs }),
  }));
  bestEffortDeleteContentItemVideos.mockResolvedValue(undefined);
  bestEffortCancelTranscodeJobs.mockResolvedValue(undefined);
  transactionWrite.mockImplementation((fn) => {
    fn({
      course: {
        check: () => ({ where: () => ({ commit: () => ({}) }) }),
      },
      module: {
        create: moduleCreate,
        patch: modulePatch,
        delete: moduleDelete,
      },
      lesson: { delete: lessonDelete },
      contentItem: { delete: contentItemDelete },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  // Created and patched in a transaction behind a check on the course, so
  // the chains end in .commit(); the result is read back with get.
  moduleCreate.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: module }),
    commit: () => ({}),
  });
  // patch(key).set(values).where(notArchived).go()
  modulePatchSet.mockReturnValue({
    where: () => ({
      go: vi.fn().mockResolvedValue({ data: module }),
      commit: () => ({}),
    }),
  });
  modulePatch.mockReturnValue({ set: modulePatchSet });
});

describe('createModule', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createModule({ courseId: COURSE_ID, title: 'Intro' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  // Invariant: only an instructor who actually teaches the course may add
  // modules to it -- membership in the `instructor` group is not enough.
  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createModule({ courseId: COURSE_ID, title: 'Intro' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(moduleQueryPrimary).not.toHaveBeenCalled();
    expect(moduleCreate).not.toHaveBeenCalled();
  });

  it('starts at order 1 for the first module in a course', async () => {
    await callAs().createModule({ courseId: COURSE_ID, title: 'Intro' });

    expect(moduleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: COURSE_ID,
        title: 'Intro',
        order: 1,
      }),
    );
  });

  // Invariant: new modules append to the end, never colliding with or
  // reordering existing ones, even if orders have gaps.
  it('appends after the highest existing order, not the module count', async () => {
    moduleQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { ...module, moduleId: 'module-1', order: 1 },
          { ...module, moduleId: 'module-5', order: 5 },
        ],
      }),
    });

    await callAs().createModule({ courseId: COURSE_ID, title: 'New module' });

    expect(moduleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ order: 6 }),
    );
  });

  it('returns the created module', async () => {
    const result = await callAs().createModule({
      courseId: COURSE_ID,
      title: 'Introduction',
    });
    expect(result).toEqual(module);
  });

  it('passes the description through to the created module', async () => {
    await callAs().createModule({
      courseId: COURSE_ID,
      title: 'Introduction',
      description: 'A quick tour of the course',
    });

    expect(moduleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'A quick tour of the course' }),
    );
  });
});

describe('updateModule', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).updateModule({
        courseId: COURSE_ID,
        moduleId: module.moduleId,
        title: 'Updated title',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  // Invariant: only an instructor who actually teaches the course may edit
  // its modules -- membership in the `instructor` group is not enough.
  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().updateModule({
        courseId: COURSE_ID,
        moduleId: module.moduleId,
        title: 'Updated title',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(moduleGet).not.toHaveBeenCalled();
    expect(modulePatch).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the module does not exist', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().updateModule({
        courseId: COURSE_ID,
        moduleId: 'missing-module',
        title: 'Updated title',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(modulePatch).not.toHaveBeenCalled();
  });

  it('only patches fields provided in the input', async () => {
    await callAs().updateModule({
      courseId: COURSE_ID,
      moduleId: module.moduleId,
      title: 'Updated title',
    });

    expect(modulePatch).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: module.moduleId,
    });
    expect(modulePatchSet).toHaveBeenCalledWith({ title: 'Updated title' });
  });

  it('patches title, description, and order together when all are provided', async () => {
    await callAs().updateModule({
      courseId: COURSE_ID,
      moduleId: module.moduleId,
      title: 'Updated title',
      description: 'Updated description',
      order: 2,
    });

    expect(modulePatchSet).toHaveBeenCalledWith({
      title: 'Updated title',
      description: 'Updated description',
      order: 2,
    });
  });

  it('returns the updated module', async () => {
    const updatedModule = { ...module, title: 'Updated title' };
    // Transactions don't return the written attributes: the module is read
    // back after the update lands.
    moduleGet
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({ data: module }),
      })
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({ data: updatedModule }),
      });

    const result = await callAs().updateModule({
      courseId: COURSE_ID,
      moduleId: module.moduleId,
      title: 'Updated title',
    });
    expect(result).toEqual(updatedModule);
  });
});

describe('deleteModule', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).deleteModule({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  // Invariant: only an instructor who actually teaches the course may
  // delete its modules -- membership in the `instructor` group is not
  // enough.
  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(moduleGet).not.toHaveBeenCalled();
    expect(moduleDelete).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the module does not exist', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().deleteModule({
        courseId: COURSE_ID,
        moduleId: 'missing-module',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(lessonQueryPrimary).not.toHaveBeenCalled();
    expect(contentItemQueryPrimary).not.toHaveBeenCalled();
    expect(moduleDelete).not.toHaveBeenCalled();
  });

  it('deletes a module the caller teaches and returns it', async () => {
    const result = await callAs().deleteModule({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
    });

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(moduleDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
    });
    expect(result).toEqual(module);
  });

  it('throws INTERNAL_SERVER_ERROR when the transaction is canceled for a reason other than a stale content item', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'ThrottlingError' }],
    });

    await expect(
      callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });

  // A content item that changes between the query above and this
  // transaction -- most notably a transcode completing and publishing its
  // HLS output -- must not be deleted using cleanup data that's already
  // stale by the time the transaction runs.
  it('throws CONFLICT, not INTERNAL_SERVER_ERROR, when a content item changed since it was queried', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [contentItem] }),
    });
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'None' }, { code: 'ConditionalCheckFailed' }],
    });

    await expect(
      callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
  });

  it('conditions each content item delete on updatedAt still matching what was just queried, and on no student activity', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [contentItem] }),
    });

    await callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID });

    const [whereCallback] = contentItemDeleteWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const result = whereCallback(
      { updatedAt: 'updatedAt', studentActivityCount: 'studentActivityCount' },
      { eq },
    );

    expect(eq).toHaveBeenCalledWith('updatedAt', contentItem.updatedAt);
    expect(result).toBe(
      `updatedAt = ${contentItem.updatedAt} AND studentActivityCount = 0`,
    );
  });

  // DynamoDB transactions cap at 100 items; a module with too many lessons
  // can't be cascade-deleted in one, so this must fail fast rather than let
  // DynamoDB reject the oversized transaction.
  it('throws PRECONDITION_FAILED without attempting a transaction when the module has too many lessons', async () => {
    lessonQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: Array.from({ length: 100 }, (_, i) => ({
          ...lesson,
          lessonId: `lesson-${i}`,
        })),
      }),
    });

    await expect(
      callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  // Same cap, but tripped by content items instead of lessons -- both count
  // toward the same transaction.
  it('throws PRECONDITION_FAILED without attempting a transaction when the module has too many content items', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: Array.from({ length: 100 }, (_, i) => ({
          ...contentItem,
          contentItemId: `content-item-${i}`,
        })),
      }),
    });

    await expect(
      callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  // Invariant: lessons have no lifecycle independent of their module, so
  // deleting a module must cascade to every lesson under it.
  it('cascades to delete every lesson under the module', async () => {
    lessonQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { ...lesson, lessonId: 'lesson-1' },
          { ...lesson, lessonId: 'lesson-2' },
        ],
      }),
    });

    await callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID });

    expect(lessonQueryPrimary).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
    });
    expect(lessonDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: 'lesson-1',
    });
    expect(lessonDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: 'lesson-2',
    });
  });

  it('does not attempt to delete any lessons when the module has none', async () => {
    await callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID });

    expect(lessonDelete).not.toHaveBeenCalled();
  });

  // Invariant: content items have no lifecycle independent of their
  // module, so deleting a module must cascade to every content item under
  // it -- across every lesson in the module, not just one -- and best-
  // effort-delete each one's underlying video.
  it('cascades to delete every content item under the module and their videos', async () => {
    const contentItem2 = {
      ...contentItem,
      contentItemId: 'content-item-2',
      lessonId: 'lesson-2',
      s3Key: 'lessons/lesson-2/content-item-2.mp4',
    };
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [contentItem, contentItem2] }),
    });

    await callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID });

    expect(contentItemQueryPrimary).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
    });
    expect(contentItemDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: contentItem.lessonId,
      contentItemId: contentItem.contentItemId,
    });
    expect(contentItemDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: contentItem2.lessonId,
      contentItemId: contentItem2.contentItemId,
    });
    expect(bestEffortDeleteContentItemVideos).toHaveBeenCalledWith(
      expect.anything(),
      [contentItem, contentItem2],
    );
    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [contentItem, contentItem2],
    );
  });

  it('does not attempt to delete any content items when the module has none', async () => {
    await callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID });

    expect(contentItemDelete).not.toHaveBeenCalled();
    expect(bestEffortDeleteContentItemVideos).toHaveBeenCalledWith(
      expect.anything(),
      [],
    );
    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [],
    );
  });

  // A still-transcoding video's job has nothing left to report to once its
  // module (and content item) is gone -- see the mediaConvertJobId design
  // in #123.
  it('cancels in-flight transcode jobs for still-pending content items in the cascade', async () => {
    const pendingContentItem = {
      ...contentItem,
      status: 'pending' as const,
      mediaConvertJobId: 'job-1',
    };
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [pendingContentItem] }),
    });

    await callAs().deleteModule({ courseId: COURSE_ID, moduleId: MODULE_ID });

    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [pendingContentItem],
    );
  });
});
