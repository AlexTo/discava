/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  deleteLessonMediaFolder,
  isSubmissionUploadKey,
  LESSON_FILE_MAX_BYTES,
  LESSON_FILE_TYPES,
  lessonFileType,
  storedFileName,
  submissionFileKey,
  submissionFolderNonce,
  submissionFolderPrefix,
  submissionNonceOf,
  submissionUploadKey,
  submissionUserPrefix,
} from './lesson-files.js';

const { listAllObjectKeys, deleteObjectsInBatches } = vi.hoisted(() => ({
  listAllObjectKeys: vi.fn(),
  deleteObjectsInBatches: vi.fn(),
}));

vi.mock('./lesson-media-bucket.js', () => ({
  getS3Client: vi.fn(),
  resolveLessonMediaBucketName: vi.fn(async () => 'media-bucket'),
  resolveLessonMediaUploadBucketName: vi.fn(async () => 'upload-bucket'),
  listAllObjectKeys,
  deleteObjectsInBatches,
}));

const ITEM = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};
const ITEM_PREFIX =
  'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/';
const USER = 'user-1';
const UPLOAD_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

describe('the file allowlist', () => {
  it('is the same list instructors attach, capped at 100 MB', () => {
    expect(Object.keys(LESSON_FILE_TYPES).sort()).toEqual(
      [
        'pdf',
        'docx',
        'xlsx',
        'pptx',
        'odt',
        'ods',
        'odp',
        'txt',
        'csv',
        'md',
        'png',
        'jpg',
        'jpeg',
        'gif',
        'webp',
        'zip',
      ].sort(),
    );
    expect(LESSON_FILE_MAX_BYTES).toBe(100 * 1024 * 1024);
  });

  it('gives a name its extension’s type, whatever the case, or nothing', () => {
    expect(lessonFileType('Essay.PDF')).toBe('application/pdf');
    expect(lessonFileType('run.exe')).toBeUndefined();
    expect(lessonFileType('noextension')).toBeUndefined();
  });
});

describe('storedFileName', () => {
  it('keeps the extension and makes the rest URL-safe', () => {
    expect(storedFileName('My Essay (final)?.PDF')).toBe('My-Essay-final.pdf');
    expect(storedFileName('résumé.docx')).toBe('re-sume.docx');
  });
});

describe('submission keys', () => {
  it('puts an upload under the student’s folder of the item, in an upload folder', () => {
    expect(submissionUploadKey(ITEM, USER, UPLOAD_ID, 'My Work.pdf')).toBe(
      `${ITEM_PREFIX}submissions/${USER}/${UPLOAD_ID}/My-Work.pdf`,
    );
  });

  it('puts a stored file in the request’s own attempt folder', () => {
    expect(submissionFileKey(ITEM, USER, ATTEMPT_ID, 'My Work.pdf')).toBe(
      `${ITEM_PREFIX}submissions/${USER}/${ATTEMPT_ID}/My-Work.pdf`,
    );
  });

  it('keeps stored names URL-safe', () => {
    const key = submissionFileKey(ITEM, USER, ATTEMPT_ID, '../a b/c#d?.zip');
    expect(key).toMatch(/^[A-Za-z0-9/._-]+$/);
    expect(key.split('/').pop()).toBe('a-b-c-d.zip');
    expect(key).not.toContain('..');
  });

  it('names a different folder for each attempt of the same student', () => {
    expect(submissionFileKey(ITEM, USER, 'a-1', 'w.pdf')).not.toBe(
      submissionFileKey(ITEM, USER, 'a-2', 'w.pdf'),
    );
  });

  it('names the cleanup folder segment for an attempt', () => {
    expect(submissionFolderNonce(USER, ATTEMPT_ID)).toBe(
      `submissions/${USER}/${ATTEMPT_ID}`,
    );
    expect(`${ITEM_PREFIX}${submissionFolderNonce(USER, ATTEMPT_ID)}/`).toBe(
      submissionFileKey(ITEM, USER, ATTEMPT_ID, 'w.pdf').replace('w.pdf', ''),
    );
  });

  it('gives the student’s own folder', () => {
    expect(submissionUserPrefix(ITEM, USER)).toBe(
      `${ITEM_PREFIX}submissions/${USER}/`,
    );
  });
});

describe('isSubmissionUploadKey', () => {
  const key = submissionUploadKey(ITEM, USER, UPLOAD_ID, 'My Work.pdf');

  it('accepts the key an upload was issued with', () => {
    expect(isSubmissionUploadKey(key, ITEM, USER, 'My Work.pdf')).toBe(true);
  });

  it.each([
    ['another student', { ...ITEM }, 'user-2', 'My Work.pdf'],
    ['another item', { ...ITEM, contentItemId: 'item-2' }, USER, 'My Work.pdf'],
    ['another name', { ...ITEM }, USER, 'Other.pdf'],
  ])('refuses it for %s', (_label, item, user, name) => {
    expect(isSubmissionUploadKey(key, item, user, name)).toBe(false);
  });

  it.each([
    ['a file item’s upload', `${ITEM_PREFIX}${UPLOAD_ID}/My-Work.pdf`],
    [
      'a folder that isn’t an upload id',
      `${ITEM_PREFIX}submissions/${USER}/x/My-Work.pdf`,
    ],
    [
      'a deeper key',
      `${ITEM_PREFIX}submissions/${USER}/${UPLOAD_ID}/a/My-Work.pdf`,
    ],
    [
      'a key that climbs out',
      `${ITEM_PREFIX}submissions/${USER}/../${UPLOAD_ID}/My-Work.pdf`,
    ],
  ])('refuses %s', (_label, objectKey) => {
    expect(isSubmissionUploadKey(objectKey, ITEM, USER, 'My Work.pdf')).toBe(
      false,
    );
  });
});

describe('submissionNonceOf', () => {
  it('gives the cleanup segment of the folder holding a stored file', () => {
    const nonce = submissionNonceOf(
      submissionFileKey(ITEM, USER, ATTEMPT_ID, 'w.pdf'),
      ITEM,
      USER,
    );

    expect(nonce).toBe(`submissions/${USER}/${ATTEMPT_ID}`);
    expect(submissionFolderPrefix(ITEM, nonce!)).toBe(
      `${ITEM_PREFIX}submissions/${USER}/${ATTEMPT_ID}/`,
    );
  });

  it('gives nothing for a key outside the student’s submission folders', () => {
    expect(
      submissionNonceOf(`${ITEM_PREFIX}${ATTEMPT_ID}/w.pdf`, ITEM, USER),
    ).toBeUndefined();
    expect(
      submissionNonceOf(
        submissionFileKey(ITEM, 'user-2', ATTEMPT_ID, 'w.pdf'),
        ITEM,
        USER,
      ),
    ).toBeUndefined();
  });
});

describe('deleteLessonMediaFolder', () => {
  it('lists the folder and deletes what it holds', async () => {
    listAllObjectKeys.mockResolvedValue(['a/1.pdf', 'a/2.pdf']);

    await deleteLessonMediaFolder(undefined, 'a/');

    expect(listAllObjectKeys).toHaveBeenCalledWith(
      undefined,
      'media-bucket',
      'a/',
    );
    expect(deleteObjectsInBatches).toHaveBeenCalledWith(
      undefined,
      'media-bucket',
      ['a/1.pdf', 'a/2.pdf'],
    );
  });

  it('logs and carries on when something fails', async () => {
    const logger = { error: vi.fn() };
    listAllObjectKeys.mockRejectedValue(new Error('boom'));

    await expect(
      deleteLessonMediaFolder(logger as never, 'a/'),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
