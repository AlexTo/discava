/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { NOTIFICATION_TYPES } from '@discava/core-table';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { createAnnouncement, listAnnouncements } from './announcement.js';

const {
  announcementGet,
  announcementPage,
  announcementWrites,
  courseGet,
  courseInstructorGet,
  userGet,
  transactionWrite,
  transactionGo,
} = vi.hoisted(() => ({
  announcementGet: vi.fn(),
  announcementPage: vi.fn(),
  announcementWrites: vi.fn(),
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  userGet: vi.fn(),
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
}));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  announcementPage,
  announcementWrites,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      announcement: { get: announcementGet },
      course: { get: courseGet },
      courseInstructor: { get: courseInstructorGet },
      user: { get: userGet },
    },
    transaction: { write: transactionWrite },
  })),
}));

const router = t.router({ createAnnouncement, listAnnouncements });
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const ID = '0192f3a0-7c00-7000-8000-000000000001';
const doc = (...text: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: text.map((value) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: value }],
    })),
  });
const BODY = doc('Welcome to the course.');

const course = {
  courseId: 'course-1',
  title: 'Intro to DynamoDB',
  status: 'published' as const,
};
const stored = {
  courseId: 'course-1',
  announcementId: ID,
  title: 'Welcome',
  body: BODY,
  authorId: INSTRUCTOR_SUB,
  createdAt: '2026-11-16T10:00:00.000Z',
  version: 1,
};
const input = {
  courseId: 'course-1',
  announcementId: ID,
  title: 'Welcome',
  body: BODY,
};

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

beforeEach(() => {
  vi.resetAllMocks();
  courseInstructorGet.mockReturnValue(
    resolves({ courseId: 'course-1', instructorId: INSTRUCTOR_SUB }),
  );
  courseGet.mockReturnValue(resolves(course));
  announcementGet.mockReturnValue(resolves(stored));
  userGet.mockReturnValue(
    resolves([
      { userId: INSTRUCTOR_SUB, givenName: 'Alice', familyName: 'Smith' },
    ]),
  );
  announcementWrites.mockReturnValue(['post', 'member', 'course', 'broadcast']);
  transactionWrite.mockImplementation((fn) => {
    fn({});
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('createAnnouncement', () => {
  it.each([
    ['a student-group caller', ['student']],
    ['a caller in no group', []],
  ])('refuses %s and writes nothing', async (_, groups) => {
    await expect(
      callAs(groups).createAnnouncement(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses an instructor, or an admin, who is not on the course', async () => {
    courseInstructorGet.mockReturnValue(resolves(null));

    for (const groups of [['instructor'], ['instructor', 'admin']]) {
      await expect(
        callAs(groups).createAnnouncement(input),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(announcementWrites).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for a missing course', async () => {
    courseGet.mockReturnValue(resolves(null));

    await expect(callAs().createAnnouncement(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it.each(['draft', 'archived'])(
    'answers PRECONDITION_FAILED for a %s course',
    async (status) => {
      courseGet.mockReturnValue(resolves({ ...course, status }));

      await expect(callAs().createAnnouncement(input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['an empty title', { title: '   ' }],
    ['a title over 120 characters', { title: 'x'.repeat(121) }],
    ['a body that is not a document', { body: 'plain text' }],
    [
      'a body with no text',
      {
        body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
      },
    ],
    ['a body over 20,000 characters', { body: doc('x'.repeat(20_001)) }],
    ['an id that is not a UUID', { announcementId: 'nope' }],
  ])('answers BAD_REQUEST for %s', async (_, over) => {
    await expect(
      callAs().createAnnouncement({ ...input, ...over }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('answers BAD_REQUEST for an id the helper refuses (its time is off)', async () => {
    const { AnnouncementInputError } = await import('@discava/core-table');
    announcementWrites.mockImplementation(() => {
      throw new AnnouncementInputError('announcementId is too old');
    });

    await expect(callAs().createAnnouncement(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('posts with params the registry accepts and a short plain-text excerpt', async () => {
    const result = await callAs().createAnnouncement({
      ...input,
      title: '  Welcome  ',
      body: doc('word '.repeat(200)),
    });

    expect(announcementWrites).toHaveBeenCalledTimes(1);
    const [, write] = announcementWrites.mock.calls[0];
    expect(write).toMatchObject({
      courseId: 'course-1',
      courseTitle: 'Intro to DynamoDB',
      announcementId: ID,
      authorId: INSTRUCTOR_SUB,
    });
    expect(write.excerpt.length).toBeLessThanOrEqual(200);
    expect(write.excerpt.endsWith('…')).toBe(true);
    // The params the helper turns this into are the ones the type declares.
    const params = {
      courseId: write.courseId,
      courseTitle: write.courseTitle,
      announcementTitle: write.title,
      excerpt: write.excerpt,
    };
    expect(Object.keys(params)).toEqual(
      NOTIFICATION_TYPES['announcement.posted'].params,
    );
    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      announcementId: ID,
      authorName: 'Alice Smith',
      version: 1,
    });
  });

  it('answers a retry of the same post with the stored announcement', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [
        { code: 'ConditionalCheckFailed' },
        undefined,
        undefined,
        undefined,
      ],
    });

    await expect(callAs().createAnnouncement(input)).resolves.toMatchObject({
      announcementId: ID,
      title: 'Welcome',
    });
  });

  it('answers CONFLICT when another post holds the id', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'ConditionalCheckFailed' }],
    });
    announcementGet.mockReturnValue(resolves({ ...stored, title: 'Other' }));

    await expect(callAs().createAnnouncement(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('answers FORBIDDEN when the membership was removed meanwhile', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [undefined, { code: 'ConditionalCheckFailed' }],
    });
    announcementGet.mockReturnValue(resolves(null));

    await expect(callAs().createAnnouncement(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('answers PRECONDITION_FAILED when the course stopped being published', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [undefined, undefined, { code: 'ConditionalCheckFailed' }],
    });
    announcementGet.mockReturnValue(resolves(null));

    await expect(callAs().createAnnouncement(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('answers CONFLICT for a transaction conflict', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'TransactionConflict' }],
    });
    announcementGet.mockReturnValue(resolves(null));

    await expect(callAs().createAnnouncement(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('listAnnouncements', () => {
  const second = {
    ...stored,
    announcementId: '0192f3a0-7c00-7000-8000-000000000002',
    authorId: 'instructor-2',
    editedAt: '2026-11-16T11:00:00.000Z',
    version: 2,
  };

  it.each([['a student-group caller', ['student']]])(
    'refuses %s',
    async (_, groups) => {
      await expect(
        callAs(groups).listAnnouncements({ courseId: 'course-1' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(announcementPage).not.toHaveBeenCalled();
    },
  );

  it('refuses an instructor, or an admin, who is not on the course', async () => {
    courseInstructorGet.mockReturnValue(resolves(null));

    for (const groups of [['instructor'], ['instructor', 'admin']]) {
      await expect(
        callAs(groups).listAnnouncements({ courseId: 'course-1' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(announcementPage).not.toHaveBeenCalled();
  });

  it('returns the page with author names, falling back to "Instructor"', async () => {
    announcementPage.mockResolvedValue({
      items: [second, stored],
      cursor: 'next',
    });

    const result = await callAs().listAnnouncements({ courseId: 'course-1' });

    expect(announcementPage).toHaveBeenCalledWith(expect.anything(), {
      courseId: 'course-1',
      cursor: undefined,
      limit: 20,
    });
    expect(result.cursor).toBe('next');
    expect(result.items.map((i) => i.announcementId)).toEqual([
      second.announcementId,
      ID,
    ]);
    expect(result.items.map((i) => i.authorName)).toEqual([
      'Instructor',
      'Alice Smith',
    ]);
    expect(result.items[0].editedAt).toBe(second.editedAt);
    expect(result.items[1]).not.toHaveProperty('editedAt');
  });

  it('reads the authors of the page with one batch get', async () => {
    announcementPage.mockResolvedValue({ items: [stored, stored, second] });

    await callAs().listAnnouncements({ courseId: 'course-1' });

    expect(userGet).toHaveBeenCalledTimes(1);
    expect(userGet).toHaveBeenCalledWith([
      { userId: INSTRUCTOR_SUB },
      { userId: 'instructor-2' },
    ]);
  });

  it('reads no users for an empty page, and lists an archived course', async () => {
    courseGet.mockReturnValue(resolves({ ...course, status: 'archived' }));
    announcementPage.mockResolvedValue({ items: [] });

    await expect(
      callAs().listAnnouncements({ courseId: 'course-1', limit: 5 }),
    ).resolves.toEqual({ items: [] });
    expect(userGet).not.toHaveBeenCalled();
    expect(announcementPage).toHaveBeenCalledWith(expect.anything(), {
      courseId: 'course-1',
      cursor: undefined,
      limit: 5,
    });
  });

  it('answers BAD_REQUEST for a limit over 20 and for a refused cursor', async () => {
    await expect(
      callAs().listAnnouncements({ courseId: 'course-1', limit: 21 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const { AnnouncementInputError } = await import('@discava/core-table');
    announcementPage.mockRejectedValue(
      new AnnouncementInputError('cursor is not for this course'),
    );
    await expect(
      callAs().listAnnouncements({ courseId: 'course-1', cursor: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
