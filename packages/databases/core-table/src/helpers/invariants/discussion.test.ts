/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableSnapshot } from './snapshot.js';
import {
  checkTableInvariants,
  consistentTable,
  ids,
  shown,
  testHelpers,
} from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { broken, expectOnly } = testHelpers(() => table);

describe('discussion', () => {
  const v7 = (at: string, n: number) => {
    const hex = new Date(at).getTime().toString(16).padStart(12, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-${String(n).padStart(12, '0')}`;
  };
  const AT1 = '2026-11-16T10:00:00.000Z';
  const AT2 = '2026-11-16T10:05:00.000Z';
  const QID = v7(AT1, 1);
  const RID = v7(AT2, 2);
  type Post = TableSnapshot['discussionPosts'][number];

  const question = (over: Partial<Post> = {}): Post => ({
    courseId: 'c1',
    lessonId: 'l1',
    moduleId: 'm1',
    kind: 'question',
    threadId: QID,
    postId: QID,
    authorId: 'asker',
    authorName: 'Ada',
    authorIsInstructor: false,
    title: 'Why?',
    body: 'Because.',
    state: 'shown',
    replyCount: 1,
    instructorReplyCount: 0,
    voteCount: 1,
    createdAt: AT1,
    ...over,
  });
  const reply = (over: Partial<Post> = {}): Post => ({
    courseId: 'c1',
    lessonId: 'l1',
    moduleId: 'm1',
    kind: 'reply',
    threadId: QID,
    postId: RID,
    authorId: 'helper',
    authorName: 'Bo',
    authorIsInstructor: false,
    body: 'Like this.',
    state: 'shown',
    replyCount: 0,
    instructorReplyCount: 0,
    voteCount: 0,
    createdAt: AT2,
    ...over,
  });
  const vote = (over = {}) => ({
    courseId: 'c1',
    userId: 'voter',
    lessonId: 'l1',
    threadId: QID,
    postId: QID,
    ...over,
  });

  // An unanswered question with one reply (by a student) and one vote.
  beforeEach(() => {
    table.discussionPosts = [question({ unanswered: 'c1' }), reply()];
    table.discussionVotes = [vote()];
  });

  const hold = (posts: Post[], votes = table.discussionVotes) => {
    table.discussionPosts = posts;
    table.discussionVotes = votes;
  };

  it('passes a consistent thread', () => {
    expect(broken().invariants).toEqual([]);
  });

  it('is not student activity: a student with only posts and votes is not counted and trips no student-records check', () => {
    table.discussionPosts.push(
      question({
        postId: v7(AT2, 3),
        threadId: v7(AT2, 3),
        createdAt: AT2,
        authorId: 'stranger',
        replyCount: 0,
        voteCount: 1,
        unanswered: 'c1',
      }),
    );
    table.discussionVotes.push(
      vote({ userId: 'stranger', postId: QID }),
      vote({ userId: 'voter', threadId: v7(AT2, 3), postId: v7(AT2, 3) }),
    );
    table.discussionPosts[0].voteCount = 2;
    const { invariants } = broken();
    expect(invariants).toEqual([]);
    expect(
      checkTableInvariants(table).filter(
        (v) =>
          v.invariant === 'activity-count-matches-students' ||
          v.invariant.startsWith('student-records-'),
      ),
    ).toEqual([]);
  });

  it('keeps the discussion rules with discussion notifications present', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
    try {
      table.notifications = [
        ...[
          'discussion.reply',
          'discussion.answered',
          'discussion.accepted',
        ].map((type, i) => ({
          userId: 'asker',
          occurredAt: `2026-11-16T10:0${i}:00.000Z`,
          id: `${i}`.repeat(16),
          type,
          link: { portal: 'student' as const, path: '/learn/c1/lesson/l1' },
          email: { state: 'skipped' as const, reason: 'never' as const },
          createdAt: `2026-11-16T10:0${i}:00.000Z`,
        })),
      ];
      table.notificationStates = [{ userId: 'asker', unreadCount: 3 }];
      expect(checkTableInvariants(table)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a certificate-style record of another entity untouched', () => {
    const before = checkTableInvariants(table);
    table.certificates.push({
      userId: 'asker',
      courseId: 'c1',
      certificateId: '0123456789ABCDEF',
      learnerName: 'Ada',
      courseTitle: 'Intro',
      completedAt: AT1,
      issuedAt: AT1,
    });
    const discussion = (vs: ReturnType<typeof checkTableInvariants>) =>
      vs.filter((v) => v.invariant.startsWith('discussion-'));
    expect(discussion(checkTableInvariants(table))).toEqual(discussion(before));
  });

  describe('discussion-post-shape', () => {
    it.each([
      ['a question without a title', question({ title: undefined }), /title/],
      ['a question with a blank title', question({ title: '' }), /title/],
      [
        'a question with a 121 character title',
        question({ title: 'a'.repeat(121) }),
        /title/,
      ],
      [
        'a question whose postId is not its threadId',
        question({ threadId: v7(AT1, 9) }),
        /postId is not its threadId/,
      ],
      ['a post without a body', question({ body: undefined }), /body/],
      [
        'a body of 4,001 characters',
        question({ body: 'a'.repeat(4001) }),
        /body/,
      ],
      [
        'a post without an author name',
        question({ authorName: '' }),
        /authorName/,
      ],
      [
        'a post with an unknown state',
        question({ state: 'gone' as never }),
        /state/,
      ],
      [
        'a postId that is not a UUID v7',
        question({ postId: 'x', threadId: 'x' }),
        /UUID v7/,
      ],
      [
        'a postId whose time differs from createdAt',
        question({ createdAt: AT2 }),
        /UUID v7/,
      ],
      [
        'a deleted post that still has a body',
        question({ state: 'deleted', title: undefined, replyCount: 1 }),
        /deleted post still has a body/,
      ],
      [
        'a deleted question that still has a title',
        question({ state: 'deleted', body: undefined }),
        /deleted question still has a title/,
      ],
      [
        'more than 20 reporters',
        question({
          reportedBy: Array.from({ length: 21 }, (_, i) => `u${i}`),
          reported: 'c1',
        }),
        /21 reporters/,
      ],
      [
        'the author among the reporters',
        question({ reportedBy: ['asker'], reported: 'c1' }),
        /author is among/,
      ],
    ])('reports %s', (_, post, message) => {
      const { violations } = (() => {
        hold([post, reply()]);
        return broken();
      })();
      expect(violations.map((v) => v.invariant)).toContain(
        'discussion-post-shape',
      );
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });

    it.each([
      ['a title', { title: 'Hello' }, /reply has a title/],
      ['an acceptedPostId', { acceptedPostId: RID }, /acceptedPostId/],
      ['an unanswered mark', { unanswered: 'c1' }, /unanswered/],
      ['a reply count', { replyCount: 1 }, /reply counts/],
    ])('reports a reply with %s', (_, over, message) => {
      hold([question({ unanswered: 'c1' }), reply(over)]);
      const { violations } = broken();
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });

    it('passes a deleted reply with no text, and 4,000 characters', () => {
      hold([
        question({
          unanswered: 'c1',
          body: 'a'.repeat(4000),
          replyCount: 0,
        }),
        reply({ state: 'deleted', body: undefined }),
      ]);
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('discussion-thread-links', () => {
    it('reports a reply with no question', () => {
      hold([reply()], []);
      expectOnly('discussion-thread-links', /question does not exist/);
    });

    it('reports a post whose lesson is missing', () => {
      table.lessons = table.lessons.filter((l) => l.lessonId !== 'l1');
      table.discussionPosts = [
        question({ unanswered: 'c1', lessonId: 'gone' }),
        reply({ lessonId: 'gone' }),
      ];
      table.discussionVotes = [vote({ lessonId: 'gone' })];
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/lesson does not exist/),
      );
    });

    it('is not a violation that the lesson is archived', () => {
      const lesson = table.lessons.find((l) => l.lessonId === 'l1');
      if (!lesson) throw new Error('no lesson');
      lesson.archivedAt = AT2;
      expect(
        checkTableInvariants(table).filter((v) =>
          v.invariant.startsWith('discussion-'),
        ),
      ).toEqual([]);
    });

    it('reports a wrong moduleId', () => {
      hold([question({ unanswered: 'c1', moduleId: 'other' }), reply()]);
      expectOnly('discussion-thread-links', /moduleId is other/);
    });
  });

  describe('discussion-counts-match', () => {
    it.each([
      ['replyCount too high', { replyCount: 2 }, /replyCount is 2/],
      ['replyCount too low', { replyCount: 0 }, /replyCount is 0/],
      [
        'instructorReplyCount too high',
        { instructorReplyCount: 1 },
        /instructorReplyCount is 1/,
      ],
      ['voteCount too high', { voteCount: 2 }, /voteCount is 2/],
      ['voteCount too low', { voteCount: 0 }, /voteCount is 0/],
    ])('reports %s', (_, over, message) => {
      hold([question({ unanswered: 'c1', ...over }), reply()]);
      const { violations } = broken();
      expect(violations.map((v) => v.invariant)).toContain(
        'discussion-counts-match',
      );
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });

    it('does not count a hidden reply, and counts an instructor reply', () => {
      hold([
        question({ replyCount: 1, instructorReplyCount: 1 }),
        reply({ authorIsInstructor: true }),
        reply({
          postId: v7(AT2, 5),
          state: 'hidden',
          authorIsInstructor: true,
        }),
      ]);
      expect(broken().invariants).toEqual([]);
    });

    it('reports a reply count of 501', () => {
      const replies = Array.from({ length: 501 }, (_, i) =>
        reply({ postId: v7(AT2, 100 + i) }),
      );
      hold([question({ unanswered: 'c1', replyCount: 501 }), ...replies]);
      const { messages } = broken();
      expect(messages).toContainEqual(expect.stringMatching(/more than 500/));
    });

    it('reports a post whose votes name another lesson', () => {
      table.discussionVotes = [vote({ lessonId: 'other' })];
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/voteCount is 1, but it has 0 votes/),
      );
    });
  });

  describe('discussion-accepted-valid', () => {
    const accepted = (over: Partial<Post> = {}) =>
      question({ acceptedPostId: RID, ...over });

    it('passes an accepted shown reply', () => {
      hold([accepted(), reply()]);
      expect(broken().invariants).toEqual([]);
    });

    it.each([
      [
        'a hidden reply',
        [accepted({ replyCount: 0 }), reply({ state: 'hidden' })],
        /is hidden/,
      ],
      [
        'a reply of another question',
        [
          accepted({ replyCount: 0, unanswered: undefined }),
          reply({ threadId: v7(AT1, 7) }),
          question({
            postId: v7(AT1, 7),
            threadId: v7(AT1, 7),
            unanswered: 'c1',
            replyCount: 1,
            voteCount: 0,
          }),
        ],
        /another question/,
      ],
      ['a missing reply', [accepted({ replyCount: 0 })], /does not exist/],
      [
        'a deleted question',
        [
          accepted({
            state: 'deleted',
            title: undefined,
            body: undefined,
            replyCount: 0,
          }),
        ],
        /deleted question still has an accepted/,
      ],
    ])('reports an acceptedPostId naming %s', (_, posts, message) => {
      hold(posts as Post[], []);
      const { violations } = broken();
      expect(violations.map((v) => v.invariant)).toContain(
        'discussion-accepted-valid',
      );
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });
  });

  describe('discussion-unanswered-matches', () => {
    it('reports `unanswered` on an answered question', () => {
      hold([
        question({ unanswered: 'c1', instructorReplyCount: 1 }),
        reply({ authorIsInstructor: true }),
      ]);
      expectOnly('discussion-unanswered-matches', /not unanswered/);
    });

    it('reports an unanswered question that is not marked', () => {
      hold([question()]);
      table.discussionPosts[0].replyCount = 0;
      table.discussionPosts = [question({ replyCount: 0 })];
      expectOnly('discussion-unanswered-matches', /is not marked/);
    });

    it('reports an `unanswered` flag that is not the courseId', () => {
      hold([question({ unanswered: 'other' }), reply()]);
      table.discussionPosts[1].state = 'hidden';
      table.discussionPosts[0].replyCount = 0;
      expectOnly('discussion-unanswered-matches', /not its courseId/);
    });

    it('reports `unanswered` on a hidden question', () => {
      hold([question({ state: 'hidden', unanswered: 'c1' }), reply()]);
      expectOnly('discussion-unanswered-matches', /not unanswered/);
    });

    it('reports `unanswered` on a reply', () => {
      hold([question({ unanswered: 'c1' }), reply({ unanswered: 'c1' })]);
      expect(broken().violations.map((v) => v.invariant)).toContain(
        'discussion-unanswered-matches',
      );
    });

    it('passes an accepted question and a hidden one without the mark', () => {
      hold([question({ acceptedPostId: RID }), reply()]);
      expect(broken().invariants).toEqual([]);
      hold([question({ state: 'hidden' }), reply()]);
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('discussion-votes-valid', () => {
    it('reports a vote for a missing post', () => {
      table.discussionVotes = [
        vote(),
        vote({ postId: v7(AT1, 8), userId: 'x' }),
      ];
      expect(broken().violations.map((v) => v.invariant)).toContain(
        'discussion-votes-valid',
      );
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/post does not exist/),
      );
    });

    it("reports a vote by the post's author", () => {
      table.discussionVotes = [vote({ userId: 'asker' })];
      expectOnly('discussion-votes-valid', /voter is the post's author/);
    });

    it('reports a vote whose ids differ from its post', () => {
      table.discussionVotes = [vote({ lessonId: 'other' })];
      const { violations } = broken();
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(/lessonId or threadId differs/),
      );
      table.discussionVotes = [vote({ threadId: v7(AT1, 6) })];
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/lessonId or threadId differs/),
      );
    });
  });

  describe('discussion-reports-valid', () => {
    it('passes a reported post', () => {
      hold([
        question({
          unanswered: 'c1',
          reportedBy: ['u1'],
          reported: 'c1',
        }),
        reply(),
      ]);
      expect(broken().invariants).toEqual([]);
    });

    it('reports a `reported` flag that is not the courseId', () => {
      hold([
        question({
          unanswered: 'c1',
          reportedBy: ['u1'],
          reported: 'other',
        }),
        reply(),
      ]);
      expectOnly('discussion-reports-valid', /not its courseId/);
    });

    it('reports `reported` without reporters', () => {
      hold([question({ unanswered: 'c1', reported: 'c1' }), reply()]);
      expectOnly('discussion-reports-valid', /without reporters/);
    });

    it('reports reporters without the flag', () => {
      hold([question({ unanswered: 'c1', reportedBy: ['u1'] }), reply()]);
      expectOnly('discussion-reports-valid', /not marked reported/);
    });
  });
});
