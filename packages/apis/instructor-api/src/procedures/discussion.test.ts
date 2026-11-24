/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { MAX_TRANSACTION_ATTEMPTS } from '@discava/common-server-utils/transaction-retry';
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  dismissReports,
  hide,
  remove,
  reported,
  unanswered,
  unhide,
} from './discussion.js';

const {
  courseGet,
  courseInstructorGet,
  lessonGet,
  discussionPostGet,
  discussionPostQueryByUnanswered,
  discussionPostQueryByReported,
  transactionWrite,
  transactionGo,
  discussionWrites,
  mockModule,
} = await vi.hoisted(async () => ({
  transactionGo: vi.fn(),
  discussionWrites: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    course: ['get'],
    courseInstructor: ['get'],
    lesson: ['get'],
    discussionPost: ['get', 'query.byUnanswered', 'query.byReported'],
    transaction: ['write'],
  }),
}));

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal(), { discussionWrites }),
);

const router = t.router({
  unanswered,
  reported,
  hide,
  unhide,
  remove,
  dismissReports,
});

const SUB = 'instructor-1';
const COURSE_ID = 'course-1';

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: SUB, groups });

const resolves = (data: unknown, cursor?: string) => ({
  go: vi.fn().mockResolvedValue({ data, cursor }),
});

const stored = (overrides: Record<string, unknown> = {}) => ({
  courseId: COURSE_ID,
  moduleId: 'm1',
  lessonId: 'l1',
  kind: 'question',
  threadId: 'q1',
  postId: 'q1',
  authorId: 'student-1',
  authorName: 'Sam',
  authorIsInstructor: false,
  title: 'Why?',
  body: 'Because?',
  state: 'shown',
  replyCount: 0,
  instructorReplyCount: 0,
  voteCount: 2,
  reportedBy: new Set(['a', 'b']),
  createdAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const reply = (overrides: Record<string, unknown> = {}) =>
  stored({
    kind: 'reply',
    postId: 'r1',
    title: undefined,
    body: 'An answer',
    ...overrides,
  });

const ref = {
  courseId: COURSE_ID,
  moduleId: 'm1',
  lessonId: 'l1',
  threadId: 'q1',
  postId: 'q1',
};
const replyRef = { ...ref, postId: 'r1' };

// discussionPostGet answers by the post's kind and id, as the table does.
const posts = (...all: Record<string, unknown>[]) =>
  discussionPostGet.mockImplementation(
    (key: { courseId: string; kind: string; postId: string }) =>
      resolves(
        all.find(
          (p) =>
            p.courseId === key.courseId &&
            p.kind === key.kind &&
            p.postId === key.postId,
        ) ?? null,
      ),
  );

beforeEach(() => {
  vi.resetAllMocks();
  courseInstructorGet.mockReturnValue(
    resolves({ courseId: COURSE_ID, instructorId: SUB }),
  );
  courseGet.mockReturnValue(resolves({ courseId: COURSE_ID }));
  lessonGet.mockImplementation(({ lessonId }: { lessonId: string }) =>
    resolves({ lessonId, title: `Title of ${lessonId}` }),
  );
  discussionWrites.mockReturnValue([]);
  transactionWrite.mockReturnValue({ go: transactionGo });
  transactionGo.mockResolvedValue({ canceled: false });
  posts(stored(), reply());
});

const encode = (key: object) =>
  Buffer.from(JSON.stringify(key)).toString('base64url');

const procedures = [
  ['unanswered', { courseId: COURSE_ID }],
  ['reported', { courseId: COURSE_ID }],
  ['hide', ref],
  ['unhide', ref],
  ['remove', ref],
  ['dismissReports', ref],
] as const;

describe('access', () => {
  it.each(procedures)('%s refuses a student', async (name, input) => {
    await expect(
      (callAs(['student']) as any)[name](input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(procedures)(
    '%s refuses an instructor or an admin not listed on the course',
    async (name, input) => {
      courseInstructorGet.mockReturnValue(resolves(null));

      await expect(
        (callAs(['instructor', 'admin']) as any)[name](input),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  it.each(procedures)(
    '%s says NOT_FOUND for a missing course',
    async (name, input) => {
      courseInstructorGet.mockReturnValue(resolves(null));
      courseGet.mockReturnValue(resolves(null));

      await expect((callAs() as any)[name](input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    },
  );

  it.each([
    ['hide', ref],
    ['unhide', ref],
    ['remove', ref],
    ['dismissReports', ref],
  ] as const)(
    '%s does not find a post of another course',
    async (name, input) => {
      posts(stored({ courseId: 'course-2' }));

      await expect((callAs() as any)[name](input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );
});

describe('unanswered and reported', () => {
  it('lists the unanswered queue oldest first, 20 a page, with lesson titles', async () => {
    const query = resolves(
      [
        stored(),
        stored({
          threadId: 'q2',
          postId: 'q2',
          lessonId: 'l2',
          moduleId: 'm2',
        }),
        stored({ threadId: 'q3', postId: 'q3' }),
      ],
      'next',
    );
    discussionPostQueryByUnanswered.mockReturnValue(query);

    const page = await callAs().unanswered({ courseId: COURSE_ID });

    expect(discussionPostQueryByUnanswered).toHaveBeenCalledWith({
      unanswered: COURSE_ID,
    });
    expect(query.go).toHaveBeenCalledWith({ limit: 20, cursor: undefined });
    expect(page.items.map((p) => [p.postId, p.lessonTitle])).toEqual([
      ['q1', 'Title of l1'],
      ['q2', 'Title of l2'],
      ['q3', 'Title of l1'],
    ]);
    // The rows carry their lesson's ids for the moderation calls.
    expect(page.items.map((p) => [p.moduleId, p.lessonId])).toEqual([
      ['m1', 'l1'],
      ['m2', 'l2'],
      ['m1', 'l1'],
    ]);
    expect(page.cursor).toBe('next');
    // One get per distinct lesson.
    expect(lessonGet).toHaveBeenCalledTimes(2);
    expect(lessonGet).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: 'm2',
      lessonId: 'l2',
    });
  });

  it('returns an empty page without reading lessons', async () => {
    discussionPostQueryByUnanswered.mockReturnValue(resolves([]));

    expect(await callAs().unanswered({ courseId: COURSE_ID })).toEqual({
      items: [],
    });
    expect(lessonGet).not.toHaveBeenCalled();
  });

  it('pages with the cursor it is given', async () => {
    const query = resolves([stored()]);
    discussionPostQueryByUnanswered.mockReturnValue(query);
    const cursor = encode({ pk: `$core#courseid_${COURSE_ID}` });

    const page = await callAs().unanswered({ courseId: COURSE_ID, cursor });

    expect(query.go).toHaveBeenCalledWith({ limit: 20, cursor });
    expect(page.cursor).toBeUndefined();
  });

  it.each(['unanswered', 'reported'] as const)(
    '%s refuses a cursor of another course',
    async (name) => {
      await expect(
        callAs()[name]({
          courseId: COURSE_ID,
          cursor: encode({ pk: '$core#courseid_other' }),
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        callAs()[name]({ courseId: COURSE_ID, cursor: 'not-a-cursor' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(discussionPostQueryByUnanswered).not.toHaveBeenCalled();
      expect(discussionPostQueryByReported).not.toHaveBeenCalled();
    },
  );

  it('gives reportCount as the size of the set and never the reporters', async () => {
    discussionPostQueryByUnanswered.mockReturnValue(resolves([stored()]));

    const { items } = await callAs().unanswered({ courseId: COURSE_ID });

    expect(items[0]?.reportCount).toBe(2);
    expect(JSON.stringify(items)).not.toContain('reportedBy');
    expect(items[0]).toMatchObject({
      authorName: 'Sam',
      title: 'Why?',
      answered: false,
      accepted: false,
      mine: false,
    });
  });

  it('lists reported questions and replies from the discussionPostQueryByReported index', async () => {
    const query = resolves([stored(), reply()]);
    discussionPostQueryByReported.mockReturnValue(query);

    const { items } = await callAs().reported({ courseId: COURSE_ID });

    expect(discussionPostQueryByReported).toHaveBeenCalledWith({
      reported: COURSE_ID,
    });
    expect(query.go).toHaveBeenCalledWith({ limit: 20, cursor: undefined });
    expect(items.map((p) => [p.kind, p.threadId, p.postId])).toEqual([
      ['question', 'q1', 'q1'],
      ['reply', 'q1', 'r1'],
    ]);
    expect(items[1]).not.toHaveProperty('replyCount');
  });

  it('gives a deleted post no text', async () => {
    discussionPostQueryByReported.mockReturnValue(
      resolves([
        stored({ state: 'deleted', title: undefined, body: undefined }),
      ]),
    );

    const { items } = await callAs().reported({ courseId: COURSE_ID });

    expect(items[0]).toMatchObject({ state: 'deleted' });
    expect(items[0]).not.toHaveProperty('body');
    expect(items[0]).not.toHaveProperty('title');
  });

  it('marks a question answered by an accepted answer or an instructor reply', async () => {
    discussionPostQueryByUnanswered.mockReturnValue(
      resolves([
        stored({ acceptedPostId: 'r1' }),
        stored({ postId: 'q2', instructorReplyCount: 1 }),
      ]),
    );

    const { items } = await callAs().unanswered({ courseId: COURSE_ID });

    expect(items.map((p) => [p.accepted, p.answered])).toEqual([
      [true, true],
      [false, true],
    ]);
  });
});

const ops = () => discussionWrites.mock.calls.map(([, op]) => op);

describe('hide and unhide', () => {
  it('hides a shown question and returns it', async () => {
    posts(stored(), stored({ state: 'hidden' }));
    discussionPostGet
      .mockReturnValueOnce(resolves(stored()))
      .mockReturnValueOnce(resolves(stored({ state: 'hidden' })));
    transactionWrite.mockImplementation((build: any) => {
      build({});
      return { go: transactionGo };
    });

    const post = await callAs().hide(ref);

    expect(post.state).toBe('hidden');
    expect(ops()).toEqual([
      expect.objectContaining({
        type: 'hide',
        courseId: COURSE_ID,
        lessonId: 'l1',
        post: expect.objectContaining({ postId: 'q1', state: 'shown' }),
      }),
    ]);
  });

  it('hides a reply with its question as read, so counts follow', async () => {
    posts(stored({ replyCount: 3, instructorReplyCount: 1 }), reply());
    transactionWrite.mockImplementation((build: any) => {
      build({});
      return { go: transactionGo };
    });

    await callAs().hide(replyRef);

    expect(ops()).toEqual([
      expect.objectContaining({
        type: 'hide',
        post: expect.objectContaining({ kind: 'reply', postId: 'r1' }),
        question: expect.objectContaining({
          threadId: 'q1',
          replyCount: 3,
          instructorReplyCount: 1,
        }),
      }),
    ]);
  });

  it('hiding a hidden post is a no-op', async () => {
    posts(stored({ state: 'hidden' }));

    const post = await callAs().hide(ref);

    expect(post.state).toBe('hidden');
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('unhiding a shown post is a no-op', async () => {
    const post = await callAs().unhide(ref);

    expect(post.state).toBe('shown');
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it.each(['hide', 'unhide'] as const)(
    '%s of a deleted post is NOT_FOUND',
    async (name) => {
      posts(stored({ state: 'deleted' }));

      await expect(callAs()[name](ref)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  it('unhides a hidden question with the record the helper needs', async () => {
    posts(stored({ state: 'hidden', acceptedPostId: 'r1', replyCount: 1 }));
    transactionWrite.mockImplementation((build: any) => {
      build({});
      return { go: transactionGo };
    });

    await callAs().unhide(ref);

    expect(ops()).toEqual([
      expect.objectContaining({
        type: 'unhide',
        question: expect.objectContaining({
          state: 'hidden',
          acceptedPostId: 'r1',
          createdAt: '2024-01-01T00:00:00.000Z',
        }),
      }),
    ]);
  });

  it('refuses to unhide a reply past 500 shown replies', async () => {
    posts(stored({ replyCount: 500 }), reply({ state: 'hidden' }));

    await expect(callAs().unhide(replyRef)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('works for an archived course and lesson: no lifecycle check is read', async () => {
    courseGet.mockReturnValue(
      resolves({ courseId: COURSE_ID, status: 'archived' }),
    );
    lessonGet.mockReturnValue(resolves({ archivedAt: '2024-02-01' }));

    await callAs().hide(ref);

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(courseGet).not.toHaveBeenCalled();
    expect(lessonGet).not.toHaveBeenCalled();
  });

  it('runs again from the reads after a cancelled transaction, then CONFLICT', async () => {
    transactionGo.mockResolvedValue({ canceled: true });

    await expect(callAs().hide(ref)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(transactionGo).toHaveBeenCalledTimes(MAX_TRANSACTION_ATTEMPTS);
  });

  it('decides on fresh state after a cancelled transaction', async () => {
    transactionGo.mockResolvedValueOnce({ canceled: true });
    discussionPostGet
      .mockReturnValueOnce(resolves(stored()))
      .mockReturnValueOnce(resolves(stored({ state: 'hidden' })));

    const post = await callAs().hide(ref);

    // The second read found it hidden already.
    expect(post.state).toBe('hidden');
    expect(transactionGo).toHaveBeenCalledTimes(1);
  });

  it('turns a refusal from the write helper into BAD_REQUEST', async () => {
    const { DiscussionInputError } = await import('@discava/core-table');
    transactionWrite.mockImplementation(() => {
      throw new DiscussionInputError('nope');
    });

    await expect(callAs().hide(ref)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'nope',
    });
  });
});

describe('remove', () => {
  it('deletes a question with the question as read', async () => {
    posts(stored({ acceptedPostId: 'r1' }));
    transactionWrite.mockImplementation((build: any) => {
      build({});
      return { go: transactionGo };
    });

    await callAs().remove(ref);

    expect(ops()).toEqual([
      expect.objectContaining({
        type: 'delete',
        courseId: COURSE_ID,
        lessonId: 'l1',
        post: expect.objectContaining({ postId: 'q1' }),
        question: expect.objectContaining({ acceptedPostId: 'r1' }),
      }),
    ]);
  });

  it('deletes a hidden reply', async () => {
    posts(stored(), reply({ state: 'hidden' }));
    transactionWrite.mockImplementation((build: any) => {
      build({});
      return { go: transactionGo };
    });

    await callAs().remove(replyRef);

    expect(ops()[0]).toMatchObject({
      type: 'delete',
      post: { kind: 'reply', state: 'hidden' },
    });
  });

  it('removing a deleted post is a no-op', async () => {
    posts(stored({ state: 'deleted', title: undefined, body: undefined }));

    const post = await callAs().remove(ref);

    expect(post.state).toBe('deleted');
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('dismissReports', () => {
  it('clears the reports of a reported post', async () => {
    posts(stored({ reported: COURSE_ID, reportedSince: '2024-01-02' }));
    transactionWrite.mockImplementation((build: any) => {
      build({});
      return { go: transactionGo };
    });

    await callAs().dismissReports(ref);

    expect(ops()).toEqual([
      expect.objectContaining({
        type: 'dismiss',
        courseId: COURSE_ID,
        lessonId: 'l1',
        post: expect.objectContaining({ postId: 'q1' }),
      }),
    ]);
  });

  it('succeeds without a write for a post with no reports', async () => {
    posts(stored({ reportedBy: undefined }));

    const post = await callAs().dismissReports(ref);

    expect(post.reportCount).toBe(0);
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});
