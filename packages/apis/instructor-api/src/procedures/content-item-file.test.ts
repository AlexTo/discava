/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  createContentItemFile,
  createContentItemFileUploadUrl,
  createContentItemFileUrl,
  updateContentItemFile,
} from './content-item-file.js';

const {
  courseGet,
  courseInstructorGet,
  moduleGet,
  lessonGet,
  contentItemQueryPrimary,
  contentItemCreate,
  contentItemGet,
  contentItemPatch,
  contentItemPatchSet,
  contentItemPatchWhere,
  courseCheck,
  moduleCheck,
  lessonCheck,
  transactionWrite,
  s3Send,
  getSignedUrl,
  getSignedCloudFrontFileUrl,
  scheduleTranscodeCleanup,
} = vi.hoisted(() => ({
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  moduleGet: vi.fn(),
  lessonGet: vi.fn(),
  contentItemQueryPrimary: vi.fn(),
  contentItemCreate: vi.fn(),
  contentItemGet: vi.fn(),
  contentItemPatch: vi.fn(),
  contentItemPatchSet: vi.fn(),
  contentItemPatchWhere: vi.fn(),
  courseCheck: vi.fn(),
  moduleCheck: vi.fn(),
  lessonCheck: vi.fn(),
  transactionWrite: vi.fn(),
  s3Send: vi.fn(),
  getSignedUrl: vi.fn(),
  getSignedCloudFrontFileUrl: vi.fn(),
  scheduleTranscodeCleanup: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: { get: courseInstructorGet },
      module: { get: moduleGet },
      lesson: { get: lessonGet },
      contentItem: {
        query: { primary: contentItemQueryPrimary },
        create: contentItemCreate,
        get: contentItemGet,
        patch: contentItemPatch,
      },
    },
    transaction: { write: transactionWrite },
  })),
}));

// Each command is a plain object tagged with its name, so a test can tell
// what was sent. Function expressions, as they're constructed with `new`.
vi.mock('@aws-sdk/client-s3', () => {
  const command = (name: string) =>
    vi.fn(function (input) {
      return { command: name, ...input };
    });
  return {
    S3Client: vi.fn(),
    PutObjectCommand: command('PutObject'),
    HeadObjectCommand: command('HeadObject'),
    CopyObjectCommand: command('CopyObject'),
    DeleteObjectCommand: command('DeleteObject'),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }));

vi.mock('../lib/s3-client.js', () => ({
  getS3Client: () => ({ send: s3Send }),
  resolveLessonMediaBucketName: vi.fn(async () => MEDIA_BUCKET),
  resolveLessonMediaUploadBucketName: vi.fn(async () => UPLOAD_BUCKET),
}));

vi.mock('@discava/common-server-utils/lesson-media', () => ({
  getSignedCloudFrontFileUrl,
}));

vi.mock('../lib/transcode-cleanup-scheduler.js', () => ({
  scheduleTranscodeCleanup,
}));

const router = t.router({
  createContentItemFileUploadUrl,
  createContentItemFile,
  updateContentItemFile,
  createContentItemFileUrl,
});
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';
const UPLOAD_BUCKET = 'lesson-media-upload-bucket';
const MEDIA_BUCKET = 'lesson-media-bucket';
const OLD_UPLOAD_ID = '11111111-1111-4111-8111-111111111111';
const NEW_UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const PDF_SIZE = 2048;

const ITEM_PREFIX = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/`;
const OLD_KEY = `${ITEM_PREFIX}${OLD_UPLOAD_ID}/worksheet.pdf`;
const NEW_KEY = `${ITEM_PREFIX}${NEW_UPLOAD_ID}/Week-2-notes.pdf`;

const itemKey = {
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemId: CONTENT_ITEM_ID,
};

const conditionalCheckFailedError = (): Error =>
  Object.assign(new Error('The conditional request failed'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

// Gives a mocked ElectroDB chain the `.commit()` a transaction item needs,
// as content-item-video.test.ts does.
const committable = (chain: any): any => {
  if (chain === null || typeof chain !== 'object') {
    return chain;
  }
  return new Proxy(chain, {
    get(target, prop) {
      if (prop === 'commit') {
        return () => ({ run: () => target.go() });
      }
      const value = target[prop];
      return typeof value === 'function' && prop !== 'go'
        ? (...args: unknown[]) => committable(value.apply(target, args))
        : value;
    },
  });
};

const transactionEntities = {
  course: { check: (key: unknown) => committable(courseCheck(key)) },
  module: { check: (key: unknown) => committable(moduleCheck(key)) },
  lesson: { check: (key: unknown) => committable(lessonCheck(key)) },
  contentItem: {
    create: (item: unknown) => committable(contentItemCreate(item)),
    patch: (key: unknown) => committable(contentItemPatch(key)),
  },
};

const isConditionalCheckFailedError = (error: unknown) =>
  error instanceof Error &&
  error.cause instanceof Error &&
  error.cause.name === 'ConditionalCheckFailedException';

const fakeTransactionWrite = (
  build: (entities: typeof transactionEntities) => { run: () => unknown }[],
) => {
  const items = build(transactionEntities);
  return {
    go: async () => {
      const data: { code: string }[] = [];
      for (const item of items) {
        try {
          await item.run();
          data.push({ code: 'None' });
        } catch (error) {
          if (!isConditionalCheckFailedError(error)) {
            throw error;
          }
          data.push({ code: 'ConditionalCheckFailed' });
          return { canceled: true, data };
        }
      }
      return { canceled: false, data: [] };
    },
  };
};

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const lesson = {
  ...itemKey,
  title: 'Welcome',
  order: 1,
  visibility: 'visible' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const fileItem = {
  ...itemKey,
  type: 'file' as const,
  status: 'ready' as const,
  title: 'Worksheet',
  s3Key: OLD_KEY,
  submissionNonce: OLD_UPLOAD_ID,
  fileName: 'worksheet.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const sentCommands = (name: string) =>
  s3Send.mock.calls
    .map(([command]) => command)
    .filter((command) => command.command === name);

// What the upload bucket holds: the upload as the presigned PUT allowed it.
const uploaded = (contentType = 'application/pdf', contentLength = PDF_SIZE) =>
  s3Send.mockImplementation(async (command) =>
    command.command === 'HeadObject'
      ? { ContentType: contentType, ContentLength: contentLength }
      : {},
  );

beforeEach(() => {
  vi.clearAllMocks();

  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { status: 'draft' } }),
  });
  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB },
    }),
  });
  moduleGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { moduleId: MODULE_ID, visibility: 'visible' },
    }),
  });
  lessonGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: lesson }),
  });
  contentItemQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  contentItemCreate.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: fileItem }),
  });
  contentItemGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: fileItem }),
  });
  contentItemPatch.mockReturnValue({ set: contentItemPatchSet });
  contentItemPatchSet.mockReturnValue({ where: contentItemPatchWhere });
  contentItemPatchWhere.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: fileItem }),
  });
  courseCheck.mockReturnValue({
    where: () => ({ go: vi.fn().mockResolvedValue({}) }),
  });
  moduleCheck.mockReturnValue({
    where: () => ({ go: vi.fn().mockResolvedValue({}) }),
  });
  lessonCheck.mockReturnValue({
    where: () => ({ go: vi.fn().mockResolvedValue({}) }),
  });
  transactionWrite.mockImplementation(fakeTransactionWrite);
  uploaded();
  getSignedUrl.mockResolvedValue('https://example.com/signed-upload-url');
  getSignedCloudFrontFileUrl.mockResolvedValue(
    'https://example.cloudfront.net/signed-file-url',
  );
  scheduleTranscodeCleanup.mockResolvedValue(undefined);
});

describe('createContentItemFileUploadUrl', () => {
  const request = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    fileName: 'Week 2 notes.pdf',
    fileSize: PDF_SIZE,
  };

  it('rejects callers who are not in the instructor group', async () => {
    await expect(
      callAs([]).createContentItemFileUploadUrl(request),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: null }),
    });

    await expect(
      callAs().createContentItemFileUploadUrl(request),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses an archived lesson without minting an upload URL', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createContentItemFileUploadUrl(request),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the lesson before adding content to it',
    });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a file type that cannot be attached, naming the allowed ones', async () => {
    await expect(
      callAs().createContentItemFileUploadUrl({
        ...request,
        fileName: 'setup.exe',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('.pdf'),
    });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a file over the size limit', async () => {
    await expect(
      callAs().createContentItemFileUploadUrl({
        ...request,
        fileSize: 100 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  // Invariant: the upload can only be the type and size it was asked for,
  // so the item records what the bucket holds.
  it('presigns a PUT to the upload bucket held to the type and size', async () => {
    const result = await callAs().createContentItemFileUploadUrl(request);

    expect(result.objectKey).toMatch(
      new RegExp(
        `^courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${result.contentItemId}/[0-9a-f-]{36}/Week-2-notes\\.pdf$`,
      ),
    );
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      {
        command: 'PutObject',
        Bucket: UPLOAD_BUCKET,
        Key: result.objectKey,
        ContentType: 'application/pdf',
        ContentLength: PDF_SIZE,
      },
      expect.objectContaining({
        signableHeaders: new Set(['content-type', 'content-length']),
      }),
    );
    expect(result).toMatchObject({
      uploadUrl: 'https://example.com/signed-upload-url',
      headers: { 'Content-Type': 'application/pdf' },
    });
  });

  it('keeps the item id but mints a new folder when replacing a file', async () => {
    const first = await callAs().createContentItemFileUploadUrl({
      ...request,
      contentItemId: CONTENT_ITEM_ID,
    });
    const second = await callAs().createContentItemFileUploadUrl({
      ...request,
      contentItemId: CONTENT_ITEM_ID,
    });

    expect(first.contentItemId).toBe(CONTENT_ITEM_ID);
    expect(first.objectKey.startsWith(ITEM_PREFIX)).toBe(true);
    expect(second.objectKey).not.toBe(first.objectKey);
  });

  it('throws NOT_FOUND when replacing the file of an item that is not a file', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { ...fileItem, type: 'video' } }),
    });

    await expect(
      callAs().createContentItemFileUploadUrl({
        ...request,
        contentItemId: CONTENT_ITEM_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

describe('createContentItemFile', () => {
  const request = {
    ...itemKey,
    title: 'Week 2 notes',
    objectKey: NEW_KEY,
    fileName: 'Week 2 notes.pdf',
  };

  // Invariant: an item can only point at an upload issued for it, never at
  // another item's or course's file.
  it('refuses an upload key issued for another item', async () => {
    await expect(
      callAs().createContentItemFile({
        ...request,
        objectKey: NEW_KEY.replace(CONTENT_ITEM_ID, 'content-item-2'),
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'That upload is not for this file item',
    });
    expect(s3Send).not.toHaveBeenCalled();
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('refuses a file name the upload key was not issued for', async () => {
    await expect(
      callAs().createContentItemFile({ ...request, fileName: 'other.pdf' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('refuses when nothing was uploaded', async () => {
    s3Send.mockImplementation(async (command) => {
      if (command.command === 'HeadObject') {
        throw Object.assign(new Error('Not Found'), { name: 'NotFound' });
      }
      return {};
    });

    await expect(callAs().createContentItemFile(request)).rejects.toMatchObject(
      { code: 'BAD_REQUEST', message: 'Upload the file before saving it' },
    );
    expect(sentCommands('CopyObject')).toHaveLength(0);
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('refuses an upload of another type than its name says', async () => {
    uploaded('text/html');

    await expect(callAs().createContentItemFile(request)).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
    expect(sentCommands('CopyObject')).toHaveLength(0);
  });

  it('copies the upload into the lesson media bucket to download under its name', async () => {
    await callAs().createContentItemFile(request);

    expect(sentCommands('CopyObject')).toEqual([
      expect.objectContaining({
        Bucket: MEDIA_BUCKET,
        Key: NEW_KEY,
        CopySource: `${UPLOAD_BUCKET}/${NEW_KEY}`,
        MetadataDirective: 'REPLACE',
        ContentType: 'application/pdf',
        ContentDisposition: `attachment; filename="Week 2 notes.pdf"; filename*=UTF-8''Week%202%20notes.pdf`,
      }),
    ]);
  });

  it('records the file at the end of the lesson, with the size the bucket holds', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [{ order: 1 }, { order: 3 }] }),
    });

    await callAs().createContentItemFile(request);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ...itemKey,
        type: 'file',
        title: 'Week 2 notes',
        s3Key: NEW_KEY,
        submissionNonce: NEW_UPLOAD_ID,
        fileName: 'Week 2 notes.pdf',
        fileSize: PDF_SIZE,
        mimeType: 'application/pdf',
        order: 4,
        visibility: 'visible',
      }),
    );
  });

  it('adds the file hidden to a published course', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { status: 'published' } }),
    });

    await callAs().createContentItemFile(request);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'hidden' }),
    );
  });

  // Invariant: a copy no item points at is removed, as the lesson media
  // bucket never expires anything on its own.
  it('deletes the copy when the module is archived in the meantime', async () => {
    moduleCheck.mockReturnValue({
      where: () => ({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      }),
    });

    await expect(callAs().createContentItemFile(request)).rejects.toBeDefined();
    expect(sentCommands('DeleteObject')).toEqual([
      expect.objectContaining({ Bucket: MEDIA_BUCKET, Key: NEW_KEY }),
    ]);
  });
});

describe('updateContentItemFile', () => {
  it('renames the item without touching its file', async () => {
    await callAs().updateContentItemFile({ ...itemKey, title: 'Renamed' });

    expect(contentItemPatchSet).toHaveBeenCalledWith({ title: 'Renamed' });
    expect(s3Send).not.toHaveBeenCalled();
    expect(scheduleTranscodeCleanup).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND for an item that is not a file', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { ...fileItem, type: 'text' } }),
    });

    await expect(
      callAs().updateContentItemFile({ ...itemKey, title: 'Renamed' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('points the item at the new file and retires the old one after a delay', async () => {
    await callAs().updateContentItemFile({
      ...itemKey,
      objectKey: NEW_KEY,
      fileName: 'Week 2 notes.pdf',
    });

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      s3Key: NEW_KEY,
      submissionNonce: NEW_UPLOAD_ID,
      fileName: 'Week 2 notes.pdf',
      fileSize: PDF_SIZE,
      mimeType: 'application/pdf',
    });
    expect(scheduleTranscodeCleanup).toHaveBeenCalledWith(expect.anything(), {
      ...itemKey,
      submissionNonce: OLD_UPLOAD_ID,
    });
  });

  // Invariant: of two replacements racing, only one wins, and the loser's
  // copy is removed rather than left with nothing pointing at it.
  it('conflicts, deleting its copy, when another replacement landed first', async () => {
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    await expect(
      callAs().updateContentItemFile({
        ...itemKey,
        objectKey: NEW_KEY,
        fileName: 'Week 2 notes.pdf',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(sentCommands('DeleteObject')).toEqual([
      expect.objectContaining({ Bucket: MEDIA_BUCKET, Key: NEW_KEY }),
    ]);
    expect(scheduleTranscodeCleanup).not.toHaveBeenCalled();
  });
});

describe('createContentItemFileUrl', () => {
  it('returns a signed link to the file', async () => {
    await expect(callAs().createContentItemFileUrl(itemKey)).resolves.toEqual({
      url: 'https://example.cloudfront.net/signed-file-url',
    });
    expect(getSignedCloudFrontFileUrl).toHaveBeenCalledWith(OLD_KEY);
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: null }),
    });

    await expect(
      callAs().createContentItemFileUrl(itemKey),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getSignedCloudFrontFileUrl).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND for an item that is not a file', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { ...fileItem, type: 'video' } }),
    });

    await expect(
      callAs().createContentItemFileUrl(itemKey),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
