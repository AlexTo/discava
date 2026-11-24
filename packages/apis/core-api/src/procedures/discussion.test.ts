/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { MAX_TRANSACTION_ATTEMPTS } from '@discava/common-server-utils/transaction-retry';
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { DiscussionInputError, postIdTime } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  accept,
  answerPrompt,
  ask,
  listQuestions,
  removeOwn,
  reply,
  report,
  thread,
  vote,
} from './discussion.js';

const { discussionWrites, discussionNotificationWrites, state, write } =
  vi.hoisted(() => ({
    discussionWrites: vi.fn(),
    discussionNotificationWrites: vi.fn(),
    write: vi.fn(),
    state: {} as Record<string, any>,
  }));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  discussionWrites,
  discussionNotificationWrites,
  createCoreTableService: vi.fn(async () => table()),
}));

const postKey = (k: { kind: string; threadId: string; postId: string }) =>
  `${k.kind}/${k.threadId}/${k.postId}`;

const resolves = (read: () => unknown) => ({
  go: async () => ({ data: read() }),
});

// An in-memory stand-in for the parts of the core table the procedures read.
const table = () => ({
  entities: {
    course: { get: () => resolves(() => state.course) },
    module: { get: () => resolves(() => state.module) },
    lesson: { get: () => resolves(() => state.lesson) },
    enrolment: { get: () => resolves(() => state.enrolment) },
    courseInstructor: { get: () => resolves(() => state.instructorRecord) },
    user: { get: () => resolves(() => state.user) },
    discussionPost: {
      get: (key: any) =>
        state.userCalls.push(['post', key]) &&
        resolves(() => state.posts.get(postKey(key)) ?? null),
      query: {
        primary: (key: any) => ({
          go: async (options: unknown) => {
            state.queries.push([key, options]);
            return {
              data: state.page(key),
              cursor: state.nextCursor,
            };
          },
        }),
      },
    },
    discussionVote: {
      get: (key: any) => {
        state.userCalls.push(['vote', key]);
        return Array.isArray(key)
          ? resolves(() =>
              key
                .filter((k) => state.votes.has(k.postId))
                .map((k) => ({ postId: k.postId })),
            )
          : resolves(() => (state.votes.has(key.postId) ? { ...key } : null));
      },
      query: {
        primary: (key: any) => ({
          begins: (prefix: any) => ({
            go: async () => {
              state.userCalls.push(['voteQuery', key, prefix]);
              return {
                data: [...state.votes].map((postId) => ({ postId })),
              };
            },
          }),
        }),
      },
    },
  },
  collections: {
    curriculum: () => ({
      go: async () => {
        state.userCalls.push(['curriculum']);
        return { data: state.curriculum };
      },
    }),
  },
  transaction: {
    write: (build: (entities: unknown) => unknown) => ({
      go: async () => {
        state.built = build({});
        return write();
      },
    }),
  },
});

const router = t.router({
  listQuestions,
  thread,
  ask,
  answerPrompt,
  reply,
  vote,
  accept,
  report,
  removeOwn,
});

const as = (sub: string, groups: string[] = ['student']) =>
  callerFor(router, { sub, groups });

const ref = { courseId: 'c1', moduleId: 'm1', lessonId: 'l1' };
const ASKER = 'asker';
const ME = 'me';
const NEW_ID = '01900000-0000-7000-8000-000000000001';

const stored = (over: Record<string, unknown>) => ({
  courseId: 'c1',
  lessonId: 'l1',
  moduleId: 'm1',
  kind: 'question',
  state: 'shown',
  authorId: ASKER,
  authorName: 'Ann Asker',
  authorIsInstructor: false,
  title: 'Why?',
  body: 'Because',
  createdAt: '2026-11-16T10:00:00.000Z',
  voteCount: 0,
  replyCount: 0,
  instructorReplyCount: 0,
  reportedBy: new Set<string>(),
  ...over,
});

const question = (over: Record<string, unknown> = {}) =>
  stored({ threadId: 'q1', postId: 'q1', ...over });
const replyPost = (id: string, over: Record<string, unknown> = {}) =>
  stored({
    kind: 'reply',
    threadId: 'q1',
    postId: id,
    title: undefined,
    ...over,
  });

const put = (...posts: any[]) => {
  for (const post of posts) {
    state.posts.set(postKey(post), post);
  }
};

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(state, {
    course: { courseId: 'c1', status: 'published' },
    module: { visibility: 'visible' },
    lesson: { visibility: 'visible' },
    enrolment: { status: 'active' },
    curriculum: {
      module: [{ moduleId: 'm1', order: 1, visibility: 'visible' }],
      lesson: [
        { moduleId: 'm1', lessonId: 'l1', order: 1, visibility: 'visible' },
        { moduleId: 'm1', lessonId: 'l2', order: 2, visibility: 'visible' },
      ],
    },
    instructorRecord: null,
    user: { givenName: 'Me', familyName: 'Myself' },
    posts: new Map(),
    votes: new Set<string>(),
    queries: [],
    userCalls: [],
    page: () => [],
    nextCursor: undefined,
  });
  write.mockResolvedValue({ canceled: false });
  discussionWrites.mockReturnValue(['post-item']);
  discussionNotificationWrites.mockResolvedValue(['notification-item']);
});

const asInstructor = () => {
  state.enrolment = null;
  state.instructorRecord = { instructorId: 'teacher' };
  return as('teacher', ['instructor']);
};

// Every procedure with a call the access matrix can be run against.
const calls: Record<string, (c: ReturnType<typeof as>) => Promise<unknown>> = {
  listQuestions: (c) => c.listQuestions(ref),
  thread: (c) => c.thread({ ...ref, threadId: 'q1' }),
  ask: (c) => c.ask({ ...ref, postId: NEW_ID, title: 'T', body: 'B' }),
  answerPrompt: (c) => c.answerPrompt({ ...ref, postId: NEW_ID, body: 'B' }),
  reply: (c) => c.reply({ ...ref, threadId: 'q1', postId: NEW_ID, body: 'B' }),
  vote: (c) => c.vote({ ...ref, threadId: 'q1', postId: 'q1', voted: true }),
  accept: (c) => c.accept({ ...ref, threadId: 'q1', postId: 'r1' }),
  report: (c) => c.report({ ...ref, threadId: 'q1', postId: 'q1' }),
  removeOwn: (c) => c.removeOwn({ ...ref, threadId: 'q1', postId: 'q1' }),
};

describe.each(Object.entries(calls))('%s access', (_name, run) => {
  beforeEach(() => {
    put(question({ authorId: ME }), replyPost('r1', { authorId: 'other' }));
  });

  it('refuses a missing course', async () => {
    state.course = null;
    await expect(run(as(ME))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a student who is not enrolled', async () => {
    state.enrolment = null;
    await expect(run(as(ME))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a dropped student', async () => {
    state.enrolment = { status: 'dropped' };
    await expect(run(as(ME))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an instructor of another course like any student', async () => {
    state.enrolment = null;
    await expect(run(as(ME, ['instructor']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('writes nothing for a refused caller', async () => {
    state.enrolment = null;
    await run(as(ME)).catch(() => undefined);
    expect(write).not.toHaveBeenCalled();
  });
});

describe.each(Object.entries(calls).filter(([name]) => name !== 'removeOwn'))(
  '%s for a hidden lesson',
  (_name, run) => {
    it('is not found for a student', async () => {
      state.lesson = { visibility: 'hidden' };
      put(question());
      await expect(run(as(ME))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  },
);

describe('listQuestions', () => {
  it('returns the page newest first with the cursor, 20 at a time', async () => {
    state.page = () => [question({ postId: 'q2', threadId: 'q2' }), question()];
    state.nextCursor = 'next';
    const result = await as(ME).listQuestions(ref);
    expect(result.items.map((i) => i.postId)).toEqual(['q2', 'q1']);
    expect(result.cursor).toBe('next');
    expect(state.queries[0]).toEqual([
      { courseId: 'c1', kind: 'question', lessonId: 'l1' },
      { order: 'desc', limit: 20, cursor: undefined },
    ]);
  });

  it('keeps the order whatever the votes', async () => {
    state.page = () => [
      question({ postId: 'q2', threadId: 'q2', voteCount: 0 }),
      question({ voteCount: 99 }),
    ];
    const result = await as(ME).listQuestions(ref);
    expect(result.items.map((i) => i.postId)).toEqual(['q2', 'q1']);
  });

  it('passes the cursor on to the table', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ pk: '$x#courseid_c1' }),
    ).toString('base64url');
    await as(ME).listQuestions({ ...ref, cursor });
    expect(state.queries[0][1]).toMatchObject({ cursor });
  });

  it('refuses a cursor that is not of this course', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ pk: '$x#courseid_c2' }),
    ).toString('base64url');
    await expect(
      as(ME).listQuestions({ ...ref, cursor }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      as(ME).listQuestions({ ...ref, cursor: 'not a cursor' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("marks what the caller upvoted and owns, asking for the caller's own votes", async () => {
    state.page = () => [
      question({ postId: 'q2', threadId: 'q2', authorId: ME }),
      question(),
    ];
    state.votes.add('q1');
    const { items } = await as(ME).listQuestions(ref);
    expect(items[0]).toMatchObject({ mine: true, upvotedByMe: false });
    expect(items[1]).toMatchObject({ mine: false, upvotedByMe: true });
    const [, keys] = state.userCalls.find(
      ([kind]: string[]) => kind === 'vote',
    );
    expect(keys.every((k: any) => k.userId === ME)).toBe(true);
    expect(keys).toHaveLength(2);
  });

  it('gives a student only placeholders for hidden and deleted questions', async () => {
    state.page = () => [
      question({ postId: 'q2', threadId: 'q2', state: 'hidden' }),
      question({
        postId: 'q3',
        threadId: 'q3',
        state: 'deleted',
        body: undefined,
      }),
    ];
    const { items } = await as(ME).listQuestions(ref);
    expect(items).toEqual([
      { postId: 'q2', threadId: 'q2', kind: 'question', state: 'hidden' },
      { postId: 'q3', threadId: 'q3', kind: 'question', state: 'deleted' },
    ]);
  });

  it('shows an instructor a hidden question in full, with its report count but not who reported', async () => {
    state.page = () => [
      question({ state: 'hidden', reportedBy: new Set(['a', 'b']) }),
    ];
    const { items } = await asInstructor().listQuestions(ref);
    expect(items[0]).toMatchObject({
      state: 'hidden',
      title: 'Why?',
      body: 'Because',
      authorName: 'Ann Asker',
      reportCount: 2,
    });
    expect(JSON.stringify(items)).not.toContain('reportedBy');
  });

  it('gives students no report count', async () => {
    state.page = () => [question({ reportedBy: new Set(['a']) })];
    const { items } = await as(ME).listQuestions(ref);
    expect(items[0]).not.toHaveProperty('reportCount');
  });

  it('reports accepted and answered', async () => {
    state.page = () => [
      question({ acceptedPostId: 'r1', replyCount: 1 }),
      question({ postId: 'q2', threadId: 'q2', instructorReplyCount: 1 }),
      question({ postId: 'q3', threadId: 'q3' }),
    ];
    const { items } = await as(ME).listQuestions(ref);
    expect(items.map((i) => [i.accepted, i.answered])).toEqual([
      [true, true],
      [false, true],
      [false, false],
    ]);
  });
});

describe('thread', () => {
  it('is not found for a question that does not exist', async () => {
    await expect(
      as(ME).thread({ ...ref, threadId: 'q1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns replies oldest first, 50 a page, and the accepted one apart', async () => {
    put(question({ acceptedPostId: 'r2' }), replyPost('r2'));
    state.page = () => [replyPost('r1'), replyPost('r2'), replyPost('r3')];
    state.nextCursor = 'more';
    state.votes.add('r3');
    const result = await as(ME).thread({ ...ref, threadId: 'q1' });
    expect(result.accepted?.postId).toBe('r2');
    expect(result.replies.map((r) => r.postId)).toEqual(['r1', 'r3']);
    expect(result.replies[1].upvotedByMe).toBe(true);
    expect(result.cursor).toBe('more');
    expect(state.queries[0]).toEqual([
      { courseId: 'c1', kind: 'reply', lessonId: 'l1', threadId: 'q1' },
      { order: 'asc', limit: 50, cursor: undefined },
    ]);
    const query = state.userCalls.find(
      ([kind]: string[]) => kind === 'voteQuery',
    );
    expect(query[1]).toEqual({ courseId: 'c1', userId: ME });
    expect(query[2]).toEqual({ lessonId: 'l1', threadId: 'q1' });
  });

  it('gives a student a placeholder and no replies for a hidden or deleted question', async () => {
    for (const hidden of ['hidden', 'deleted']) {
      put(question({ state: hidden }));
      state.page = () => [replyPost('r1')];
      const result = await as(ME).thread({ ...ref, threadId: 'q1' });
      expect(result).toEqual({
        question: {
          postId: 'q1',
          threadId: 'q1',
          kind: 'question',
          state: hidden,
        },
        replies: [],
      });
    }
  });

  it('shows hidden replies to a student as placeholders only', async () => {
    put(question());
    state.page = () => [replyPost('r1', { state: 'hidden' })];
    const result = await as(ME).thread({ ...ref, threadId: 'q1' });
    expect(result.replies).toEqual([
      { postId: 'r1', threadId: 'q1', kind: 'reply', state: 'hidden' },
    ]);
  });

  it('shows an instructor a hidden question and its replies in full', async () => {
    put(question({ state: 'hidden' }));
    state.page = () => [replyPost('r1', { state: 'hidden' })];
    const result = await asInstructor().thread({ ...ref, threadId: 'q1' });
    expect(result.question.title).toBe('Why?');
    expect(result.replies[0].body).toBe('Because');
  });

  it("refuses another course's cursor", async () => {
    put(question());
    const cursor = Buffer.from(JSON.stringify({ pk: 'c2' })).toString(
      'base64url',
    );
    await expect(
      as(ME).thread({ ...ref, threadId: 'q1', cursor }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('answerPrompt', () => {
  const input = { ...ref, postId: NEW_ID, body: ' I want to build ' };
  const created = (over: Record<string, unknown> = {}) =>
    put(
      question({
        postId: NEW_ID,
        threadId: NEW_ID,
        authorId: ME,
        promptAnswer: true,
        ...over,
      }),
    );

  it('writes the answer as the caller, with no notification', async () => {
    write.mockImplementation(async () => (created(), { canceled: false }));
    const post = await as(ME).answerPrompt(input);
    expect(post).toMatchObject({
      postId: NEW_ID,
      kind: 'question',
      promptAnswer: true,
      answered: true,
      mine: true,
    });
    expect(discussionWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'answerPrompt',
        ...ref,
        postId: NEW_ID,
        author: { userId: ME, name: 'Me Myself', isInstructor: false },
        body: ' I want to build ',
      }),
    );
    expect(discussionNotificationWrites).not.toHaveBeenCalled();
    expect(state.built).toEqual(['post-item']);
  });

  it('reads the curriculum once, even when a cancelled write is retried', async () => {
    write.mockResolvedValueOnce({ canceled: true });
    write.mockImplementation(async () => (created(), { canceled: false }));
    await as(ME).answerPrompt(input);
    expect(write).toHaveBeenCalledTimes(2);
    expect(
      state.userCalls.filter(([kind]: string[]) => kind === 'curriculum'),
    ).toHaveLength(1);
  });

  it('returns the existing answer for a retry by the same author, writing nothing', async () => {
    created();
    const post = await as(ME).answerPrompt(input);
    expect(post.postId).toBe(NEW_ID);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses an id another user, or an ordinary question, already used', async () => {
    created({ authorId: 'someone' });
    await expect(as(ME).answerPrompt(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    state.posts.clear();
    created({ promptAnswer: undefined });
    await expect(as(ME).answerPrompt(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it.each(['answered', 'dismissed'])(
    'refuses a learner whose prompt is %s',
    async (firstLessonPromptState) => {
      state.enrolment = { status: 'active', firstLessonPromptState };
      await expect(as(ME).answerPrompt(input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: "You've already answered or dismissed this prompt",
      });
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('refuses a lesson that is not the first shown lesson', async () => {
    await expect(
      as(ME).answerPrompt({ ...input, lessonId: 'l2' }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: "This prompt belongs to the course's first lesson",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('takes the first shown lesson when the first one is hidden', async () => {
    state.curriculum.lesson[0].visibility = 'hidden';
    await expect(as(ME).answerPrompt(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    write.mockImplementation(async () => (created(), { canceled: false }));
    state.lesson = { visibility: 'visible' };
    await as(ME).answerPrompt({ ...input, lessonId: 'l2' });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('refuses an instructor of the course who is not enrolled', async () => {
    await expect(asInstructor().answerPrompt(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('lets an instructor who is also enrolled answer, as the instructor', async () => {
    state.enrolment = { status: 'active' };
    state.instructorRecord = { instructorId: 'teacher' };
    write.mockImplementation(
      async () => (created({ authorId: 'teacher' }), { canceled: false }),
    );
    await as('teacher', ['instructor']).answerPrompt(input);
    expect(discussionWrites.mock.calls[0][1].author).toMatchObject({
      userId: 'teacher',
      isInstructor: true,
    });
  });

  it('refuses a signed-out caller', async () => {
    await expect(callerFor(router).answerPrompt(input)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it.each([
    ['an archived course', () => (state.course = { status: 'archived' })],
    ['a draft course', () => (state.course = { status: 'draft' })],
  ])('is closed for %s', async (_n, change) => {
    change();
    await expect(as(ME).answerPrompt(input)).rejects.toMatchObject({
      code: expect.stringMatching(/PRECONDITION_FAILED|NOT_FOUND/),
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('turns a bad body into BAD_REQUEST', async () => {
    discussionWrites.mockImplementation(() => {
      throw new DiscussionInputError('body must not be empty');
    });
    await expect(
      as(ME).answerPrompt({ ...input, body: '  ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('retries a cancelled write with backoff, then conflicts', async () => {
    write.mockResolvedValue({ canceled: true });
    await expect(as(ME).answerPrompt(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(write).toHaveBeenCalledTimes(MAX_TRANSACTION_ATTEMPTS);
  });
});

describe('a prompt answer in a list', () => {
  it('shows promptAnswer to a student, and not on a hidden answer', async () => {
    state.page = () => [
      question({ postId: 'p1', threadId: 'p1', promptAnswer: true }),
      question({
        postId: 'p2',
        threadId: 'p2',
        promptAnswer: true,
        state: 'hidden',
      }),
    ];
    const { items } = await as(ME).listQuestions(ref);
    expect(items[0]).toMatchObject({ promptAnswer: true, answered: true });
    expect(items[1]).not.toHaveProperty('promptAnswer');
  });
});

describe('ask', () => {
  const input = { ...ref, postId: NEW_ID, title: ' Why? ', body: ' Because ' };
  const created = () =>
    put(question({ postId: NEW_ID, threadId: NEW_ID, authorId: ME }));

  it('writes the question as the caller, named from their record', async () => {
    write.mockImplementation(async () => (created(), { canceled: false }));
    const post = await as(ME).ask(input);
    expect(post).toMatchObject({
      postId: NEW_ID,
      kind: 'question',
      mine: true,
    });
    expect(discussionWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'ask',
        ...ref,
        postId: NEW_ID,
        author: { userId: ME, name: 'Me Myself', isInstructor: false },
        title: ' Why? ',
        body: ' Because ',
      }),
    );
  });

  it("marks an instructor's question, with no enrolment needed", async () => {
    write.mockImplementation(async () => (created(), { canceled: false }));
    await asInstructor().ask(input);
    expect(discussionWrites.mock.calls[0][1].author).toMatchObject({
      userId: 'teacher',
      isInstructor: true,
    });
  });

  it('returns the existing question for a retry by the same author, writing nothing', async () => {
    created();
    const post = await as(ME).ask(input);
    expect(post.postId).toBe(NEW_ID);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses an id another user already used', async () => {
    put(question({ postId: NEW_ID, threadId: NEW_ID, authorId: 'someone' }));
    await expect(as(ME).ask(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('yields one post when a cancelled write is retried and the first had landed', async () => {
    write.mockImplementationOnce(async () => (created(), { canceled: true }));
    const post = await as(ME).ask(input);
    expect(post.postId).toBe(NEW_ID);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('retries a cancelled write with backoff, then conflicts', async () => {
    write.mockResolvedValue({ canceled: true });
    await expect(as(ME).ask(input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(write).toHaveBeenCalledTimes(MAX_TRANSACTION_ATTEMPTS);
  });

  it.each([
    ['an archived course', () => (state.course = { status: 'archived' })],
    ['a draft course', () => (state.course = { status: 'draft' })],
  ])('is closed for %s, even for an instructor', async (_n, change) => {
    const teacher = asInstructor();
    change();
    await expect(teacher.ask(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Questions are closed for this lesson',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('is closed for an archived lesson an instructor can still reach', async () => {
    const teacher = asInstructor();
    state.lesson = { visibility: 'visible', archivedAt: 'then' };
    await expect(teacher.ask(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('is closed when the course stops being published between the read and the write', async () => {
    write.mockImplementationOnce(async () => {
      state.course = { status: 'archived' };
      return { canceled: true };
    });
    await expect(as(ME).ask(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it("passes the helper's input errors on as BAD_REQUEST, naming the field", async () => {
    discussionWrites.mockImplementation(() => {
      throw Object.assign(new Error('title must not be empty'), {
        name: 'DiscussionInputError',
      });
    });
    const { DiscussionInputError } = await import('@discava/core-table');
    discussionWrites.mockImplementation(() => {
      throw new DiscussionInputError('title must not be empty');
    });
    await expect(as(ME).ask(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'title must not be empty',
    });
  });

  it('stores markup as typed', async () => {
    write.mockImplementation(async () => (created(), { canceled: false }));
    await as(ME).ask({
      ...input,
      title: '<b>x</b>',
      body: '<script>1</script>',
    });
    expect(discussionWrites.mock.calls[0][1]).toMatchObject({
      title: '<b>x</b>',
      body: '<script>1</script>',
    });
  });
});

describe('reply', () => {
  const input = { ...ref, threadId: 'q1', postId: NEW_ID, body: 'Because' };
  const created = (over: Record<string, unknown> = {}) =>
    put(replyPost(NEW_ID, { authorId: ME, ...over }));

  beforeEach(() => put(question()));

  it("writes a student's reply without the instructor badge", async () => {
    write.mockImplementation(async () => (created(), { canceled: false }));
    const post = await as(ME).reply(input);
    expect(post).toMatchObject({ kind: 'reply', mine: true });
    expect(discussionWrites.mock.calls[0][1]).toMatchObject({
      type: 'reply',
      threadId: 'q1',
      author: { userId: ME, isInstructor: false },
    });
  });

  it('adds the notification items to the same transaction', async () => {
    write.mockImplementation(async () => (created(), { canceled: false }));
    // The post id's own time, so that it is within the 10 minute window.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(postIdTime(NEW_ID));
    try {
      await as(ME).reply(input);
    } finally {
      vi.useRealTimers();
    }
    expect(state.built).toEqual(['post-item', 'notification-item']);
    expect(discussionNotificationWrites.mock.calls[0][1]).toMatchObject({
      kind: 'reply',
      question: { authorId: ASKER, postId: 'q1' },
      reply: { authorId: ME, postId: NEW_ID, body: 'Because', state: 'shown' },
    });
  });

  it('adds no notification items when the helper returns none (a self-reply)', async () => {
    discussionNotificationWrites.mockResolvedValue([]);
    write.mockImplementation(async () => (created(), { canceled: false }));
    await as(ME).reply(input);
    expect(state.built).toEqual(['post-item']);
  });

  it('leaves no notification when the post fails: a cancelled write is retried, then CONFLICT', async () => {
    write.mockResolvedValue({ canceled: true });
    await expect(as(ME).reply(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(state.posts.has(`reply/q1/${NEW_ID}`)).toBe(false);
  });

  it('treats a duplicate notification cancellation as already done', async () => {
    write
      .mockImplementationOnce(async () => (created(), { canceled: true }))
      .mockResolvedValue({ canceled: false });
    await expect(as(ME).reply(input)).resolves.toMatchObject({ mine: true });
    // The second pass found the reply and wrote nothing more.
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("badges an instructor's reply, without enrolment", async () => {
    write.mockImplementation(async () => (created(), { canceled: false }));
    await asInstructor().reply(input);
    expect(discussionWrites.mock.calls[0][1].author.isInstructor).toBe(true);
  });

  it("refuses a postId equal to the question's id, writing nothing", async () => {
    await expect(
      as(ME).reply({ ...input, postId: 'q1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(write).not.toHaveBeenCalled();
  });

  it('returns the existing reply for a retry by its author', async () => {
    created();
    await as(ME).reply(input);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses an id used by another user', async () => {
    created({ authorId: 'someone' });
    await expect(as(ME).reply(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('is not found when the question is gone, hidden or deleted', async () => {
    for (const change of [{ state: 'hidden' }, { state: 'deleted' }]) {
      put(question(change));
      await expect(as(ME).reply(input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    state.posts.clear();
    await expect(as(ME).reply(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('stops at 500 visible replies', async () => {
    put(question({ replyCount: 500 }));
    await expect(as(ME).reply(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This question has reached its reply limit',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('decides a cancelled write on a fresh read: the question was hidden meanwhile', async () => {
    write.mockImplementationOnce(async () => {
      put(question({ state: 'hidden' }));
      return { canceled: true };
    });
    await expect(as(ME).reply(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('decides a cancelled write on a fresh read: the 500th reply landed meanwhile', async () => {
    write.mockImplementationOnce(async () => {
      put(question({ replyCount: 500 }));
      return { canceled: true };
    });
    await expect(as(ME).reply(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('is closed for an archived course', async () => {
    state.course = { status: 'archived' };
    await expect(as(ME).reply(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});

describe('vote', () => {
  const input = { ...ref, threadId: 'q1', postId: 'q1' };

  beforeEach(() => put(question()));

  it("adds the caller's vote and returns the new count", async () => {
    write.mockImplementation(async () => {
      state.votes.add('q1');
      put(question({ voteCount: 1 }));
      return { canceled: false };
    });
    expect(await as(ME).vote({ ...input, voted: true })).toEqual({
      voteCount: 1,
      upvotedByMe: true,
    });
    expect(discussionWrites.mock.calls[0][1]).toMatchObject({
      type: 'vote',
      userId: ME,
    });
  });

  it('takes the vote back', async () => {
    state.votes.add('q1');
    put(question({ voteCount: 1 }));
    write.mockImplementation(async () => {
      state.votes.delete('q1');
      put(question({ voteCount: 0 }));
      return { canceled: false };
    });
    expect(await as(ME).vote({ ...input, voted: false })).toEqual({
      voteCount: 0,
      upvotedByMe: false,
    });
    expect(discussionWrites.mock.calls[0][1].type).toBe('unvote');
  });

  it('succeeds without a write when the state is already set', async () => {
    state.votes.add('q1');
    put(question({ voteCount: 1 }));
    expect(await as(ME).vote({ ...input, voted: true })).toEqual({
      voteCount: 1,
      upvotedByMe: true,
    });
    expect(await as(ME).vote({ ...input, voted: true })).toMatchObject({
      voteCount: 1,
    });
    state.votes.clear();
    expect(await as(ME).vote({ ...input, voted: false })).toMatchObject({
      upvotedByMe: false,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses one's own post", async () => {
    put(question({ authorId: ME }));
    await expect(as(ME).vote({ ...input, voted: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('is not found for a post that is missing or not shown', async () => {
    put(question({ state: 'hidden' }));
    await expect(as(ME).vote({ ...input, voted: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      as(ME).vote({ ...input, postId: 'r9', voted: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('votes on a reply by its own key', async () => {
    put(replyPost('r1'));
    await as(ME).vote({ ...input, postId: 'r1', voted: true });
    expect(discussionWrites.mock.calls[0][1].post).toMatchObject({
      kind: 'reply',
      postId: 'r1',
    });
  });

  it('is closed for an archived course', async () => {
    state.course = { status: 'archived' };
    await expect(as(ME).vote({ ...input, voted: true })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it("asks the table about the caller's vote only", async () => {
    await as(ME).vote({ ...input, voted: true });
    const gets = state.userCalls.filter(([kind]: string[]) => kind === 'vote');
    expect(gets.every(([, key]: any[]) => key.userId === ME)).toBe(true);
  });
});

describe('accept', () => {
  const input = { ...ref, threadId: 'q1', postId: 'r1' };

  beforeEach(() => put(question({ authorId: ME }), replyPost('r1')));

  it('lets the asker mark an answer', async () => {
    await as(ME).accept(input);
    expect(discussionWrites.mock.calls[0][1]).toMatchObject({
      type: 'accept',
      replyId: 'r1',
      question: { threadId: 'q1' },
    });
  });

  it('adds the notification items to the same transaction', async () => {
    await as(ME).accept(input);
    expect(state.built).toEqual(['post-item', 'notification-item']);
    expect(discussionNotificationWrites.mock.calls[0][1]).toMatchObject({
      kind: 'accepted',
      acceptedBy: ME,
      question: { postId: 'q1' },
      reply: { postId: 'r1' },
    });
  });

  it('notifies nobody when the answer is removed or repeated', async () => {
    await as(ME).accept({ ...input, postId: null });
    put(question({ authorId: ME, acceptedPostId: 'r1' }));
    await as(ME).accept(input);
    expect(discussionNotificationWrites).not.toHaveBeenCalled();
  });

  it('lets an instructor of the course mark an answer', async () => {
    put(question({ authorId: 'someone' }));
    await asInstructor().accept(input);
    expect(discussionWrites).toHaveBeenCalled();
  });

  it('refuses another student', async () => {
    put(question({ authorId: 'someone' }));
    await expect(as(ME).accept(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('is not found for a reply that is of another question, hidden or missing', async () => {
    await expect(
      as(ME).accept({ ...input, postId: 'r-elsewhere' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    put(replyPost('r1', { state: 'hidden' }));
    await expect(as(ME).accept(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('is not found for a question not shown', async () => {
    put(question({ authorId: ME, state: 'hidden' }));
    await expect(as(ME).accept(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('removes the answer with a null postId', async () => {
    put(question({ authorId: ME, acceptedPostId: 'r1' }));
    await as(ME).accept({ ...input, postId: null });
    expect(discussionWrites.mock.calls[0][1].type).toBe('unaccept');
  });

  it('succeeds without a write for the reply already accepted', async () => {
    put(question({ authorId: ME, acceptedPostId: 'r1' }));
    const result = await as(ME).accept(input);
    expect(result).toMatchObject({ accepted: true });
    expect(write).not.toHaveBeenCalled();
  });

  it('is closed for an archived course', async () => {
    state.course = { status: 'archived' };
    await expect(as(ME).accept(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});

describe('report', () => {
  const input = { ...ref, threadId: 'q1', postId: 'q1' };

  beforeEach(() => put(question()));

  it('reports as the caller', async () => {
    expect(await as(ME).report(input)).toEqual({ reported: true });
    expect(discussionWrites.mock.calls[0][1]).toMatchObject({
      type: 'report',
      reporterId: ME,
      reporterIds: [],
    });
  });

  it("keeps the first report's time", async () => {
    put(question({ reportedBy: new Set(['a']), reportedSince: 'first' }));
    await as(ME).report(input);
    expect(discussionWrites.mock.calls[0][1]).toMatchObject({
      reporterIds: ['a'],
      reportedSince: 'first',
    });
  });

  it("refuses one's own post", async () => {
    put(question({ authorId: ME }));
    await expect(as(ME).report(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('is not found for a post not shown', async () => {
    put(question({ state: 'hidden' }));
    await expect(as(ME).report(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('succeeds without a write when repeated', async () => {
    put(question({ reportedBy: new Set([ME]) }));
    expect(await as(ME).report(input)).toEqual({ reported: true });
    expect(write).not.toHaveBeenCalled();
  });

  it('succeeds without a write past 20 reporters', async () => {
    put(
      question({
        reportedBy: new Set(Array.from({ length: 20 }, (_, i) => `u${i}`)),
      }),
    );
    expect(await as(ME).report(input)).toEqual({ reported: true });
    expect(write).not.toHaveBeenCalled();
  });

  it('is closed for an archived course', async () => {
    state.course = { status: 'archived' };
    await expect(as(ME).report(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});

describe('removeOwn', () => {
  const input = { ...ref, threadId: 'q1', postId: 'q1' };

  beforeEach(() => put(question({ authorId: ME })));

  it("deletes the caller's question and returns the placeholder", async () => {
    expect(await as(ME).removeOwn(input)).toEqual({
      postId: 'q1',
      threadId: 'q1',
      kind: 'question',
      state: 'deleted',
    });
    expect(discussionWrites.mock.calls[0][1]).toMatchObject({
      type: 'delete',
      courseId: 'c1',
      lessonId: 'l1',
      post: { postId: 'q1' },
    });
  });

  it('deletes a reply with its question read', async () => {
    put(replyPost('r1', { authorId: ME, authorIsInstructor: true }));
    await as(ME).removeOwn({ ...input, postId: 'r1' });
    expect(discussionWrites.mock.calls[0][1]).toMatchObject({
      post: { kind: 'reply', authorIsInstructor: true },
      question: { threadId: 'q1' },
    });
  });

  it("refuses another user's post", async () => {
    put(question({ authorId: 'someone' }));
    await expect(as(ME).removeOwn(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('is not found for a post that does not exist', async () => {
    state.posts.clear();
    await expect(as(ME).removeOwn(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('succeeds without a write for a post already deleted', async () => {
    put(question({ authorId: ME, state: 'deleted' }));
    expect(await as(ME).removeOwn(input)).toMatchObject({ state: 'deleted' });
    expect(write).not.toHaveBeenCalled();
  });

  it('allows a hidden post', async () => {
    put(question({ authorId: ME, state: 'hidden' }));
    await as(ME).removeOwn(input);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('works in an archived course and for a hidden lesson', async () => {
    state.course = { status: 'archived' };
    state.lesson = { visibility: 'hidden' };
    await as(ME).removeOwn(input);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('still needs access to the course', async () => {
    state.enrolment = null;
    await expect(as(ME).removeOwn(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('retry', () => {
  it('rereads on a transaction conflict and succeeds when it clears', async () => {
    put(question());
    write
      .mockResolvedValueOnce({ canceled: true })
      .mockResolvedValueOnce({ canceled: false });
    await as(ME).vote({ ...ref, threadId: 'q1', postId: 'q1', voted: true });
    expect(write).toHaveBeenCalledTimes(2);
  });
});
