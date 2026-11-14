/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { REPLACED_FILE_GRACE_SECONDS } from '@discava/common-server-utils/media-keys';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcodeCleanup } from './transcode-cleanup.js';

const { s3Send, resolveLessonMediaBucketName, submissionGet } = vi.hoisted(
  () => ({
    s3Send: vi.fn(),
    submissionGet: vi.fn(),
    resolveLessonMediaBucketName: vi.fn(),
  }),
);

vi.mock('@discava/core-table', () => ({
  createCoreTableService: vi.fn(async () => ({
    entities: { assignmentSubmission: { get: submissionGet } },
  })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: s3Send };
  }),
  ListObjectsV2Command: vi.fn(function (input) {
    return { __command: 'ListObjectsV2', ...input };
  }),
  DeleteObjectsCommand: vi.fn(function (input) {
    return { __command: 'DeleteObjects', ...input };
  }),
}));

vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveLessonMediaBucketName,
}));

const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';
const SUBMISSION_NONCE = 'nonce-1';
const BUCKET_NAME = 'lesson-media-bucket';
const PREFIX = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/${SUBMISSION_NONCE}/`;

const buildEvent = () => ({
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemId: CONTENT_ITEM_ID,
  submissionNonce: SUBMISSION_NONCE,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveLessonMediaBucketName.mockResolvedValue(BUCKET_NAME);
});

describe('transcodeCleanup', () => {
  it('deletes every object under the job’s own nonce-scoped prefix', async () => {
    s3Send
      .mockResolvedValueOnce({
        Contents: [
          { Key: `${PREFIX}master.m3u8` },
          { Key: `${PREFIX}seg1.ts` },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({});

    await transcodeCleanup(buildEvent());

    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'ListObjectsV2',
        Bucket: BUCKET_NAME,
        Prefix: PREFIX,
      }),
    );
    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'DeleteObjects',
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: [
            { Key: `${PREFIX}master.m3u8` },
            { Key: `${PREFIX}seg1.ts` },
          ],
        },
      }),
    );
  });

  it('paginates ListObjectsV2 until IsTruncated is false', async () => {
    s3Send
      .mockResolvedValueOnce({
        Contents: [{ Key: `${PREFIX}seg1.ts` }],
        IsTruncated: true,
        NextContinuationToken: 'token-1',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: `${PREFIX}seg2.ts` }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({});

    await transcodeCleanup(buildEvent());

    expect(s3Send).toHaveBeenCalledTimes(3);
    const [secondListCall] = s3Send.mock.calls[1]!;
    expect(secondListCall.ContinuationToken).toBe('token-1');
    const [deleteCall] = s3Send.mock.calls[2]!;
    expect(deleteCall.Delete.Objects).toEqual([
      { Key: `${PREFIX}seg1.ts` },
      { Key: `${PREFIX}seg2.ts` },
    ]);
  });

  it('chunks DeleteObjects calls to at most 1,000 keys', async () => {
    const manyKeys = Array.from({ length: 1500 }, (_, i) => ({
      Key: `${PREFIX}seg${i}.ts`,
    }));
    s3Send
      .mockResolvedValueOnce({ Contents: manyKeys, IsTruncated: false })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await transcodeCleanup(buildEvent());

    const deleteCalls = s3Send.mock.calls
      .map(([command]) => command)
      .filter((command) => command.__command === 'DeleteObjects');
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0].Delete.Objects).toHaveLength(1000);
    expect(deleteCalls[1].Delete.Objects).toHaveLength(500);
  });

  it('does nothing when the prefix is already empty', async () => {
    s3Send.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

    await transcodeCleanup(buildEvent());

    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  // ListObjectsV2 omits Contents entirely (rather than returning an empty
  // array) when a page has nothing in it -- distinct from the empty-array
  // case above.
  it('treats a response with no Contents field as empty', async () => {
    s3Send.mockResolvedValueOnce({ IsTruncated: false });

    await transcodeCleanup(buildEvent());

    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it('skips a listed object with no Key', async () => {
    s3Send
      .mockResolvedValueOnce({
        Contents: [{ Key: undefined }, { Key: `${PREFIX}seg1.ts` }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({});

    await transcodeCleanup(buildEvent());

    const [deleteCall] = s3Send.mock.calls[1]!;
    expect(deleteCall.Delete.Objects).toEqual([{ Key: `${PREFIX}seg1.ts` }]);
  });

  it('throws on an invalid event so EventBridge Scheduler retries', async () => {
    await expect(transcodeCleanup({ courseId: COURSE_ID })).rejects.toThrow();
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('propagates a ListObjectsV2 failure instead of swallowing it', async () => {
    s3Send.mockRejectedValue(new Error('S3 is unavailable'));

    await expect(transcodeCleanup(buildEvent())).rejects.toThrow(
      'S3 is unavailable',
    );
  });

  // DeleteObjects can resolve with a 200 and still fail individual keys --
  // that doesn't reject the promise, so a per-key failure has to be
  // checked explicitly or it's silently lost, logged as a success, and
  // never retried.
  it('throws when DeleteObjects reports per-key errors, instead of logging success', async () => {
    s3Send
      .mockResolvedValueOnce({
        Contents: [
          { Key: `${PREFIX}master.m3u8` },
          { Key: `${PREFIX}seg1.ts` },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Errors: [
          {
            Key: `${PREFIX}seg1.ts`,
            Code: 'InternalError',
            Message: 'We encountered an internal error',
          },
        ],
      });

    await expect(transcodeCleanup(buildEvent())).rejects.toThrow(
      /seg1\.ts.*InternalError/,
    );
  });
});

// A student's submission folders (#102): the cleanup never deletes the folder
// holding their current file.
describe('transcodeCleanup of a submission folder', () => {
  const USER_ID = 'student-1';
  const NONCE = `submissions/${USER_ID}/attempt-1`;
  const FOLDER = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/${NONCE}/`;
  const OTHER = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}/submissions/${USER_ID}/attempt-2/`;
  const NOW = new Date('2026-11-14T10:00:00.000Z');
  const ago = (seconds: number) =>
    new Date(NOW.getTime() - seconds * 1000).toISOString();

  const event = (purpose?: 'attempt' | 'retire') => ({
    ...buildEvent(),
    submissionNonce: NONCE,
    keepIfCurrentFor: USER_ID,
    ...(purpose && { purpose }),
  });
  const holding = (key: string, submittedAt = ago(86_400)) =>
    submissionGet.mockReturnValue({
      go: vi.fn(async () => ({
        data: { file: { key: `${key}work.pdf` }, submittedAt },
      })),
    });
  const deleted = () =>
    s3Send.mock.calls.some(([c]) => c.__command === 'DeleteObjects');

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    s3Send.mockImplementation(async (command: { __command: string }) =>
      command.__command === 'ListObjectsV2'
        ? { Contents: [{ Key: `${FOLDER}work.pdf` }], IsTruncated: false }
        : {},
    );
    return () => vi.useRealTimers();
  });

  it('keeps the folder holding the student’s current file', async () => {
    holding(FOLDER);

    await transcodeCleanup(event('retire'));

    expect(deleted()).toBe(false);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('reads the submission consistently, by the item and the student', async () => {
    const go = vi.fn(async () => ({ data: undefined }));
    submissionGet.mockReturnValue({ go });

    await transcodeCleanup(event());

    expect(submissionGet).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      contentItemId: CONTENT_ITEM_ID,
      userId: USER_ID,
    });
    expect(go).toHaveBeenCalledWith({ consistent: true });
  });

  it('deletes another folder of the same student', async () => {
    holding(OTHER);

    await transcodeCleanup(event('retire'));

    expect(deleted()).toBe(true);
  });

  it('deletes the folder when there is no record', async () => {
    submissionGet.mockReturnValue({ go: vi.fn(async () => ({ data: null })) });

    await transcodeCleanup(event('attempt'));

    expect(deleted()).toBe(true);
  });

  it('has an attempt cleanup keep a replaced folder while the replacement is inside the grace', async () => {
    holding(OTHER, ago(REPLACED_FILE_GRACE_SECONDS - 1));

    await transcodeCleanup(event('attempt'));

    expect(deleted()).toBe(false);
  });

  it('has an attempt cleanup delete a replaced folder once the grace has passed', async () => {
    holding(OTHER, ago(REPLACED_FILE_GRACE_SECONDS + 1));

    await transcodeCleanup(event('attempt'));

    expect(deleted()).toBe(true);
  });

  it('has a retire cleanup delete a replaced folder whatever the submittedAt', async () => {
    holding(OTHER, ago(1));

    await transcodeCleanup(event('retire'));

    expect(deleted()).toBe(true);
  });

  it('does not read any submission without keepIfCurrentFor', async () => {
    await transcodeCleanup(buildEvent());

    expect(submissionGet).not.toHaveBeenCalled();
    expect(deleted()).toBe(true);
  });
});
