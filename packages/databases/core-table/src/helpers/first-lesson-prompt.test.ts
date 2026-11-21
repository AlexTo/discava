/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFakeTable,
  type Operation,
} from '../test-support/fake-transaction.js';
import { uuidV7At } from '../test-support/uuid-v7.js';
import {
  type DiscussionAuthor,
  type DiscussionOperation,
  discussionWrites,
  toPostRead,
  toQuestionRead,
} from './discussion.js';
import { DISCUSSION_TITLE_MAX } from './discussion-text.js';
import {
  DEFAULT_FIRST_LESSON_PROMPT,
  dismissFirstLessonPrompt,
  FIRST_LESSON_PROMPT_MAX,
  firstLessonPromptStateWrites,
  NotEnrolledError,
  normaliseFirstLessonPrompt,
  promptAnswerTitle,
  resolveFirstLessonPrompt,
} from './first-lesson-prompt.js';
import type { TableSnapshot } from './invariants/index.js';
import {
  checkTableInvariants,
  emptyTableSnapshot,
} from './invariants/index.js';

describe('normaliseFirstLessonPrompt', () => {
  it('accepts 200 characters and refuses 201', () => {
    expect(normaliseFirstLessonPrompt('a'.repeat(200)).text).toHaveLength(200);
    expect(normaliseFirstLessonPrompt('a'.repeat(201))).toEqual({
      reason: 'too-long',
    });
    expect(FIRST_LESSON_PROMPT_MAX).toBe(200);
  });

  it('trims, and refuses blank text', () => {
    expect(normaliseFirstLessonPrompt('  Why are you here?  ').text).toBe(
      'Why are you here?',
    );
    expect(normaliseFirstLessonPrompt(' \n ')).toEqual({ reason: 'empty' });
    expect(normaliseFirstLessonPrompt('')).toEqual({ reason: 'empty' });
  });
});

describe('resolveFirstLessonPrompt', () => {
  it("uses the course's text, else the default", () => {
    expect(resolveFirstLessonPrompt({ firstLessonPrompt: 'Your goal?' })).toBe(
      'Your goal?',
    );
    expect(resolveFirstLessonPrompt({})).toBe(DEFAULT_FIRST_LESSON_PROMPT);
  });
});

describe('promptAnswerTitle', () => {
  it('is a single-line body as it is', () => {
    expect(promptAnswerTitle('I want to ship a product')).toBe(
      'I want to ship a product',
    );
  });

  it('takes the first non-empty line, trimmed', () => {
    expect(promptAnswerTitle('\n  \n  First line  \nSecond line')).toBe(
      'First line',
    );
    expect(promptAnswerTitle('One\r\nTwo')).toBe('One');
  });

  it('cuts a long first line to 120 characters with an ellipsis', () => {
    const title = promptAnswerTitle(`${'a'.repeat(300)}\nmore`);
    expect([...title]).toHaveLength(DISCUSSION_TITLE_MAX);
    expect(title).toBe(`${'a'.repeat(DISCUSSION_TITLE_MAX - 1)}…`);
  });

  it('keeps a line of exactly 120 characters whole', () => {
    const line = 'b'.repeat(DISCUSSION_TITLE_MAX);
    expect(promptAnswerTitle(line)).toBe(line);
  });
});

// The writes against an in-memory table, which keeps DynamoDB's rules for
// conditions and transactions.
describe('answering and dismissing against an in-memory table', () => {
  const table = createFakeTable({
    keyFields: {
      course: ['courseId'],
      module: ['courseId', 'moduleId'],
      lesson: ['courseId', 'moduleId', 'lessonId'],
      enrolment: ['courseId', 'userId'],
      discussionPost: ['courseId', 'kind', 'lessonId', 'threadId', 'postId'],
    },
    createDefaults: {
      discussionPost: {
        state: 'shown',
        replyCount: 0,
        instructorReplyCount: 0,
        voteCount: 0,
      },
    },
  });
  const { keyOf, rows } = table;
  const fakeEntities = () =>
    table.entities<Parameters<typeof discussionWrites>[0]>();

  const WHEN = new Date('2026-11-16T10:00:00.000Z');
  const scope = { courseId: 'c1', moduleId: 'm1', lessonId: 'l1' };
  const student: DiscussionAuthor = {
    userId: 'u1',
    name: 'Ada',
    isInstructor: false,
  };
  const teacher: DiscussionAuthor = {
    userId: 't1',
    name: 'Tess',
    isInstructor: true,
  };
  let counter: number;
  const nextId = () => {
    counter += 1;
    return uuidV7At(WHEN.getTime() + counter, counter);
  };

  const enrolmentOf = (userId: string) =>
    rows.get(keyOf('enrolment', { courseId: 'c1', userId }))!;
  const enrol = (userId: string, status = 'active') =>
    rows.set(keyOf('enrolment', { courseId: 'c1', userId }), {
      courseId: 'c1',
      userId,
      status,
      lastActivityAt: '2026-11-16T09:00:00.000Z',
    });

  beforeEach(() => {
    counter = 0;
    rows.clear();
    rows.set(keyOf('course', scope), { courseId: 'c1', status: 'published' });
    rows.set(keyOf('module', scope), { ...scope, visibility: 'visible' });
    rows.set(keyOf('lesson', scope), { ...scope, visibility: 'visible' });
    enrol('u1');
  });

  const run = (op: DiscussionOperation): 'ok' | 'cancelled' => {
    const items = discussionWrites(fakeEntities(), op) as unknown as
      | Operation[]
      | undefined;
    return items === undefined || table.succeeds(items) ? 'ok' : 'cancelled';
  };
  const answerOp = (
    author = student,
    body = 'I want to build things',
  ): DiscussionOperation => ({
    ...scope,
    type: 'answerPrompt',
    postId: nextId(),
    author,
    body,
    now: WHEN,
  });
  const posts = () => table.rowsOf('discussionPost');
  const answerPost = () => posts().find((p) => p.promptAnswer)!;

  it('creates one post and sets the state', () => {
    expect(run(answerOp(student, '  First\nsecond  '))).toBe('ok');
    expect(posts()).toHaveLength(1);
    expect(answerPost()).toMatchObject({
      kind: 'question',
      promptAnswer: true,
      title: 'First',
      body: 'First\nsecond',
      authorId: 'u1',
      authorName: 'Ada',
    });
    expect(answerPost().unanswered).toBeUndefined();
    expect(answerPost().unansweredSince).toBeUndefined();
    expect(answerPost().threadId).toBe(answerPost().postId);
    expect(enrolmentOf('u1').firstLessonPromptState).toBe('answered');
  });

  it('does not touch lastActivityAt or the activity count', () => {
    const before = enrolmentOf('u1').lastActivityAt;
    run(answerOp());
    expect(enrolmentOf('u1').lastActivityAt).toBe(before);
    expect(enrolmentOf('u1').studentActivityCount).toBeUndefined();
  });

  it('cancels a second answer with a new id', () => {
    expect(run(answerOp())).toBe('ok');
    expect(run(answerOp())).toBe('cancelled');
    expect(posts()).toHaveLength(1);
  });

  it('cancels an answer after a dismissal', () => {
    expect(
      table.succeeds([
        firstLessonPromptStateWrites(fakeEntities(), {
          courseId: 'c1',
          userId: 'u1',
          state: 'dismissed',
        }) as unknown as Operation,
      ]),
    ).toBe(true);
    expect(run(answerOp())).toBe('cancelled');
    expect(posts()).toHaveLength(0);
    expect(enrolmentOf('u1').firstLessonPromptState).toBe('dismissed');
  });

  it('cancels an answer from a dropped or missing enrolment', () => {
    enrol('u1', 'dropped');
    expect(run(answerOp())).toBe('cancelled');
    expect(run(answerOp(teacher))).toBe('cancelled');
    expect(posts()).toHaveLength(0);
  });

  it('cancels an answer to a course that is not published', () => {
    rows.set(keyOf('course', scope), { courseId: 'c1', status: 'archived' });
    expect(run(answerOp())).toBe('cancelled');
    expect(enrolmentOf('u1').firstLessonPromptState).toBeUndefined();
  });

  it('leaves exactly one post when 20 answers race', () => {
    const results = Array.from({ length: 20 }, () => run(answerOp()));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });

  it('keeps `answered` when a dismissal follows an answer', () => {
    run(answerOp());
    table.succeeds([
      firstLessonPromptStateWrites(fakeEntities(), {
        courseId: 'c1',
        userId: 'u1',
        state: 'dismissed',
      }) as unknown as Operation,
    ]);
    expect(enrolmentOf('u1').firstLessonPromptState).toBe('answered');
  });

  it('refuses a bad body or post id', () => {
    expect(() => run({ ...answerOp(), body: '   ' })).toThrow(/body/);
    expect(() => run({ ...answerOp(), postId: 'not-an-id' })).toThrow(
      /UUID v7/,
    );
  });

  describe('moderating an answer', () => {
    const readPost = () => toPostRead(answerPost() as never);
    const readQuestion = () => toQuestionRead(answerPost() as never);
    const moderate = (type: 'hide' | 'unhide' | 'delete') =>
      run({
        type,
        courseId: 'c1',
        lessonId: 'l1',
        post: readPost(),
        question: readQuestion(),
      });

    beforeEach(() => {
      run(answerOp());
    });

    it('never sets `unanswered` when hidden then unhidden', () => {
      expect(moderate('hide')).toBe('ok');
      expect(answerPost().unanswered).toBeUndefined();
      expect(moderate('unhide')).toBe('ok');
      expect(answerPost().state).toBe('shown');
      expect(answerPost().unanswered).toBeUndefined();
      expect(answerPost().unansweredSince).toBeUndefined();
    });

    it('never sets `unanswered` when a reply under it is deleted', () => {
      const replyId = nextId();
      const threadId = answerPost().threadId;
      expect(
        run({
          ...scope,
          type: 'reply',
          threadId,
          postId: replyId,
          author: teacher,
          body: 'Welcome!',
          now: WHEN,
        }),
      ).toBe('ok');
      const reply = posts().find((p) => p.kind === 'reply')!;
      expect(
        run({
          type: 'delete',
          courseId: 'c1',
          lessonId: 'l1',
          post: toPostRead(reply as never),
          question: readQuestion(),
        }),
      ).toBe('ok');
      expect(answerPost().unanswered).toBeUndefined();
    });

    it('never sets `unanswered` when an accepted reply is removed', () => {
      const threadId = answerPost().threadId;
      const replyId = nextId();
      run({
        ...scope,
        type: 'reply',
        threadId,
        postId: replyId,
        author: student,
        body: 'Me too',
        now: WHEN,
      });
      expect(
        run({
          ...scope,
          type: 'accept',
          question: readQuestion(),
          replyId,
        }),
      ).toBe('ok');
      expect(
        run({ ...scope, type: 'unaccept', question: readQuestion() }),
      ).toBe('ok');
      expect(answerPost().acceptedPostId).toBeUndefined();
      expect(answerPost().unanswered).toBeUndefined();
    });

    it('keeps the invariants', () => {
      moderate('hide');
      const snapshot = {
        ...emptyTableSnapshot(),
        lessons: [{ ...scope }],
        enrolments: table.rowsOf('enrolment'),
        discussionPosts: posts(),
      } as unknown as TableSnapshot;
      expect(
        checkTableInvariants(snapshot).filter(
          (v) =>
            v.invariant.startsWith('discussion-') ||
            v.invariant === 'first-lesson-prompt-matches-answers',
        ),
      ).toEqual([]);
    });
  });

  describe('dismissFirstLessonPrompt', () => {
    // The part of the core table service the helper uses.
    const service = {
      transaction: {
        write: (build: (e: unknown) => unknown[]) => ({
          go: async () => ({
            canceled: !table.succeeds(build(fakeEntities()) as Operation[]),
          }),
        }),
      },
      entities: {
        enrolment: {
          get: (key: { courseId: string; userId: string }) => ({
            go: async () => ({ data: rows.get(keyOf('enrolment', key)) }),
          }),
        },
      },
    } as never;
    const dismiss = (userId = 'u1') =>
      dismissFirstLessonPrompt(service, { courseId: 'c1', userId });

    it('sets `dismissed`', async () => {
      expect(await dismiss()).toMatchObject({
        firstLessonPromptState: 'dismissed',
      });
    });

    it('succeeds again, unchanged', async () => {
      await dismiss();
      expect(await dismiss()).toMatchObject({
        firstLessonPromptState: 'dismissed',
      });
    });

    it('returns an answered enrolment as it is', async () => {
      run(answerOp());
      expect(await dismiss()).toMatchObject({
        firstLessonPromptState: 'answered',
      });
    });

    it('refuses a missing or dropped enrolment', async () => {
      await expect(dismiss('nobody')).rejects.toBeInstanceOf(NotEnrolledError);
      enrol('u1', 'dropped');
      await expect(dismiss()).rejects.toBeInstanceOf(NotEnrolledError);
      expect(enrolmentOf('u1').firstLessonPromptState).toBeUndefined();
    });
  });
});
