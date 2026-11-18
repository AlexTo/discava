/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { ListAnnouncementsInputSchema } from '../schema/index.js';
import { listAnnouncements } from './announcement.js';

const { announcementPage, courseGet, enrolmentGet, userGet } = vi.hoisted(
  () => ({
    announcementPage: vi.fn(),
    courseGet: vi.fn(),
    enrolmentGet: vi.fn(),
    userGet: vi.fn(),
  }),
);

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  announcementPage,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      enrolment: { get: enrolmentGet },
      user: { get: userGet },
    },
  })),
}));

const caller = t.createCallerFactory(t.router({ listAnnouncements }));

const STUDENT_SUB = 'student-1';

const call = () =>
  caller({
    event: {
      requestContext: {
        authorizer: {
          claims: { sub: STUDENT_SUB, 'cognito:groups': ['student'] },
        },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

const stored = (id: string, over: Record<string, unknown> = {}) => ({
  courseId: 'course-1',
  announcementId: id,
  title: `Title ${id}`,
  body: '{"type":"doc","content":[]}',
  authorId: 'instructor-1',
  createdAt: '2026-11-16T10:00:00.000Z',
  version: 3,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  courseGet.mockReturnValue(
    resolves({ courseId: 'course-1', status: 'published' }),
  );
  enrolmentGet.mockReturnValue(
    resolves({ courseId: 'course-1', userId: STUDENT_SUB, status: 'active' }),
  );
  userGet.mockReturnValue(
    resolves([
      { userId: 'instructor-1', givenName: 'Alice', familyName: 'Smith' },
    ]),
  );
  announcementPage.mockResolvedValue({ items: [], cursor: undefined });
});

describe('announcement.list', () => {
  it('lists the items the table returns, newest first, with author names', async () => {
    announcementPage.mockResolvedValue({
      items: [
        stored('b'),
        stored('a', { editedAt: '2026-11-17T10:00:00.000Z' }),
      ],
      cursor: 'next',
    });

    const result = await call().listAnnouncements({ courseId: 'course-1' });

    expect(announcementPage).toHaveBeenCalledWith(expect.anything(), {
      courseId: 'course-1',
      cursor: undefined,
      limit: 20,
    });
    expect(result.items.map((item) => item.announcementId)).toEqual(['b', 'a']);
    expect(result.items[0]?.authorName).toBe('Alice Smith');
    expect(result.items[1]?.editedAt).toBe('2026-11-17T10:00:00.000Z');
    expect(result.cursor).toBe('next');
  });

  it('shows the new text and editedAt of an edited announcement', async () => {
    const body = '{"type":"doc","content":[{"type":"paragraph"}]}';
    announcementPage
      .mockResolvedValueOnce({ items: [stored('a')] })
      .mockResolvedValueOnce({
        items: [
          stored('a', {
            title: 'Corrected title',
            body,
            editedAt: '2026-11-17T12:00:00.000Z',
            version: 4,
          }),
        ],
      });

    const before = await call().listAnnouncements({ courseId: 'course-1' });
    const after = await call().listAnnouncements({ courseId: 'course-1' });

    expect(before.items[0]).not.toHaveProperty('editedAt');
    expect(after.items[0]).toMatchObject({
      announcementId: 'a',
      title: 'Corrected title',
      body,
      editedAt: '2026-11-17T12:00:00.000Z',
    });
  });

  it('leaves a deleted announcement out of the next list', async () => {
    announcementPage
      .mockResolvedValueOnce({ items: [stored('b'), stored('a')] })
      .mockResolvedValueOnce({ items: [stored('a')] });

    const before = await call().listAnnouncements({ courseId: 'course-1' });
    const after = await call().listAnnouncements({ courseId: 'course-1' });

    expect(before.items.map((item) => item.announcementId)).toEqual(['b', 'a']);
    expect(after.items.map((item) => item.announcementId)).toEqual(['a']);
  });

  it('never returns authorId or version', async () => {
    announcementPage.mockResolvedValue({ items: [stored('a')] });

    const result = await call().listAnnouncements({ courseId: 'course-1' });

    expect(result.items[0]).not.toHaveProperty('authorId');
    expect(result.items[0]).not.toHaveProperty('version');
    expect(result).not.toHaveProperty('cursor');
  });

  it('reads the authors with one batch get of the distinct ids', async () => {
    announcementPage.mockResolvedValue({
      items: [stored('a'), stored('b'), stored('c', { authorId: 'other' })],
    });
    userGet.mockReturnValue(
      resolves([
        { userId: 'instructor-1', givenName: 'Alice', familyName: 'Smith' },
        { userId: 'other' },
      ]),
    );

    const result = await call().listAnnouncements({ courseId: 'course-1' });

    expect(userGet).toHaveBeenCalledTimes(1);
    expect(userGet).toHaveBeenCalledWith([
      { userId: 'instructor-1' },
      { userId: 'other' },
    ]);
    expect(result.items.map((item) => item.authorName)).toEqual([
      'Alice Smith',
      'Alice Smith',
      'Instructor',
    ]);
  });

  it('falls back to "Instructor" for an author with no user record', async () => {
    announcementPage.mockResolvedValue({ items: [stored('a')] });
    userGet.mockReturnValue(resolves([]));

    const result = await call().listAnnouncements({ courseId: 'course-1' });

    expect(result.items[0]?.authorName).toBe('Instructor');
  });

  it('skips the user read when there are no announcements', async () => {
    const result = await call().listAnnouncements({ courseId: 'course-1' });

    expect(result).toEqual({ items: [] });
    expect(userGet).not.toHaveBeenCalled();
  });

  it('only reads the requested course and the caller from the token', async () => {
    await call().listAnnouncements({ courseId: 'course-1' });

    expect(announcementPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ courseId: 'course-1' }),
    );
    expect(enrolmentGet).toHaveBeenCalledWith({
      courseId: 'course-1',
      userId: STUDENT_SUB,
    });
  });

  it('passes the cursor and limit on, so every item is read once across pages', async () => {
    announcementPage
      .mockResolvedValueOnce({
        items: [stored('c'), stored('b')],
        cursor: 'p2',
      })
      .mockResolvedValueOnce({ items: [stored('a')] });

    const first = await call().listAnnouncements({
      courseId: 'course-1',
      limit: 2,
    });
    const second = await call().listAnnouncements({
      courseId: 'course-1',
      limit: 2,
      cursor: first.cursor,
    });

    expect(announcementPage).toHaveBeenLastCalledWith(expect.anything(), {
      courseId: 'course-1',
      cursor: 'p2',
      limit: 2,
    });
    expect(
      [...first.items, ...second.items].map((item) => item.announcementId),
    ).toEqual(['c', 'b', 'a']);
    expect(second.cursor).toBeUndefined();
  });

  it('lists for an enrolled student of an archived course', async () => {
    courseGet.mockReturnValue(
      resolves({ courseId: 'course-1', status: 'archived' }),
    );
    announcementPage.mockResolvedValue({ items: [stored('a')] });

    const result = await call().listAnnouncements({ courseId: 'course-1' });

    expect(result.items).toHaveLength(1);
  });

  it.each([
    ['not enrolled', null],
    [
      'dropped',
      { courseId: 'course-1', userId: STUDENT_SUB, status: 'dropped' },
    ],
  ])(
    'refuses a student who is %s in a published course',
    async (_, enrolment) => {
      enrolmentGet.mockReturnValue(resolves(enrolment));

      await expect(
        call().listAnnouncements({ courseId: 'course-1' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(announcementPage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['not enrolled', null],
    [
      'dropped',
      { courseId: 'course-1', userId: STUDENT_SUB, status: 'dropped' },
    ],
  ])(
    'answers NOT_FOUND for a student who is %s in an unpublished course',
    async (_, enrolment) => {
      courseGet.mockReturnValue(
        resolves({ courseId: 'course-1', status: 'draft' }),
      );
      enrolmentGet.mockReturnValue(resolves(enrolment));

      await expect(
        call().listAnnouncements({ courseId: 'course-1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(announcementPage).not.toHaveBeenCalled();
    },
  );

  it('answers NOT_FOUND for an unknown course', async () => {
    courseGet.mockReturnValue(resolves(null));

    await expect(
      call().listAnnouncements({ courseId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(announcementPage).not.toHaveBeenCalled();
  });

  it('answers BAD_REQUEST when the table refuses the cursor', async () => {
    const { AnnouncementInputError } = await import('@discava/core-table');
    announcementPage.mockRejectedValue(
      new AnnouncementInputError('cursor is not for this course'),
    );

    await expect(
      call().listAnnouncements({ courseId: 'course-1', cursor: 'other' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it.each([0, 21, 1.5])('rejects a limit of %s', async (limit) => {
    await expect(
      call().listAnnouncements({ courseId: 'course-1', limit }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('takes no user id', () => {
    expect(Object.keys(ListAnnouncementsInputSchema.shape)).toEqual([
      'courseId',
      'cursor',
      'limit',
    ]);
  });
});
