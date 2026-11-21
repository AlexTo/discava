/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  aContentItem,
  aCourse,
  aLesson,
  aModule,
  callerFor,
} from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  freePreviewFileUrl,
  freePreviewLesson,
  freePreviewVideoUrl,
} from './free-preview.js';

const {
  courseGet,
  moduleGet,
  lessonGet,
  contentItemGet,
  contentItemQueryPrimary,
  videoPositionGet,
  writes,
  getSignedCloudFrontCookies,
  getSignedCloudFrontFileUrl,
  mockModule,
} = await vi.hoisted(async () => {
  const { mockCoreTable } = await import(
    '@discava/common-server-utils/trpc-testing'
  );
  const writeNames = [
    'create',
    'put',
    'patch',
    'update',
    'upsert',
    'delete',
  ] as const;
  const spies = mockCoreTable({
    course: ['get', ...writeNames],
    module: ['get', ...writeNames],
    lesson: ['get', ...writeNames],
    contentItem: ['get', 'query.primary', ...writeNames],
    videoPosition: ['get', ...writeNames],
    transaction: ['write'],
  });
  const writes = Object.entries(spies)
    .filter(
      ([name]) =>
        /(Create|Put|Patch|Update|Upsert|Delete)$/.test(name) ||
        name === 'transactionWrite',
    )
    .map(([, spy]) => spy);
  return {
    ...spies,
    writes,
    getSignedCloudFrontCookies: vi.fn(),
    getSignedCloudFrontFileUrl: vi.fn(),
  };
});

vi.mock('@discava/common-server-utils/lesson-media', () => ({
  getCloudFrontVideoUrl: vi.fn(
    async (key: string) => `https://media.example.com/${key}`,
  ),
  getSignedCloudFrontCookies,
  getSignedCloudFrontFileUrl,
}));

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal()),
);

const { FREE_PREVIEW_COOKIE_LIFETIME_SECONDS, SIGNED_COOKIE_LIFETIME_SECONDS } =
  await import('@discava/common-server-utils/media-keys');

const router = t.router({
  lesson: freePreviewLesson,
  videoUrl: freePreviewVideoUrl,
  fileUrl: freePreviewFileUrl,
});

const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
};
const itemRef = (contentItemId: string) => ({ ...ref, contentItemId });

const FOLDER =
  'courses/course-1/modules/module-1/lessons/lesson-1/content-items/video-1/n1/';
const MANIFEST = `${FOLDER}master.m3u8`;

const readyVideo = (extra: object = {}) =>
  aContentItem({
    contentItemId: 'video-1',
    type: 'video',
    status: 'ready',
    title: 'Lecture',
    order: 2,
    s3Key: MANIFEST,
    previousS3Key: 'PREVIOUS-S3-KEY',
    durationSeconds: 90,
    mediaConvertJobId: 'JOB-SECRET',
    rawObjectETag: 'ETAG-SECRET',
    submissionNonce: 'NONCE-SECRET',
    captionTracks: [
      {
        trackId: 't1',
        language: 'en-US',
        label: 'English',
        isDefault: true,
        source: 'auto',
        key: `${FOLDER}captions/t1.vtt`,
        nonce: 'n1',
      },
    ],
    captionTracksRev: 7,
    ...extra,
  });
const textItem = aContentItem({
  contentItemId: 'text-1',
  type: 'text',
  title: 'Notes',
  order: 1,
  body: '{"type":"doc"}',
});
const fileItem = aContentItem({
  contentItemId: 'file-1',
  type: 'file',
  title: 'Slides',
  order: 3,
  s3Key: 'S3-KEY-OF-FILE',
  fileName: 'slides.pdf',
  fileSize: 1234,
  mimeType: 'application/pdf',
});
const quizItem = aContentItem({
  contentItemId: 'quiz-1',
  type: 'quiz',
  title: 'Check',
  order: 4,
  questions: [{ questionId: 'q1' }, { questionId: 'q2' }],
  answerKey: { q1: 'ANSWER-SECRET' },
  settings: { passPercent: 80 },
});

// What the table holds: an open preview lesson, plus a real, shown video and
// file that belong to another (non-preview) lesson of the same course.
const OTHER_LESSON = { lessonId: 'lesson-2' };
let items: Record<string, any>;
let course: any;
let module: any;
let lesson: any;

const keyOf = (r: Record<string, string>) =>
  `${r.moduleId}/${r.lessonId}/${r.contentItemId}`;

beforeEach(() => {
  vi.clearAllMocks();
  course = aCourse({
    status: 'published',
    title: 'Course title',
    priceAmount: 4900,
  });
  module = aModule();
  lesson = aLesson({ freePreview: true, kind: 'lesson', description: 'About' });
  const video = readyVideo();
  const otherVideo = readyVideo({
    contentItemId: 'video-other',
    lessonId: 'lesson-2',
  });
  const otherFile = {
    ...fileItem,
    contentItemId: 'file-other',
    lessonId: 'lesson-2',
  };
  items = {};
  for (const item of [video, textItem, fileItem, quizItem].map((i) =>
    structuredClone(i),
  )) {
    items[keyOf({ ...ref, contentItemId: item.contentItemId })] = item;
  }
  for (const item of [otherVideo, otherFile]) {
    items[
      keyOf({
        moduleId: 'module-1',
        lessonId: 'lesson-2',
        contentItemId: item.contentItemId,
      })
    ] = item;
  }
  courseGet.mockReturnValue({ go: async () => ({ data: course }) });
  moduleGet.mockReturnValue({ go: async () => ({ data: module }) });
  lessonGet.mockImplementation(({ lessonId }: { lessonId: string }) => ({
    go: async () => ({
      data:
        lessonId === ref.lessonId
          ? lesson
          : lessonId === OTHER_LESSON.lessonId
            ? aLesson({ lessonId, kind: 'lesson' })
            : null,
    }),
  }));
  contentItemGet.mockImplementation((key: Record<string, string>) => ({
    go: async () => ({ data: items[keyOf(key)] ?? null }),
  }));
  contentItemQueryPrimary.mockImplementation(() => ({
    go: async () => ({
      data: [
        ...Object.values(items).filter((i) => i.lessonId === ref.lessonId),
        aContentItem({
          contentItemId: 'hidden',
          type: 'text',
          visibility: 'hidden',
          body: 'HIDDEN-BODY',
          order: 5,
        }),
        aContentItem({
          contentItemId: 'archived',
          type: 'text',
          archivedAt: '2024-02-01T00:00:00.000Z',
          body: 'ARCHIVED-BODY',
          order: 6,
        }),
        aContentItem({
          contentItemId: 'assign',
          type: 'assignment',
          title: 'ASSIGNMENT-TITLE',
          order: 7,
        }),
      ],
    }),
  }));
  videoPositionGet.mockReturnValue({ go: async () => ({ data: null }) });
  getSignedCloudFrontCookies.mockResolvedValue(['CloudFront-Policy=p']);
  getSignedCloudFrontFileUrl.mockResolvedValue('https://signed.example.com/f');
});

const anonymous = (cookies: string[] = []) =>
  callerFor(router, { responseCookies: cookies });

describe('freePreview.lesson', () => {
  it('returns the titles and the shown items in order, with exactly the preview fields', async () => {
    const result = await anonymous().lesson(ref);
    expect(result).toEqual({
      course: { courseId: 'course-1', title: 'Course title' },
      lesson: {
        lessonId: 'lesson-1',
        moduleId: 'module-1',
        title: 'Welcome',
        description: 'About',
      },
      items: [
        {
          contentItemId: 'text-1',
          type: 'text',
          title: 'Notes',
          body: '{"type":"doc"}',
        },
        {
          contentItemId: 'video-1',
          type: 'video',
          title: 'Lecture',
          durationSeconds: 90,
          playable: true,
        },
        {
          contentItemId: 'file-1',
          type: 'file',
          title: 'Slides',
          fileName: 'slides.pdf',
          fileSize: 1234,
          mimeType: 'application/pdf',
        },
        {
          contentItemId: 'quiz-1',
          type: 'quiz',
          title: 'Check',
          questionCount: 2,
        },
      ],
    });
  });

  it('gives a signed-in caller the identical response', async () => {
    const signedIn = callerFor(router, {
      sub: 'student-1',
      groups: ['student'],
    });
    expect(await signedIn.lesson(ref)).toEqual(await anonymous().lesson(ref));
  });

  it('returns no items for a lesson with no shown items', async () => {
    contentItemQueryPrimary.mockImplementation(() => ({
      go: async () => ({ data: [] }),
    }));
    expect((await anonymous().lesson(ref)).items).toEqual([]);
  });

  it('leaks no stored attribute, hidden item or assignment', async () => {
    const json = JSON.stringify(await anonymous().lesson(ref));
    for (const secret of [
      'S3-KEY-OF-FILE',
      'PREVIOUS-S3-KEY',
      MANIFEST,
      'captionTracks',
      'captionTracksRev',
      'ANSWER-SECRET',
      'answerKey',
      'questionId',
      'passPercent',
      'JOB-SECRET',
      'ETAG-SECRET',
      'NONCE-SECRET',
      'HIDDEN-BODY',
      'ARCHIVED-BODY',
      'ASSIGNMENT-TITLE',
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe('freePreview.videoUrl', () => {
  it('returns the manifest address and captions, signs the item folder for an hour and reads no position', async () => {
    const cookies: string[] = [];
    const result = await anonymous(cookies).videoUrl(itemRef('video-1'));
    expect(result).toEqual({
      url: `https://media.example.com/${MANIFEST}`,
      withCredentials: true,
      versionId: 'n1',
      captions: [
        {
          trackId: 't1',
          language: 'en-US',
          label: 'English',
          isDefault: true,
          url: `https://media.example.com/${FOLDER}captions/t1.vtt`,
        },
      ],
    });
    expect(getSignedCloudFrontCookies).toHaveBeenCalledExactlyOnceWith(FOLDER, {
      lifetimeSeconds: FREE_PREVIEW_COOKIE_LIFETIME_SECONDS,
    });
    expect(cookies).toEqual(['CloudFront-Policy=p']);
    expect(videoPositionGet).not.toHaveBeenCalled();
  });

  it('lasts no longer than an enrolled student’s cookies', () => {
    expect(FREE_PREVIEW_COOKIE_LIFETIME_SECONDS).toBe(3600);
    expect(FREE_PREVIEW_COOKIE_LIFETIME_SECONDS).toBeLessThanOrEqual(
      SIGNED_COOKIE_LIFETIME_SECONDS,
    );
  });

  it('plays the previous version of a video being replaced', async () => {
    const previous = `${FOLDER.replace('/n1/', '/n0/')}master.m3u8`;
    items[keyOf(itemRef('video-1'))] = readyVideo({
      status: 'processing',
      s3Key: `${FOLDER}new/master.m3u8`,
      previousS3Key: previous,
    });
    const lessonResult = await anonymous().lesson(ref);
    expect(
      lessonResult.items.find((i) => i.contentItemId === 'video-1'),
    ).toMatchObject({ playable: true });
    await anonymous().videoUrl(itemRef('video-1'));
    expect(getSignedCloudFrontCookies).toHaveBeenCalledWith(
      previous.slice(0, previous.lastIndexOf('/') + 1),
      expect.anything(),
    );
  });
});

describe('freePreview.fileUrl', () => {
  it('returns the signed link for the item’s object', async () => {
    expect(await anonymous().fileUrl(itemRef('file-1'))).toEqual({
      url: 'https://signed.example.com/f',
    });
    expect(getSignedCloudFrontFileUrl).toHaveBeenCalledExactlyOnceWith(
      'S3-KEY-OF-FILE',
    );
  });
});

const NOT_AVAILABLE = {
  code: 'NOT_FOUND',
  message: 'This preview is not available',
};

const calls = {
  'freePreview.lesson': (c: ReturnType<typeof anonymous>) => c.lesson(ref),
  'freePreview.videoUrl': (c: ReturnType<typeof anonymous>) =>
    c.videoUrl(itemRef('video-1')),
  'freePreview.fileUrl': (c: ReturnType<typeof anonymous>) =>
    c.fileUrl(itemRef('file-1')),
};

describe('refusals', () => {
  const gateCases: [string, () => void][] = [
    ['a draft course', () => (course.status = 'draft')],
    ['an archived course', () => (course.status = 'archived')],
    ['a missing course', () => (course = null)],
    ['a hidden module', () => (module.visibility = 'hidden')],
    [
      'an archived module',
      () => (module.archivedAt = '2024-02-01T00:00:00.000Z'),
    ],
    ['a missing module', () => (module = null)],
    ['a hidden lesson', () => (lesson.visibility = 'hidden')],
    [
      'an archived lesson',
      () => (lesson.archivedAt = '2024-02-01T00:00:00.000Z'),
    ],
    ['a missing lesson', () => (lesson = null)],
    ['an unmarked lesson', () => delete lesson.freePreview],
    [
      'an assignment lesson carrying the mark',
      () => (lesson.kind = 'assignment'),
    ],
  ];

  for (const [operation, call] of Object.entries(calls)) {
    describe(operation, () => {
      it.each(gateCases)('refuses %s identically', async (_name, arrange) => {
        arrange();
        await expect(call(anonymous())).rejects.toMatchObject(NOT_AVAILABLE);
        expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
        expect(getSignedCloudFrontFileUrl).not.toHaveBeenCalled();
      });
    });
  }

  const videoCases: [string, () => void][] = [
    ['missing', () => delete items[keyOf(itemRef('video-1'))]],
    ['hidden', () => (items[keyOf(itemRef('video-1'))].visibility = 'hidden')],
    [
      'archived',
      () =>
        (items[keyOf(itemRef('video-1'))].archivedAt =
          '2024-02-01T00:00:00.000Z'),
    ],
    [
      'with nothing playable',
      () => {
        Object.assign(items[keyOf(itemRef('video-1'))], {
          status: 'processing',
          previousS3Key: undefined,
        });
      },
    ],
  ];
  const fileCases: [string, () => void][] = [
    ['missing', () => delete items[keyOf(itemRef('file-1'))]],
    ['hidden', () => (items[keyOf(itemRef('file-1'))].visibility = 'hidden')],
    [
      'archived',
      () =>
        (items[keyOf(itemRef('file-1'))].archivedAt =
          '2024-02-01T00:00:00.000Z'),
    ],
    ['with no object', () => delete items[keyOf(itemRef('file-1'))].s3Key],
  ];

  it.each(videoCases)(
    'videoUrl refuses a video that is %s',
    async (_n, arrange) => {
      arrange();
      await expect(
        anonymous().videoUrl(itemRef('video-1')),
      ).rejects.toMatchObject(NOT_AVAILABLE);
      expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
    },
  );

  it.each(fileCases)(
    'fileUrl refuses a file that is %s',
    async (_n, arrange) => {
      arrange();
      await expect(
        anonymous().fileUrl(itemRef('file-1')),
      ).rejects.toMatchObject(NOT_AVAILABLE);
      expect(getSignedCloudFrontFileUrl).not.toHaveBeenCalled();
    },
  );

  it('refuses an item of the other type, on both signing queries', async () => {
    const cookies: string[] = [];
    await expect(
      anonymous(cookies).videoUrl(itemRef('file-1')),
    ).rejects.toMatchObject(NOT_AVAILABLE);
    await expect(
      anonymous(cookies).videoUrl(itemRef('text-1')),
    ).rejects.toMatchObject(NOT_AVAILABLE);
    await expect(
      anonymous(cookies).fileUrl(itemRef('video-1')),
    ).rejects.toMatchObject(NOT_AVAILABLE);
    expect(cookies).toEqual([]);
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
    expect(getSignedCloudFrontFileUrl).not.toHaveBeenCalled();
  });

  it('refuses a real, shown video and file of another lesson addressed under the preview lesson', async () => {
    const cookies: string[] = [];
    await expect(
      anonymous(cookies).videoUrl(itemRef('video-other')),
    ).rejects.toMatchObject(NOT_AVAILABLE);
    await expect(
      anonymous(cookies).fileUrl(itemRef('file-other')),
    ).rejects.toMatchObject(NOT_AVAILABLE);
    expect(cookies).toEqual([]);
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
    expect(getSignedCloudFrontFileUrl).not.toHaveBeenCalled();
  });

  it('gives the same error code and message for every reason', async () => {
    const errors: unknown[] = [];
    for (const [, arrange] of gateCases) {
      course = aCourse({ status: 'published' });
      module = aModule();
      lesson = aLesson({ freePreview: true, kind: 'lesson' });
      arrange();
      errors.push(
        await anonymous()
          .lesson(ref)
          .catch((e) => ({ code: e.code, message: e.message })),
      );
    }
    expect(new Set(errors.map((e) => JSON.stringify(e))).size).toBe(1);
  });
});

describe('no writes', () => {
  it('calls nothing that writes, on success or refusal', async () => {
    const c = anonymous();
    await c.lesson(ref);
    await c.videoUrl(itemRef('video-1'));
    await c.fileUrl(itemRef('file-1'));
    lesson.freePreview = undefined;
    await c.lesson(ref).catch(() => undefined);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});
