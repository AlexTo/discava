/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  aContentItem,
  aLesson,
  aModule,
  callerFor,
} from '@discava/common-server-utils/trpc-testing';
import { errors as openSearchErrors } from '@opensearch-project/opensearch';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MATCH_END as E,
  MATCH_START as S,
} from '../helpers/transcript-query.js';
import { t } from '../init.js';
import { searchTranscripts } from './transcript.js';

const { searchMock, curriculumCollection, enrolmentGet } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  curriculumCollection: vi.fn(),
  enrolmentGet: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: { enrolment: { get: enrolmentGet } },
    collections: { curriculum: curriculumCollection },
  })),
}));

vi.mock('@discava/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/search')>()),
  getOpenSearchClient: vi.fn(async () => ({ search: searchMock })),
}));

const router = t.router({ search: searchTranscripts });
const asLearner = () => callerFor(router, { sub: 'user-1' });

const course = (status = 'published') => ({
  courseId: 'course-1',
  title: 'Course',
  status,
});

const track = {
  trackId: 't1',
  nonce: 'v1',
  language: 'en',
  label: 'English',
  source: 'auto',
  key: 'k',
  isDefault: true,
};

const video = (id: string, overrides: Record<string, unknown> = {}) =>
  aContentItem({
    contentItemId: id,
    title: `Video ${id}`,
    s3Key: `courses/course-1/content-items/${id}/v1/master.m3u8`,
    captionTracks: [track],
    ...overrides,
  });

const setCurriculum = (
  items: ReturnType<typeof video>[],
  parts: { module?: object; lesson?: object; status?: string } = {},
) =>
  curriculumCollection.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: {
        course: [course(parts.status)],
        module: [aModule({ title: 'Module A', ...parts.module })],
        lesson: [aLesson({ title: 'Lesson A', ...parts.lesson })],
        contentItem: items,
      },
    }),
  });

const setEnrolment = (status: string | null) =>
  enrolmentGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: status && { courseId: 'course-1', userId: 'user-1', status },
    }),
  });

const hit = (
  contentItemId: string,
  overrides: Record<string, unknown> = {},
  tagged = `a ${S}phrase${E} here`,
) => ({
  _source: {
    contentItemId,
    versionId: 'v1',
    trackId: 't1',
    language: 'en',
    text: 'a phrase here',
    cues: [
      { s: 0, o: 0 },
      { s: 4.2, o: 2 },
    ],
    ...overrides,
  },
  highlight: { text: [tagged] },
});

const respond = (hits: unknown[]) =>
  searchMock.mockResolvedValue({ body: { hits: { hits } } });

const search = (input: Record<string, unknown> = {}) =>
  asLearner().search({ courseId: 'course-1', q: 'phrase', ...input });

beforeEach(() => {
  vi.clearAllMocks();
  setEnrolment('active');
  setCurriculum([video('i1')]);
  respond([]);
});

describe('transcript.search', () => {
  it('refuses a caller with no session', async () => {
    await expect(
      callerFor(router).search({ courseId: 'course-1', q: 'phrase' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['not enrolled', null],
    ['dropped', 'dropped'],
  ])('is FORBIDDEN on a published course when %s', async (_, status) => {
    setEnrolment(status);
    await expect(search()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it.each(['draft', 'archived'])(
    'is NOT_FOUND on a %s course when not enrolled',
    async (status) => {
      setEnrolment(null);
      setCurriculum([video('i1')], { status });
      await expect(search()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(searchMock).not.toHaveBeenCalled();
    },
  );

  it('is NOT_FOUND for a course that does not exist', async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [], module: [], lesson: [], contentItem: [] },
      }),
    });
    await expect(search()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('gives an enrolled learner of an archived course results', async () => {
    setCurriculum([video('i1')], { status: 'archived' });
    respond([hit('i1')]);
    expect((await search()).items).toHaveLength(1);
  });

  it('reads every page of the curriculum', async () => {
    await search();
    expect(curriculumCollection.mock.results[0]?.value.go).toHaveBeenCalledWith(
      { pages: 'all' },
    );
  });

  it('searches only the course and the watchable videos', async () => {
    setCurriculum([video('i1'), video('i2', { visibility: 'hidden' })]);
    await search({ language: 'es' });
    const body = searchMock.mock.calls[0]?.[0].body;
    expect(body.query.bool.filter).toContainEqual({
      term: { courseId: 'course-1' },
    });
    expect(body.query.bool.filter).toContainEqual({
      terms: { contentItemId: ['i1'] },
    });
    expect(searchMock.mock.calls[0]?.[1]).toEqual({ requestTimeout: 8000 });
  });

  it('returns nothing without calling OpenSearch when no video is watchable', async () => {
    setCurriculum([video('i1', { captionTracks: [] })]);
    expect(await search()).toEqual({ items: [], hasMore: false });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('returns titles, time and marked snippet, and no internal ids', async () => {
    respond([hit('i1')]);
    const result = await search();
    expect(result).toEqual({
      items: [
        {
          moduleId: 'module-1',
          moduleTitle: 'Module A',
          lessonId: 'lesson-1',
          lessonTitle: 'Lesson A',
          contentItemId: 'i1',
          itemTitle: 'Video i1',
          startSeconds: 4,
          language: 'en',
          snippet: [
            { text: 'a ', match: false },
            { text: 'phrase', match: true },
            { text: ' here', match: false },
          ],
        },
      ],
      hasMore: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/versionId|trackId|"key"/);
  });

  it('drops a hit for a hidden item, an old version and a removed track', async () => {
    setCurriculum([video('i1'), video('i2', { visibility: 'hidden' })]);
    respond([
      hit('i2'),
      hit('i1', { versionId: 'old' }),
      hit('i1', { trackId: 'gone' }),
      hit('i-unknown'),
    ]);
    expect(await search()).toEqual({ items: [], hasMore: false });
  });

  it('gives one item for hits with the same item, track and cue start', async () => {
    respond([hit('i1'), hit('i1')]);
    expect((await search()).items).toHaveLength(1);
  });

  it('keeps 20 of 40 hits and says there are more', async () => {
    respond(
      Array.from({ length: 40 }, (_, n) =>
        hit('i1', { cues: [{ s: n, o: 0 }] }),
      ),
    );
    const result = await search();
    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(true);
  });

  it('says there are more when 40 hits came back, even if some were dropped', async () => {
    respond([...Array.from({ length: 39 }, () => hit('i-unknown')), hit('i1')]);
    const result = await search();
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('maps a search timeout to TIMEOUT', async () => {
    searchMock.mockRejectedValue(
      new openSearchErrors.TimeoutError('slow', {} as never),
    );
    await expect(search()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('lets another search error through as an internal error', async () => {
    searchMock.mockRejectedValue(new Error('boom'));
    await expect(search()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('refuses a query under 2 characters', async () => {
    await expect(search({ q: ' a ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
