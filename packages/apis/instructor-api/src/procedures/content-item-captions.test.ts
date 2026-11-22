/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  attachContentItemCaption,
  createContentItemCaptionUploadUrl,
  removeContentItemCaption,
} from './content-item-captions.js';

const {
  courseInstructorGet,
  courseGet,
  moduleGet,
  lessonGet,
  contentItemGet,
  contentItemPatch,
  patchSet,
  patchRemove,
  patchWhere,
  patchGo,
  headLessonFileUpload,
  presignLessonFileUpload,
  readCaptionUpload,
  putCaptionFile,
  bestEffortDeleteCaptionFile,
  bestEffortDeleteCaptionUpload,
  mockModule,
} = await vi.hoisted(async () => ({
  patchSet: vi.fn(),
  patchRemove: vi.fn(),
  patchWhere: vi.fn(),
  patchGo: vi.fn(),
  headLessonFileUpload: vi.fn(),
  presignLessonFileUpload: vi.fn(),
  readCaptionUpload: vi.fn(),
  putCaptionFile: vi.fn(),
  bestEffortDeleteCaptionFile: vi.fn(),
  bestEffortDeleteCaptionUpload: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    courseInstructor: ['get'],
    course: ['get'],
    module: ['get'],
    lesson: ['get'],
    contentItem: ['get', 'patch'],
  }),
}));

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal()),
);

vi.mock(
  '@discava/common-server-utils/lesson-files',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@discava/common-server-utils/lesson-files')
    >()),
    headLessonFileUpload,
    presignLessonFileUpload,
  }),
);

// The S3 calls' own behaviour isn't under test; these assert the procedures
// make them, in the right order, for the right keys.
vi.mock('../helpers/caption-files.js', () => ({
  readCaptionUpload,
  putCaptionFile,
  bestEffortDeleteCaptionFile,
  bestEffortDeleteCaptionUpload,
}));

const router = t.router({
  captionUploadUrl: createContentItemCaptionUploadUrl,
  attachCaption: attachContentItemCaption,
  removeCaption: removeContentItemCaption,
});

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';
const NONCE = 'nonce-1';
const UPLOAD_ID = '0b1f3e2a-5d4c-4b6a-8e7f-9a0b1c2d3e4f';
const ITEM_PREFIX = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}`;
const UPLOAD_KEY = `${ITEM_PREFIX}/captions/${UPLOAD_ID}.vtt`;

const ref = {
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

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

const track = (
  trackId: string,
  language: string,
  overrides: Record<string, unknown> = {},
) => ({
  trackId,
  nonce: NONCE,
  language,
  label: language,
  source: 'uploaded' as const,
  key: `${ITEM_PREFIX}/${NONCE}/captions/${trackId}.vtt`,
  isDefault: false,
  ...overrides,
});

const video = (overrides: Record<string, unknown> = {}) => ({
  ...ref,
  type: 'video' as const,
  status: 'ready' as const,
  title: 'Intro',
  s3Key: `${ITEM_PREFIX}/${NONCE}/master.m3u8`,
  ...overrides,
});

const VALID_VTT = new TextEncoder().encode(
  'WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n',
);

const setItem = (item: unknown) =>
  contentItemGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: item }),
  });

// The track list the write was given.
const writtenTracks = () => patchSet.mock.calls[0][0].captionTracks;

// patch().set().remove()?.where().go(): remove is only chained by some writes.
const wirePatch = () => {
  const afterWhere = { go: patchGo };
  const chain = { remove: patchRemove, where: patchWhere };
  contentItemPatch.mockReturnValue({ set: patchSet });
  patchSet.mockReturnValue(chain);
  patchRemove.mockReturnValue(chain);
  patchWhere.mockReturnValue(afterWhere);
};

beforeEach(() => {
  vi.clearAllMocks();
  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB },
    }),
  });
  const found = (data: unknown) => ({
    go: vi.fn().mockResolvedValue({ data }),
  });
  courseGet.mockReturnValue(found({ status: 'draft' }));
  moduleGet.mockReturnValue(found({ moduleId: MODULE_ID }));
  lessonGet.mockReturnValue(found({ lessonId: LESSON_ID }));
  setItem(video());
  wirePatch();
  patchGo.mockResolvedValue({ data: {} });
  presignLessonFileUpload.mockResolvedValue({
    uploadUrl: 'https://upload.example/put',
    headers: { 'Content-Type': 'text/vtt' },
  });
  headLessonFileUpload.mockResolvedValue({
    contentType: 'text/vtt',
    contentLength: VALID_VTT.byteLength,
  });
  readCaptionUpload.mockResolvedValue(VALID_VTT);
});

const attachInput = (overrides: Record<string, unknown> = {}) => ({
  ...ref,
  uploadId: UPLOAD_ID,
  language: 'es-ES',
  ...overrides,
});

const calls: Record<
  string,
  (c: ReturnType<typeof callAs>) => Promise<unknown>
> = {
  captionUploadUrl: (c) => c.captionUploadUrl(ref),
  attachCaption: (c) => c.attachCaption(attachInput()),
  removeCaption: (c) => c.removeCaption({ ...ref, trackId: 't1' }),
};

describe.each(Object.keys(calls))('%s access', (name) => {
  it('refuses a student and a caller in no group', async () => {
    await expect(calls[name](callAs(['student']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(calls[name](callAs([]))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(contentItemGet).not.toHaveBeenCalled();
  });

  it('refuses an instructor of another course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });
    await expect(calls[name](callAs())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(contentItemGet).not.toHaveBeenCalled();
    expect(presignLessonFileUpload).not.toHaveBeenCalled();
    expect(putCaptionFile).not.toHaveBeenCalled();
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for a missing item or one that is not a video', async () => {
    setItem(undefined);
    await expect(calls[name](callAs())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    setItem({ ...video(), type: 'text' });
    await expect(calls[name](callAs())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('is PRECONDITION_FAILED unless the video is ready', async () => {
    setItem(video({ status: 'pending' }));
    await expect(calls[name](callAs())).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });
});

describe.each(Object.keys(calls))('%s on archived content', (name) => {
  const found = (data: unknown) => ({
    go: vi.fn().mockResolvedValue({ data }),
  });
  const expectRefused = async () => {
    await expect(calls[name](callAs())).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(presignLessonFileUpload).not.toHaveBeenCalled();
    expect(putCaptionFile).not.toHaveBeenCalled();
    expect(contentItemPatch).not.toHaveBeenCalled();
  };

  it('refuses an archived course', async () => {
    courseGet.mockReturnValue(found({ status: 'archived' }));
    await expectRefused();
  });

  it('refuses an archived module', async () => {
    moduleGet.mockReturnValue(found({ archivedAt: '2024-01-01' }));
    await expectRefused();
  });

  it('refuses an archived lesson', async () => {
    lessonGet.mockReturnValue(found({ archivedAt: '2024-01-01' }));
    await expectRefused();
  });

  it('refuses an archived item', async () => {
    setItem(video({ archivedAt: '2024-01-01' }));
    await expectRefused();
  });
});

describe('captionUploadUrl', () => {
  it('presigns a text/vtt PUT under the item and returns the upload id', async () => {
    const result = await callAs().captionUploadUrl(ref);

    expect(result.url).toBe('https://upload.example/put');
    expect(result.headers).toEqual({ 'Content-Type': 'text/vtt' });
    expect(presignLessonFileUpload).toHaveBeenCalledWith(
      `${ITEM_PREFIX}/captions/${result.uploadId}.vtt`,
      'text/vtt',
    );
  });
});

describe('attachCaption', () => {
  it('copies the upload into the version folder and records an uploaded track', async () => {
    const result = await callAs().attachCaption(attachInput());

    const [targetKey] = putCaptionFile.mock.calls[0];
    expect(targetKey).toMatch(
      new RegExp(`^${ITEM_PREFIX}/${NONCE}/captions/[0-9a-f-]{36}\\.vtt$`),
    );
    expect(writtenTracks()).toEqual([
      expect.objectContaining({
        language: 'es-ES',
        label: 'Spanish',
        source: 'uploaded',
        nonce: NONCE,
        isDefault: true,
        key: targetKey,
      }),
    ]);
    expect(patchSet.mock.calls[0][0].captionTracksRev).toBe(1);
    expect(contentItemPatch).toHaveBeenCalledWith(ref);
    expect(bestEffortDeleteCaptionUpload).toHaveBeenCalledWith(
      expect.anything(),
      UPLOAD_KEY,
    );
    expect(bestEffortDeleteCaptionFile).not.toHaveBeenCalled();
    expect(result.captions).toEqual([
      expect.objectContaining({ language: 'es-ES', source: 'uploaded' }),
    ]);
  });

  it('uses the given label', async () => {
    await callAs().attachCaption(attachInput({ label: 'Español' }));
    expect(writtenTracks()[0].label).toBe('Español');
  });

  it('rejects a language outside the list and a label over 40 characters', async () => {
    await expect(
      callAs().attachCaption(attachInput({ language: 'xx-XX' })),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      callAs().attachCaption(attachInput({ label: 'x'.repeat(41) })),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(putCaptionFile).not.toHaveBeenCalled();
  });

  it('makes the upload the default when it replaces the auto track', async () => {
    const auto = track('auto-1', 'en-US', {
      source: 'auto',
      isDefault: true,
    });
    const other = track('other-1', 'fr-FR');
    setItem(video({ captionTracks: [auto, other], captionTracksRev: 2 }));

    const result = await callAs().attachCaption(
      attachInput({ language: 'en-US' }),
    );

    expect(writtenTracks()).toHaveLength(2);
    expect(writtenTracks()[0]).toMatchObject({
      language: 'en-US',
      source: 'uploaded',
      isDefault: true,
    });
    expect(patchSet.mock.calls[0][0].captionTracksRev).toBe(3);
    expect(bestEffortDeleteCaptionFile).toHaveBeenCalledWith(
      expect.anything(),
      auto.key,
    );
    expect(result.captions[0]).toMatchObject({
      language: 'en-US',
      isDefault: true,
    });
  });

  it('replaces an uploaded track of the same language, keeping one per language', async () => {
    const old = track('old-1', 'es-ES', { isDefault: true });
    setItem(video({ captionTracks: [old], captionTracksRev: 1 }));

    await callAs().attachCaption(attachInput());

    expect(writtenTracks()).toHaveLength(1);
    expect(writtenTracks()[0].trackId).not.toBe('old-1');
    expect(bestEffortDeleteCaptionFile).toHaveBeenCalledWith(
      expect.anything(),
      old.key,
    );
  });

  it('refuses an eleventh track and leaves no file', async () => {
    // Ten tracks already, none in the new language.
    const eleven = video({
      captionTracks: Array.from({ length: 10 }, (_, i) =>
        track(`t${i}`, `xx-${i}`, { isDefault: i === 0 }),
      ),
    });
    setItem(eleven);

    await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(putCaptionFile).not.toHaveBeenCalled();
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('sets a failed or pending status to ready with the track', async () => {
    setItem(
      video({
        captionsStatus: 'failed',
      }),
    );
    await callAs().attachCaption(attachInput());
    expect(patchSet.mock.calls[0][0].captionsStatus).toBe('ready');
    expect(patchRemove).toHaveBeenCalledWith(['captionsPendingSince']);

    vi.clearAllMocks();
    wirePatch();
    headLessonFileUpload.mockResolvedValue({ contentLength: 40 });
    readCaptionUpload.mockResolvedValue(VALID_VTT);
    setItem(
      video({
        captionsStatus: 'pending',
        captionsPendingSince: '2024-01-01T00:00:00.000Z',
      }),
    );
    await callAs().attachCaption(attachInput());
    expect(patchSet.mock.calls[0][0].captionsStatus).toBe('ready');
  });

  it('leaves a ready status as it is', async () => {
    setItem(video({ captionsStatus: 'ready' }));
    await callAs().attachCaption(attachInput());
    expect(patchSet.mock.calls[0][0]).not.toHaveProperty('captionsStatus');
  });

  it('writes on the revision and the version', async () => {
    setItem(video({ captionTracksRev: 4 }));
    await callAs().attachCaption(attachInput());

    const condition = patchWhere.mock.calls[0][0];
    const op = {
      eq: (a: unknown, v: unknown) => `${String(a)}=${String(v)}`,
      notExists: (a: unknown) => `!${String(a)}`,
      contains: (a: unknown, v: unknown) => `${String(a)}∋${String(v)}`,
    };
    expect(
      condition(
        { captionTracksRev: 'rev', status: 'status', s3Key: 's3Key' },
        op,
      ),
    ).toBe(`rev=4 AND status=ready AND s3Key∋/${NONCE}/`);
  });

  it.each([
    ['no header', 'hello\n00:00.000 --> 00:02.000\nx'],
    ['no cue', 'WEBVTT\n\nNOTE nothing here\n'],
  ])('refuses invalid WebVTT (%s) and deletes the upload', async (_n, text) => {
    const bytes = new TextEncoder().encode(text);
    headLessonFileUpload.mockResolvedValue({ contentLength: bytes.length });
    readCaptionUpload.mockResolvedValue(bytes);

    await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(putCaptionFile).not.toHaveBeenCalled();
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(bestEffortDeleteCaptionUpload).toHaveBeenCalledWith(
      expect.anything(),
      UPLOAD_KEY,
    );
  });

  it('refuses binary content', async () => {
    const bytes = new Uint8Array([0x57, 0x45, 0x42, 0, 1, 2, 0xff]);
    headLessonFileUpload.mockResolvedValue({ contentLength: bytes.length });
    readCaptionUpload.mockResolvedValue(bytes);

    await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(putCaptionFile).not.toHaveBeenCalled();
  });

  it('refuses a file over 1 MB without reading it', async () => {
    headLessonFileUpload.mockResolvedValue({ contentLength: 1_048_577 });

    await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(readCaptionUpload).not.toHaveBeenCalled();
    expect(putCaptionFile).not.toHaveBeenCalled();
    expect(bestEffortDeleteCaptionUpload).toHaveBeenCalledWith(
      expect.anything(),
      UPLOAD_KEY,
    );
  });

  it('refuses an upload that was never made', async () => {
    headLessonFileUpload.mockResolvedValue(undefined);

    await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(putCaptionFile).not.toHaveBeenCalled();
  });

  it('refuses a video replaced since it was read, leaving no file', async () => {
    // The item's manifest is another version than the track's nonce can match:
    // a stale write is caught by the conditional write, which fails.
    patchGo.mockRejectedValue(conditionalCheckFailedError());

    await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const copied = putCaptionFile.mock.calls[0][0];
    expect(bestEffortDeleteCaptionFile).toHaveBeenCalledWith(
      expect.anything(),
      copied,
    );
    // The upload stays so the instructor can try again.
    expect(bestEffortDeleteCaptionUpload).not.toHaveBeenCalled();
  });

  it('deletes the copy when the write fails for another reason', async () => {
    patchGo.mockRejectedValue(new Error('boom'));

    await expect(callAs().attachCaption(attachInput())).rejects.toThrow();
    const copied = putCaptionFile.mock.calls[0][0];
    expect(bestEffortDeleteCaptionFile).toHaveBeenCalledWith(
      expect.anything(),
      copied,
    );
  });

  it('a lost race leaves no orphan copy and no other file deleted', async () => {
    const old = track('old-1', 'es-ES', { isDefault: true });
    setItem(video({ captionTracks: [old], captionTracksRev: 1 }));
    patchGo.mockRejectedValue(conditionalCheckFailedError());

    await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Try again',
    });
    const copied = putCaptionFile.mock.calls[0][0];
    expect(bestEffortDeleteCaptionFile).toHaveBeenCalledTimes(1);
    expect(bestEffortDeleteCaptionFile).toHaveBeenCalledWith(
      expect.anything(),
      copied,
    );
  });

  it('stores the validated bytes, not a copy of the upload key', async () => {
    await callAs().attachCaption(attachInput());

    expect(putCaptionFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/captions\/[0-9a-f-]{36}\.vtt$/),
      VALID_VTT,
    );
  });

  it('returns no S3 key', async () => {
    const result = await callAs().attachCaption(attachInput());
    expect(JSON.stringify(result)).not.toContain('courses/');
    expect(JSON.stringify(result)).not.toContain('"key"');
  });

  describe('with translated tracks', () => {
    const source = track('src', 'en-US', { isDefault: true, source: 'auto' });
    const translated = (trackId: string, language: string) =>
      track(trackId, language, {
        source: 'translated',
        sourceTrackId: 'src',
      });
    const deletedKeys = () =>
      bestEffortDeleteCaptionFile.mock.calls.map(([, key]) => key);

    it('replaces a translated track of its language and deletes its file', async () => {
      const es = translated('tr-es', 'es-ES');
      setItem(video({ captionTracks: [source, es], captionTracksRev: 2 }));

      const result = await callAs().attachCaption(attachInput());

      expect(
        writtenTracks().map((x: { trackId: string }) => x.trackId),
      ).toEqual(['src', expect.not.stringMatching(/^tr-es$/)]);
      expect(deletedKeys()).toEqual([es.key]);
      expect(result.captions.at(-1)).toMatchObject({
        language: 'es-ES',
        source: 'uploaded',
      });
    });

    it('evicts a translated track at ten tracks and deletes its file', async () => {
      courseGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { status: 'draft', captionLanguages: ['fr-FR', 'de-DE'] },
        }),
      });
      const others = Array.from({ length: 7 }, (_, i) =>
        track(`u${i}`, `xx-${i}`),
      );
      const fr = translated('tr-fr', 'fr-FR');
      const de = translated('tr-de', 'de-DE');
      setItem(
        video({
          captionTracks: [source, ...others, fr, de],
          captionTracksRev: 1,
        }),
      );

      await callAs().attachCaption(attachInput());

      expect(writtenTracks()).toHaveLength(10);
      expect(deletedKeys()).toEqual([de.key]);
    });

    it('still refuses an eleventh track when none is translated', async () => {
      setItem(
        video({
          captionTracks: [
            source,
            ...Array.from({ length: 9 }, (_, i) => track(`u${i}`, `xx-${i}`)),
          ],
        }),
      );

      await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject(
        { code: 'BAD_REQUEST' },
      );
      expect(bestEffortDeleteCaptionFile).not.toHaveBeenCalled();
    });

    it('deletes every stale translated file when it replaces the default', async () => {
      const fr = translated('tr-fr', 'fr-FR');
      const es = translated('tr-es', 'es-ES');
      setItem(video({ captionTracks: [source, fr, es], captionTracksRev: 1 }));

      await callAs().attachCaption(attachInput({ language: 'en-US' }));

      expect(writtenTracks()).toHaveLength(1);
      expect(deletedKeys()).toEqual(
        expect.arrayContaining([source.key, fr.key, es.key]),
      );
      expect(deletedKeys()).toHaveLength(3);
    });

    it('deletes nothing but the new file when the condition is lost', async () => {
      const es = translated('tr-es', 'es-ES');
      setItem(video({ captionTracks: [source, es], captionTracksRev: 2 }));
      patchGo.mockRejectedValue(conditionalCheckFailedError());

      await expect(callAs().attachCaption(attachInput())).rejects.toMatchObject(
        { code: 'CONFLICT' },
      );
      expect(deletedKeys()).toEqual([putCaptionFile.mock.calls[0][0]]);
    });
  });
});

describe('removeCaption', () => {
  const tracks = [
    track('t1', 'en-US', { isDefault: true, source: 'auto' }),
    track('t2', 'es-ES'),
  ];

  it('removes the track, deletes its file and returns the rest', async () => {
    setItem(video({ captionTracks: tracks, captionTracksRev: 3 }));

    const result = await callAs().removeCaption({ ...ref, trackId: 't2' });

    expect(writtenTracks().map((x: { trackId: string }) => x.trackId)).toEqual([
      't1',
    ]);
    expect(patchSet.mock.calls[0][0].captionTracksRev).toBe(4);
    expect(bestEffortDeleteCaptionFile).toHaveBeenCalledWith(
      expect.anything(),
      tracks[1].key,
    );
    expect(result.captions).toEqual([
      expect.objectContaining({ trackId: 't1', isDefault: true }),
    ]);
    expect(JSON.stringify(result)).not.toContain('courses/');
  });

  it('promotes the next track when the default is removed', async () => {
    setItem(video({ captionTracks: tracks, captionTracksRev: 1 }));

    const result = await callAs().removeCaption({ ...ref, trackId: 't1' });

    expect(result.captions).toEqual([
      expect.objectContaining({ trackId: 't2', isDefault: true }),
    ]);
  });

  it('is NOT_FOUND for an unknown track and writes nothing', async () => {
    setItem(video({ captionTracks: tracks }));

    await expect(
      callAs().removeCaption({ ...ref, trackId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(bestEffortDeleteCaptionFile).not.toHaveBeenCalled();
  });

  it('is CONFLICT on a lost race and keeps the file', async () => {
    setItem(video({ captionTracks: tracks }));
    patchGo.mockRejectedValue(conditionalCheckFailedError());

    await expect(
      callAs().removeCaption({ ...ref, trackId: 't2' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(bestEffortDeleteCaptionFile).not.toHaveBeenCalled();
  });

  describe('with translated tracks', () => {
    const source = track('t1', 'en-US', { isDefault: true, source: 'auto' });
    const translated = (trackId: string, language: string) =>
      track(trackId, language, {
        source: 'translated',
        sourceTrackId: 't1',
      });

    it('refuses a translated track before any write', async () => {
      setItem(
        video({
          captionTracks: [source, translated('t3', 'fr-FR')],
          captionTracksRev: 1,
        }),
      );

      await expect(
        callAs().removeCaption({ ...ref, trackId: 't3' }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining("can't be removed here"),
      });
      expect(contentItemPatch).not.toHaveBeenCalled();
      expect(bestEffortDeleteCaptionFile).not.toHaveBeenCalled();
    });

    it('drops the translated tracks and deletes their files when the default goes', async () => {
      const fr = translated('t3', 'fr-FR');
      setItem(
        video({
          captionTracks: [source, fr],
          captionTracksRev: 1,
        }),
      );

      const result = await callAs().removeCaption({ ...ref, trackId: 't1' });

      expect(result.captions).toEqual([]);
      const deleted = bestEffortDeleteCaptionFile.mock.calls.map(
        ([, key]) => key,
      );
      expect(deleted).toEqual(expect.arrayContaining([source.key, fr.key]));
    });

    it('leaves translated tracks alone when a non-default upload goes', async () => {
      const es = track('t2', 'es-ES');
      setItem(
        video({
          captionTracks: [source, es, translated('t3', 'fr-FR')],
          captionTracksRev: 1,
        }),
      );

      const result = await callAs().removeCaption({ ...ref, trackId: 't2' });

      expect(result.captions.map((c) => c.trackId)).toEqual(['t1', 't3']);
      expect(bestEffortDeleteCaptionFile).toHaveBeenCalledTimes(1);
    });
  });
});
