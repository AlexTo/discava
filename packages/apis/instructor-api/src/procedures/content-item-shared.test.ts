/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { bestEffortRetirePreviousVersions } from '../lib/s3-client.js';
import { deleteContentItem } from './content-item-shared.js';

const {
  courseGet,
  courseInstructorGet,
  contentItemGet,
  contentItemDelete,
  contentItemDeleteWhere,
  courseCheck,
  transactionWrite,
  transactionGo,
  bestEffortDeleteContentItemVideos,
  bestEffortCancelTranscodeJobs,
} = vi.hoisted(() => ({
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  contentItemGet: vi.fn(),
  contentItemDelete: vi.fn(),
  contentItemDeleteWhere: vi.fn(),
  courseCheck: vi.fn(),
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
      contentItem: {
        get: contentItemGet,
        delete: contentItemDelete,
      },
    },
    transaction: { write: transactionWrite },
  })),
}));

// bestEffortDeleteContentItemVideos's own error-swallowing/bucket-selection
// behavior is covered directly in lib/s3-client.test.ts; here it's just a
// mock so these tests can assert content-item-shared.ts calls it correctly.
vi.mock('../lib/s3-client.js', () => ({
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions: vi.fn(async () => {}),
}));

// bestEffortCancelTranscodeJobs's own status/job-id filtering is covered
// directly in lib/mediaconvert-client.test.ts; here it's just a mock so
// these tests can assert content-item-shared.ts calls it correctly.
vi.mock('../lib/mediaconvert-client.js', () => ({
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({ deleteContentItem });
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const videoContentItem = {
  contentItemId: CONTENT_ITEM_ID,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'video' as const,
  status: 'ready' as const,
  title: 'Intro video',
  s3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}.mp4`,
  mimeType: 'video/mp4',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const textContentItem = {
  contentItemId: CONTENT_ITEM_ID,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'text' as const,
  status: 'ready' as const,
  title: 'Welcome notes',
  body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
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
  contentItemGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: videoContentItem }),
  });
  // The delete runs in a transaction with a check that the course is still a
  // draft, conditioned on the item still being as it was read.
  contentItemDelete.mockReturnValue({ where: contentItemDeleteWhere });
  contentItemDeleteWhere.mockReturnValue({ commit: () => ({}) });
  courseCheck.mockReturnValue({ where: () => ({ commit: () => ({}) }) });
  transactionWrite.mockImplementation((build) => {
    build({
      contentItem: { delete: contentItemDelete },
      course: { check: courseCheck },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  bestEffortDeleteContentItemVideos.mockResolvedValue(undefined);
  bestEffortCancelTranscodeJobs.mockResolvedValue(undefined);
});

describe('deleteContentItem', () => {
  const input = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).deleteContentItem(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the content item does not exist', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().deleteContentItem(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(contentItemDelete).not.toHaveBeenCalled();
  });

  it('deletes a video content item and its S3 object', async () => {
    const result = await callAs().deleteContentItem(input);

    expect(contentItemDelete).toHaveBeenCalledWith(input);
    expect(courseCheck).toHaveBeenCalledWith({ courseId: COURSE_ID });
    expect(bestEffortDeleteContentItemVideos).toHaveBeenCalledWith(
      expect.anything(),
      [videoContentItem],
    );
    // And the version it was keeping playable while being replaced (#209).
    expect(bestEffortRetirePreviousVersions).toHaveBeenCalledWith(
      expect.anything(),
      [videoContentItem],
    );
    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [videoContentItem],
    );
    expect(result).toEqual(videoContentItem);
  });

  // A still-transcoding video's job has nothing left to report to once its
  // content item is gone -- see the mediaConvertJobId design in #123.
  it('cancels an in-flight transcode job when deleting a still-pending video', async () => {
    const pendingVideoContentItem = {
      ...videoContentItem,
      status: 'pending' as const,
      mediaConvertJobId: 'job-1',
    };
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: pendingVideoContentItem }),
    });

    await callAs().deleteContentItem(input);

    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [pendingVideoContentItem],
    );
  });

  // A concurrent replacement can land between the initial read and the
  // delete. A transaction returns no deleted attributes to clean up from, so
  // the delete is conditioned on the item still being as it was read, and
  // cleans up nothing otherwise.
  it('conditions the delete on the item still being as it was read', async () => {
    await callAs().deleteContentItem(input);

    const condition = contentItemDeleteWhere.mock.calls[0][0] as (
      attr: Record<string, string>,
      op: Record<string, (...args: string[]) => string>,
    ) => string;
    expect(
      condition(
        { updatedAt: 'updatedAt' },
        { eq: (attribute, value) => `${attribute} = ${value}` },
      ),
    ).toBe(`updatedAt = ${videoContentItem.updatedAt}`);
  });

  it('refuses with CONFLICT and cleans up nothing when the item changed after it was read', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'ConditionalCheckFailed' }, {}],
    });

    await expect(callAs().deleteContentItem(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  // Invariant: the delete is permanent only while the course is a draft. A
  // publish that lands after the status read must not turn it into a
  // permanent delete in a course students can see.
  it('is guarded by the course still being a draft', async () => {
    const whereSpy = vi.fn().mockReturnValue({ commit: () => ({}) });
    courseCheck.mockReturnValue({ where: whereSpy });

    await callAs().deleteContentItem(input);

    const condition = whereSpy.mock.calls[0][0] as (
      attr: Record<string, string>,
      op: Record<string, (...args: string[]) => string>,
    ) => string;
    expect(
      condition(
        { status: 'status' },
        { eq: (attribute, value) => `${attribute} = ${value}` },
      ),
    ).toBe('status = draft');
  });

  it('refuses once the course is published, and cleans up nothing', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{}, { code: 'ConditionalCheckFailed' }],
    });

    await expect(callAs().deleteContentItem(input)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('was published'),
    });
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it('deletes a text content item without attempting an S3 cleanup or job cancellation', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: textContentItem }),
    });

    const result = await callAs().deleteContentItem(input);

    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
    expect(result).toEqual(textContentItem);
  });
});
