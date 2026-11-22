/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { InvalidRequestError, NotFoundError } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  courseCaptionLanguages,
  retryCourseCaptionTranslations,
  updateCourseCaptionLanguages,
} from './course-caption-languages.js';

const {
  courseGet,
  courseInstructorGet,
  setCourseCaptionLanguages,
  requestCaptionTranslation,
  curriculum,
  coursePreviewGet,
  resolveCaptionTranslationSettings,
  mockModule,
} = await vi.hoisted(async () => ({
  setCourseCaptionLanguages: vi.fn(),
  requestCaptionTranslation: vi.fn(),
  curriculum: vi.fn(),
  resolveCaptionTranslationSettings: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    course: ['get'],
    courseInstructor: ['get'],
    coursePreview: ['get'],
  }),
}));

vi.mock('@discava/core-table', async (importActual) => {
  const mocked = mockModule(await importActual(), {
    setCourseCaptionLanguages,
    requestCaptionTranslation,
  });
  const service = mocked.createCoreTableService as () => Promise<object>;
  return {
    ...mocked,
    createCoreTableService: vi.fn(async () => ({
      ...(await service()),
      collections: { curriculum },
    })),
  };
});

vi.mock(
  '@discava/common-server-utils/caption-translation-settings',
  async (importActual) => ({
    ...(await importActual<object>()),
    resolveCaptionTranslationSettings,
  }),
);

const router = t.router({
  courseCaptionLanguages,
  updateCourseCaptionLanguages,
  retryCourseCaptionTranslations,
});

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: 'instructor-1', groups });

const course = {
  courseId: 'course-1',
  title: 'Course',
  status: 'draft',
  captionLanguages: ['es-ES', 'fr-FR'],
};

beforeEach(() => {
  vi.resetAllMocks();
  courseInstructorGet.mockReturnValue({
    go: async () => ({ data: { courseId: 'course-1' } }),
  });
  courseGet.mockReturnValue({ go: async () => ({ data: course }) });
  resolveCaptionTranslationSettings.mockResolvedValue({
    enabled: true,
    maxLanguagesPerCourse: 5,
  });
  setCourseCaptionLanguages.mockResolvedValue(undefined);
  requestCaptionTranslation.mockResolvedValue(undefined);
});

describe('course.captionLanguages', () => {
  it('refuses a caller who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(
      callAs().courseCaptionLanguages({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a caller outside the instructor group', async () => {
    await expect(
      callAs([]).courseCaptionLanguages({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns the saved languages, the supported list and the stage limits', async () => {
    const result = await callAs().courseCaptionLanguages({
      courseId: 'course-1',
    });
    expect(result.languages).toEqual(['es-ES', 'fr-FR']);
    expect(result.enabled).toBe(true);
    expect(result.maxLanguages).toBe(5);
    expect(result.supported).toContainEqual({
      tag: 'es-ES',
      label: 'Spanish',
      nativeLabel: 'Español',
    });
  });

  it('returns an empty list for a course with none, and caps the limit at 9', async () => {
    courseGet.mockReturnValue({
      go: async () => ({ data: { ...course, captionLanguages: undefined } }),
    });
    resolveCaptionTranslationSettings.mockResolvedValue({
      enabled: true,
      maxLanguagesPerCourse: 20,
    });
    const result = await callAs().courseCaptionLanguages({
      courseId: 'course-1',
    });
    expect(result.languages).toEqual([]);
    expect(result.maxLanguages).toBe(9);
  });

  it('is NOT_FOUND for an unknown course', async () => {
    courseGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(
      callAs().courseCaptionLanguages({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('course.updateCaptionLanguages', () => {
  const update = (languages: string[], groups?: string[]) =>
    callAs(groups).updateCourseCaptionLanguages({
      courseId: 'course-1',
      languages,
    });

  it('refuses a caller who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(update(['es-ES'])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(setCourseCaptionLanguages).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the instructor group', async () => {
    await expect(update(['es-ES'], [])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(setCourseCaptionLanguages).not.toHaveBeenCalled();
  });

  it('saves an ordered list and returns the new state', async () => {
    const result = await update(['fr-FR', 'es-ES']);
    expect(setCourseCaptionLanguages).toHaveBeenCalledWith(expect.anything(), {
      courseId: 'course-1',
      languages: ['fr-FR', 'es-ES'],
      maxLanguages: 5,
    });
    expect(result.languages).toEqual(['fr-FR', 'es-ES']);
  });

  it('clears the languages with an empty list, even when translation is off', async () => {
    resolveCaptionTranslationSettings.mockResolvedValue({
      enabled: false,
      maxLanguagesPerCourse: 0,
    });
    const result = await update([]);
    expect(setCourseCaptionLanguages).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ languages: [] }),
    );
    expect(result.languages).toEqual([]);
    expect(result.enabled).toBe(false);
  });

  it('refuses an unknown tag', async () => {
    await expect(update(['xx-XX'])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(setCourseCaptionLanguages).not.toHaveBeenCalled();
  });

  it('refuses a duplicate', async () => {
    await expect(update(['es-ES', 'es-ES'])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(setCourseCaptionLanguages).not.toHaveBeenCalled();
  });

  it('refuses more than 9 languages', async () => {
    await expect(
      update(Array.from({ length: 10 }, (_, i) => `l${i}`)),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("maps core-table's limit error to BAD_REQUEST", async () => {
    setCourseCaptionLanguages.mockRejectedValue(
      new InvalidRequestError('Choose at most 1 caption languages'),
    );
    await expect(update(['es-ES', 'fr-FR'])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Choose at most 1 caption languages',
    });
  });

  it('refuses any list when translation is off', async () => {
    resolveCaptionTranslationSettings.mockResolvedValue({
      enabled: false,
      maxLanguagesPerCourse: 0,
    });
    await expect(update(['es-ES'])).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Caption translation is not available',
    });
    expect(setCourseCaptionLanguages).not.toHaveBeenCalled();
  });

  it('refuses an archived course', async () => {
    courseGet.mockReturnValue({
      go: async () => ({ data: { ...course, status: 'archived' } }),
    });
    await expect(update(['es-ES'])).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(setCourseCaptionLanguages).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for an unknown course', async () => {
    courseGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(update(['es-ES'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('maps a course deleted mid-write to NOT_FOUND', async () => {
    setCourseCaptionLanguages.mockRejectedValue(
      new NotFoundError('Course not found'),
    );
    await expect(update(['es-ES'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('course.retryCaptionTranslations', () => {
  const video = (contentItemId: string, withTracks = true) => ({
    type: 'video',
    moduleId: 'm1',
    lessonId: 'l1',
    contentItemId,
    captionTracks: withTracks ? [{ trackId: 't' }] : undefined,
  });
  const hasCurriculum = (items: object[]) =>
    curriculum.mockReturnValue({
      go: async () => ({ data: { contentItem: items } }),
    });

  beforeEach(() => {
    hasCurriculum([
      video('v1'),
      video('v2', false),
      { ...video('d1'), type: 'text' },
      video('v3'),
    ]);
    coursePreviewGet.mockReturnValue({
      go: async () => ({ data: { captionTracks: [{ trackId: 'p' }] } }),
    });
  });

  it('refuses a caller who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(
      callAs().retryCourseCaptionTranslations({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(requestCaptionTranslation).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the instructor group', async () => {
    await expect(
      callAs([]).retryCourseCaptionTranslations({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('asks each video with tracks and the preview, and counts them', async () => {
    const result = await callAs().retryCourseCaptionTranslations({
      courseId: 'course-1',
    });

    expect(result).toEqual({ requested: 3 });
    expect(requestCaptionTranslation.mock.calls.map(([, key]) => key)).toEqual([
      {
        courseId: 'course-1',
        moduleId: 'm1',
        lessonId: 'l1',
        contentItemId: 'v1',
      },
      {
        courseId: 'course-1',
        moduleId: 'm1',
        lessonId: 'l1',
        contentItemId: 'v3',
      },
      { courseId: 'course-1' },
    ]);
  });

  it('skips a preview without tracks', async () => {
    coursePreviewGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(
      callAs().retryCourseCaptionTranslations({ courseId: 'course-1' }),
    ).resolves.toEqual({ requested: 2 });
  });

  it('is refused when translation is off', async () => {
    resolveCaptionTranslationSettings.mockResolvedValue({
      enabled: false,
      maxLanguagesPerCourse: 0,
    });
    await expect(
      callAs().retryCourseCaptionTranslations({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(requestCaptionTranslation).not.toHaveBeenCalled();
  });

  it('is refused when the course has no caption languages', async () => {
    courseGet.mockReturnValue({
      go: async () => ({ data: { ...course, captionLanguages: undefined } }),
    });
    await expect(
      callAs().retryCourseCaptionTranslations({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('is refused on an archived course', async () => {
    courseGet.mockReturnValue({
      go: async () => ({ data: { ...course, status: 'archived' } }),
    });
    await expect(
      callAs().retryCourseCaptionTranslations({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
