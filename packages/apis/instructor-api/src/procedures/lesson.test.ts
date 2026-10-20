/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { createLesson, deleteLesson, updateLesson } from './lesson.js';

const {
  courseGet,
  courseInstructorGet,
  moduleGet,
  lessonQueryPrimary,
  lessonCreate,
  lessonGet,
  lessonPatch,
  lessonPatchSet,
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
  moduleGet: vi.fn(),
  lessonQueryPrimary: vi.fn(),
  lessonCreate: vi.fn(),
  lessonGet: vi.fn(),
  lessonPatch: vi.fn(),
  lessonPatchSet: vi.fn(),
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
        get: moduleGet,
      },
      lesson: {
        query: {
          primary: lessonQueryPrimary,
        },
        create: lessonCreate,
        get: lessonGet,
        patch: lessonPatch,
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
// these tests can assert lesson.ts calls it correctly.
vi.mock('../lib/mediaconvert-client.js', () => ({
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({ createLesson, updateLesson, deleteLesson });
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
  lessonId: lesson.lessonId,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'video' as const,
  title: 'Intro video',
  s3Key: `lessons/${lesson.lessonId}/content-item-1.mp4`,
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
  moduleGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: module }),
  });
  lessonQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  // Creates and edits are written in a transaction (behind a check that
  // the module is still active), so their chains end in .commit().
  lessonCreate.mockReturnValue({ commit: () => ({}) });
  lessonGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: lesson }),
  });
  lessonPatchSet.mockReturnValue({
    where: () => ({ commit: () => ({}) }),
  });
  lessonPatch.mockReturnValue({ set: lessonPatchSet });
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
        check: () => ({ where: () => ({ commit: () => ({}) }) }),
      },
      lesson: {
        create: lessonCreate,
        patch: lessonPatch,
        delete: lessonDelete,
      },
      contentItem: { delete: contentItemDelete },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('createLesson', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        title: 'Welcome',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  // Invariant: only an instructor who actually teaches the course may add
  // lessons to it -- membership in the `instructor` group is not enough.
  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        title: 'Welcome',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(moduleGet).not.toHaveBeenCalled();
    expect(lessonCreate).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the module does not exist', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createLesson({
        courseId: COURSE_ID,
        moduleId: 'missing-module',
        title: 'Welcome',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(lessonQueryPrimary).not.toHaveBeenCalled();
    expect(lessonCreate).not.toHaveBeenCalled();
  });

  it('starts at order 1 for the first lesson in a module', async () => {
    await callAs().createLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      title: 'Welcome',
    });

    expect(lessonQueryPrimary).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
    });
    expect(lessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        title: 'Welcome',
        order: 1,
      }),
    );
  });

  // Invariant: new lessons append to the end of their module, never
  // colliding with or reordering existing ones, even if orders have gaps.
  it('appends after the highest existing order, not the lesson count', async () => {
    lessonQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { ...lesson, lessonId: 'lesson-1', order: 1 },
          { ...lesson, lessonId: 'lesson-5', order: 5 },
        ],
      }),
    });

    await callAs().createLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      title: 'New lesson',
    });

    expect(lessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ order: 6 }),
    );
  });

  it('returns the created lesson', async () => {
    const result = await callAs().createLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      title: 'Welcome',
    });
    expect(result).toEqual(lesson);
  });

  it('passes the description through to the created lesson', async () => {
    await callAs().createLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      title: 'Welcome',
      description: 'A quick tour of the course',
    });

    expect(lessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'A quick tour of the course' }),
    );
  });
});

describe('updateLesson', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).updateLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: lesson.lessonId,
        title: 'Updated title',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  // Invariant: only an instructor who actually teaches the course may edit
  // its lessons -- membership in the `instructor` group is not enough.
  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().updateLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: lesson.lessonId,
        title: 'Updated title',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(lessonGet).not.toHaveBeenCalled();
    expect(lessonPatch).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the lesson does not exist', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().updateLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: 'missing-lesson',
        title: 'Updated title',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(lessonPatch).not.toHaveBeenCalled();
  });

  it('only patches fields provided in the input', async () => {
    await callAs().updateLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
      title: 'Updated title',
    });

    expect(lessonPatch).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
    });
    expect(lessonPatchSet).toHaveBeenCalledWith({ title: 'Updated title' });
  });

  it('patches title and description together when both are provided', async () => {
    await callAs().updateLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
      title: 'Updated title',
      description: 'Updated description',
    });

    expect(lessonPatchSet).toHaveBeenCalledWith({
      title: 'Updated title',
      description: 'Updated description',
    });
  });

  // The transaction returns no attributes, so the lesson is read back.
  it('returns the updated lesson', async () => {
    const updatedLesson = { ...lesson, title: 'Updated title' };
    lessonGet
      .mockReturnValueOnce({ go: vi.fn().mockResolvedValue({ data: lesson }) })
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({ data: updatedLesson }),
      });

    const result = await callAs().updateLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
      title: 'Updated title',
    });
    expect(result).toEqual(updatedLesson);
  });
});

describe('deleteLesson', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).deleteLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: lesson.lessonId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  // Invariant: only an instructor who actually teaches the course may
  // delete its lessons -- membership in the `instructor` group is not
  // enough.
  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().deleteLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: lesson.lessonId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(lessonGet).not.toHaveBeenCalled();
    expect(lessonDelete).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the lesson does not exist', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().deleteLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: 'missing-lesson',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(contentItemQueryPrimary).not.toHaveBeenCalled();
    expect(lessonDelete).not.toHaveBeenCalled();
  });

  it('deletes a lesson the caller teaches and returns it', async () => {
    const result = await callAs().deleteLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
    });

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(lessonDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
    });
    expect(result).toEqual(lesson);
  });

  it('throws INTERNAL_SERVER_ERROR when the transaction is canceled for a reason other than a stale content item', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'ThrottlingError' }],
    });

    await expect(
      callAs().deleteLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: lesson.lessonId,
      }),
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
      callAs().deleteLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: lesson.lessonId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
  });

  it('conditions each content item delete on updatedAt still matching what was just queried, and on no student activity', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [contentItem] }),
    });

    await callAs().deleteLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
    });

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

  // DynamoDB transactions cap at 100 items; a lesson with too many content
  // items can't be cascade-deleted in one, so this must fail fast rather
  // than let DynamoDB reject the oversized transaction.
  it('throws PRECONDITION_FAILED without attempting a transaction when the lesson has too many content items', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: Array.from({ length: 100 }, (_, i) => ({
          ...contentItem,
          contentItemId: `content-item-${i}`,
        })),
      }),
    });

    await expect(
      callAs().deleteLesson({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: lesson.lessonId,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  // Invariant: content items have no lifecycle independent of their
  // lesson, so deleting a lesson must cascade to every content item under
  // it and best-effort-delete each one's underlying video.
  it('cascades to delete every content item under the lesson and their videos', async () => {
    const contentItem2 = {
      ...contentItem,
      contentItemId: 'content-item-2',
      s3Key: `lessons/${lesson.lessonId}/content-item-2.mp4`,
    };
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [contentItem, contentItem2] }),
    });

    await callAs().deleteLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
    });

    expect(contentItemQueryPrimary).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
    });
    expect(contentItemDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
      contentItemId: contentItem.contentItemId,
    });
    expect(contentItemDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
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

  it('does not attempt to delete any content items when the lesson has none', async () => {
    await callAs().deleteLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
    });

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
  // lesson (and content item) is gone -- see the mediaConvertJobId design
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

    await callAs().deleteLesson({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: lesson.lessonId,
    });

    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [pendingContentItem],
    );
  });
});
