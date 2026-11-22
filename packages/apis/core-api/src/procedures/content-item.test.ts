/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { fileUrl, saveVideoPosition, videoUrl } from './content-item.js';

// What the mocked table holds for this test; each entity's `get` reads it.
const {
  db,
  puts,
  positionKeys,
  getSignedCloudFrontCookies,
  getSignedCloudFrontFileUrl,
} = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  // Every write the procedures under test make, by entity.
  puts: [] as { entity: string; item: any }[],
  // The keys videoPosition was read by.
  positionKeys: [] as any[],
  getSignedCloudFrontCookies: vi.fn(),
  getSignedCloudFrontFileUrl: vi.fn(),
}));

const stored = (name: string) => ({
  get: vi.fn((key: any) => ({
    go: vi.fn(async () => {
      if (name === 'videoPosition') {
        positionKeys.push(key);
      }
      return { data: db[name] ?? null };
    }),
  })),
  put: vi.fn((item: any) => ({
    go: vi.fn(async () => {
      puts.push({ entity: name, item });
      return { data: item };
    }),
  })),
  create: vi.fn((item: any) => ({
    go: vi.fn(async () => {
      puts.push({ entity: name, item });
      return { data: item };
    }),
  })),
  patch: vi.fn((key: any) => ({
    set: vi.fn((item: any) => ({
      go: vi.fn(async () => {
        puts.push({ entity: name, item: { ...key, ...item } });
        return { data: item };
      }),
    })),
  })),
});

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: Object.fromEntries(
      [
        'course',
        'module',
        'lesson',
        'contentItem',
        'enrolment',
        'videoPosition',
      ].map((name) => [name, stored(name)]),
    ),
  })),
}));

vi.mock('@discava/common-server-utils/lesson-media', () => ({
  getCloudFrontVideoUrl: vi.fn(
    async (key: string) => `https://media.example.com/${key}`,
  ),
  getSignedCloudFrontCookies,
  getSignedCloudFrontFileUrl,
}));

const router = t.router({ videoUrl, fileUrl, saveVideoPosition });

const USER_SUB = 'student-1';

const call = (responseCookies: string[] = []) =>
  callerFor(router, { sub: USER_SUB, responseCookies });

const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};

const MANIFEST =
  'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/nonce-1/master.m3u8';

beforeEach(() => {
  vi.clearAllMocks();
  puts.length = 0;
  positionKeys.length = 0;
  for (const key of Object.keys(db)) {
    delete db[key];
  }
  db.course = { courseId: 'course-1', status: 'published' };
  db.module = { ...ref, visibility: 'visible' };
  db.lesson = { ...ref, visibility: 'visible' };
  db.contentItem = {
    ...ref,
    type: 'video',
    status: 'ready',
    s3Key: MANIFEST,
    visibility: 'visible',
  };
  db.enrolment = { courseId: 'course-1', userId: USER_SUB, status: 'active' };
  getSignedCloudFrontCookies.mockResolvedValue([
    'CloudFront-Policy=p; Domain=example.com',
    'CloudFront-Signature=s; Domain=example.com',
  ]);
  getSignedCloudFrontFileUrl.mockImplementation(
    async (key: string) => `https://media.example.com/${key}?Signature=s`,
  );
});

describe('contentItem.videoUrl', () => {
  it('has the player send no credentials when no cookies were set (local dev, #137)', async () => {
    getSignedCloudFrontCookies.mockResolvedValue([]);

    await expect(call().videoUrl(ref)).resolves.toEqual({
      url: `https://media.example.com/${MANIFEST}`,
      withCredentials: false,
      versionId: 'nonce-1',
      resumeAt: 0,
      captions: [],
      questionCount: 0,
    });
  });

  it("returns an enrolled student the video's manifest and sets cookies for its directory", async () => {
    const responseCookies: string[] = [];

    await expect(call(responseCookies).videoUrl(ref)).resolves.toEqual({
      url: `https://media.example.com/${MANIFEST}`,
      withCredentials: true,
      versionId: 'nonce-1',
      resumeAt: 0,
      captions: [],
      questionCount: 0,
    });
    expect(getSignedCloudFrontCookies).toHaveBeenCalledWith(
      'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/nonce-1/',
    );
    expect(responseCookies).toEqual([
      'CloudFront-Policy=p; Domain=example.com',
      'CloudFront-Signature=s; Domain=example.com',
    ]);
  });

  it('counts the video’s questions', async () => {
    db.contentItem = {
      ...db.contentItem,
      questions: [
        { questionId: 'q1' },
        { questionId: 'q2' },
        { questionId: 'q3' },
      ],
      answerKey: {},
      quizVersion: 1,
    };

    await expect(call().videoUrl(ref)).resolves.toMatchObject({
      questionCount: 3,
    });
  });

  it('counts no questions in an archived course', async () => {
    db.contentItem = {
      ...db.contentItem,
      questions: [
        { questionId: 'q1' },
        { questionId: 'q2' },
        { questionId: 'q3' },
      ],
    };
    db.course = { ...db.course, status: 'archived' };

    await expect(call().videoUrl(ref)).resolves.toMatchObject({
      questionCount: 0,
    });
  });

  it('still plays in an archived course the student is enrolled in', async () => {
    db.course.status = 'archived';

    await expect(call().videoUrl(ref)).resolves.toHaveProperty('url');
  });

  it.each([
    ['not enrolled', () => delete db.enrolment],
    ['dropped', () => (db.enrolment.status = 'dropped')],
  ])('is FORBIDDEN to a student who is %s', async (_, arrange) => {
    arrange();

    await expect(call().videoUrl(ref)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for a draft course, without saying it exists', async () => {
    db.course.status = 'draft';
    delete db.enrolment;

    await expect(call().videoUrl(ref)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each([
    ['the course is gone', () => delete db.course],
    ['the item is gone', () => delete db.contentItem],
    ['its module is hidden', () => (db.module.visibility = 'hidden')],
    ['its lesson is archived', () => (db.lesson.archivedAt = '2024-01-01')],
    ['it is hidden', () => (db.contentItem.visibility = 'hidden')],
    ['it is archived', () => (db.contentItem.archivedAt = '2024-01-01')],
    ['it is not a video', () => (db.contentItem.type = 'text')],
    ['it is still transcoding', () => (db.contentItem.status = 'pending')],
    ['it has no stream yet', () => delete db.contentItem.s3Key],
  ])('is NOT_FOUND when %s', async (_, arrange) => {
    arrange();

    await expect(call().videoUrl(ref)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
  });

  it.each([
    ['being replaced', 'pending'],
    ['whose replacement failed', 'failed'],
  ])('plays the previous version of a video %s (#209)', async (_, status) => {
    const previous =
      'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/old-nonce/master.m3u8';
    db.contentItem = {
      ...db.contentItem,
      status,
      s3Key:
        'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1.mp4',
      previousS3Key: previous,
    };

    await expect(call().videoUrl(ref)).resolves.toEqual({
      url: `https://media.example.com/${previous}`,
      withCredentials: true,
      versionId: 'old-nonce',
      resumeAt: 0,
      captions: [],
      questionCount: 0,
    });
    expect(getSignedCloudFrontCookies).toHaveBeenCalledWith(
      'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/old-nonce/',
    );
  });

  it("returns the student's saved position for the played version", async () => {
    db.videoPosition = {
      ...ref,
      userId: USER_SUB,
      positionSeconds: 95,
      versionId: 'nonce-1',
    };

    await expect(call().videoUrl(ref)).resolves.toMatchObject({
      versionId: 'nonce-1',
      resumeAt: 95,
    });
  });

  describe('captions', () => {
    const FOLDER =
      'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1';
    const track = (language: string, extra = {}) => ({
      trackId: `track-${language}`,
      nonce: 'nonce-1',
      language,
      label: language === 'en-US' ? 'English' : language,
      source: 'uploaded',
      key: `${FOLDER}/nonce-1/captions/track-${language}.vtt`,
      isDefault: false,
      ...extra,
    });

    it('lists the played version’s tracks, default first, as plain URLs', async () => {
      db.contentItem.captionTracks = [
        track('es-ES'),
        track('fr-FR', { nonce: 'older-nonce' }),
        track('en-US', { isDefault: true, source: 'auto' }),
      ];
      db.contentItem.captionTracksRev = 5;
      db.contentItem.captionsStatus = 'ready';

      const { captions } = await call().videoUrl(ref);

      expect(captions).toEqual([
        {
          trackId: 'track-en-US',
          language: 'en-US',
          label: 'English',
          isDefault: true,
          url: `https://media.example.com/${FOLDER}/nonce-1/captions/track-en-US.vtt`,
        },
        {
          trackId: 'track-es-ES',
          language: 'es-ES',
          label: 'es-ES',
          isDefault: false,
          url: `https://media.example.com/${FOLDER}/nonce-1/captions/track-es-ES.vtt`,
        },
      ]);
    });

    it('leaks no key, revision, source or status', async () => {
      db.contentItem.captionTracks = [track('en-US', { isDefault: true })];
      db.contentItem.captionTracksRev = 5;
      db.contentItem.captionsStatus = 'ready';

      const result = await call().videoUrl(ref);

      expect(result.captions[0]).not.toHaveProperty('key');
      expect(result.captions[0]).not.toHaveProperty('source');
      expect(result).not.toHaveProperty('captionTracksRev');
      expect(result).not.toHaveProperty('captionsStatus');
      expect(JSON.stringify(result)).not.toContain('"key"');
    });

    it('omits the tracks of another version', async () => {
      db.contentItem.captionTracks = [
        track('en-US', { isDefault: true, nonce: 'older-nonce' }),
      ];

      await expect(call().videoUrl(ref)).resolves.toMatchObject({
        captions: [],
      });
    });

    it('offers the previous version’s own tracks while a replacement transcodes', async () => {
      db.contentItem = {
        ...db.contentItem,
        status: 'pending',
        s3Key: `${FOLDER}.mp4`,
        previousS3Key: `${FOLDER}/old-nonce/master.m3u8`,
        captionTracks: [
          track('en-US', {
            isDefault: true,
            nonce: 'old-nonce',
            key: `${FOLDER}/old-nonce/captions/t.vtt`,
          }),
        ],
      };

      const { captions } = await call().videoUrl(ref);

      expect(captions.map((c) => c.trackId)).toEqual(['track-en-US']);
    });

    it('is an empty list for a video with no tracks', async () => {
      await expect(call().videoUrl(ref)).resolves.toMatchObject({
        captions: [],
      });
    });
  });

  it('starts at 0 when the saved position is for another version', async () => {
    db.videoPosition = {
      ...ref,
      userId: USER_SUB,
      positionSeconds: 95,
      versionId: 'older-nonce',
    };

    await expect(call().videoUrl(ref)).resolves.toMatchObject({
      versionId: 'nonce-1',
      resumeAt: 0,
      captions: [],
    });
  });

  it("reads only the caller's own position", async () => {
    await call().videoUrl(ref);

    expect(positionKeys).toEqual([
      {
        userId: USER_SUB,
        courseId: 'course-1',
        lessonId: 'lesson-1',
        contentItemId: 'item-1',
      },
    ]);
  });

  it('leaks no S3 key', async () => {
    const result = await call().videoUrl(ref);

    expect(Object.keys(result).sort()).toEqual([
      'captions',
      'questionCount',
      'resumeAt',
      'url',
      'versionId',
      'withCredentials',
    ]);
  });

  it('rejects unauthenticated callers', async () => {
    const anonymous = callerFor(router);

    await expect(anonymous.videoUrl(ref)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('contentItem.fileUrl', () => {
  const FILE =
    'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/upload-1/worksheet.pdf';

  beforeEach(() => {
    db.contentItem = {
      ...ref,
      type: 'file',
      status: 'ready',
      s3Key: FILE,
      fileName: 'worksheet.pdf',
      visibility: 'visible',
    };
  });

  it('returns an enrolled student a signed link to the file', async () => {
    await expect(call().fileUrl(ref)).resolves.toEqual({
      url: `https://media.example.com/${FILE}?Signature=s`,
    });
    expect(getSignedCloudFrontFileUrl).toHaveBeenCalledWith(FILE);
  });

  it('still downloads in an archived course the student is enrolled in', async () => {
    db.course.status = 'archived';

    await expect(call().fileUrl(ref)).resolves.toHaveProperty('url');
  });

  it.each([
    ['not enrolled', () => delete db.enrolment],
    ['dropped', () => (db.enrolment.status = 'dropped')],
  ])('is FORBIDDEN to a student who is %s', async (_, arrange) => {
    arrange();

    await expect(call().fileUrl(ref)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(getSignedCloudFrontFileUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['the course is gone', () => delete db.course],
    ['the item is gone', () => delete db.contentItem],
    ['its module is hidden', () => (db.module.visibility = 'hidden')],
    ['its lesson is archived', () => (db.lesson.archivedAt = '2024-01-01')],
    ['it is hidden', () => (db.contentItem.visibility = 'hidden')],
    ['it is archived', () => (db.contentItem.archivedAt = '2024-01-01')],
    ['it is not a file', () => (db.contentItem.type = 'video')],
  ])('is NOT_FOUND when %s', async (_, arrange) => {
    arrange();

    await expect(call().fileUrl(ref)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(getSignedCloudFrontFileUrl).not.toHaveBeenCalled();
  });
});

describe('contentItem.saveVideoPosition', () => {
  const save = (extra: Record<string, unknown> = {}) =>
    call().saveVideoPosition({
      ...ref,
      versionId: 'nonce-1',
      positionSeconds: 42,
      durationSeconds: 600,
      ...extra,
    });

  it("stores the caller's position with the version", async () => {
    await expect(save()).resolves.toEqual({ saved: true, positionSeconds: 42 });

    expect(puts).toEqual([
      {
        entity: 'videoPosition',
        item: expect.objectContaining({
          ...ref,
          userId: USER_SUB,
          positionSeconds: 42,
          versionId: 'nonce-1',
          savedAt: expect.any(String),
        }),
      },
    ]);
  });

  it('floors a fractional position', async () => {
    await save({ positionSeconds: 42.9 });

    expect(puts[0].item.positionSeconds).toBe(42);
  });

  it.each([
    ['within 10 seconds of the end', { positionSeconds: 595 }],
    ['past 95% of the video', { positionSeconds: 580 }],
  ])('stores 0 %s', async (_, change) => {
    await expect(save(change)).resolves.toEqual({
      saved: true,
      positionSeconds: 0,
    });

    expect(puts[0].item.positionSeconds).toBe(0);
  });

  it('ignores a version students no longer play', async () => {
    await expect(save({ versionId: 'old-nonce' })).resolves.toEqual({
      saved: false,
    });

    expect(puts).toEqual([]);
  });

  it('saves for the previous version while a replacement transcodes', async () => {
    db.contentItem = {
      ...db.contentItem,
      status: 'pending',
      s3Key: 'courses/course-1/x/item-1.mp4',
      previousS3Key:
        'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/old-nonce/master.m3u8',
    };

    await expect(save({ versionId: 'old-nonce' })).resolves.toMatchObject({
      saved: true,
    });
  });

  it('refuses an archived course', async () => {
    db.course.status = 'archived';

    await expect(save()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This course is archived',
    });
    expect(puts).toEqual([]);
  });

  it.each([
    ['not enrolled', () => delete db.enrolment],
    ['dropped', () => (db.enrolment.status = 'dropped')],
  ])('is FORBIDDEN to a student who is %s', async (_, arrange) => {
    arrange();

    await expect(save()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(puts).toEqual([]);
  });

  it.each([
    ['the item is gone', () => delete db.contentItem],
    ['its module is hidden', () => (db.module.visibility = 'hidden')],
    ['its lesson is archived', () => (db.lesson.archivedAt = '2024-01-01')],
    ['it is hidden', () => (db.contentItem.visibility = 'hidden')],
    ['it is not a video', () => (db.contentItem.type = 'text')],
    ['it has no stream yet', () => delete db.contentItem.s3Key],
  ])('is NOT_FOUND when %s', async (_, arrange) => {
    arrange();

    await expect(save()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(puts).toEqual([]);
  });

  it("takes the record's owner from the token, not the input", async () => {
    await save({ userId: 'someone-else' });

    expect(puts).toHaveLength(1);
    expect(puts[0].item.userId).toBe(USER_SUB);
  });

  it('writes no completion, activity count or progress', async () => {
    await save();

    expect(puts.map((p) => p.entity)).toEqual(['videoPosition']);
  });

  it.each([
    ['a negative position', { positionSeconds: -1 }],
    ['a position over a day', { positionSeconds: 86_401 }],
    ['a zero duration', { durationSeconds: 0 }],
    ['a duration over a day', { durationSeconds: 86_401 }],
    ['a NaN position', { positionSeconds: Number.NaN }],
  ])('rejects %s', async (_, change) => {
    await expect(save(change)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(puts).toEqual([]);
  });

  it('rejects unauthenticated callers', async () => {
    const anonymous = callerFor(router);

    await expect(
      anonymous.saveVideoPosition({
        ...ref,
        versionId: 'nonce-1',
        positionSeconds: 1,
        durationSeconds: 10,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
