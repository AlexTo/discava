/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createContentItemEntity } from './content-item.js';
import { createDiscussionPostEntity } from './discussion-post.js';

let post: Awaited<ReturnType<typeof createDiscussionPostEntity>>;
let contentItem: Awaited<ReturnType<typeof createContentItemEntity>>;
beforeAll(async () => {
  post = await createDiscussionPostEntity();
  contentItem = await createContentItemEntity();
});

const question = {
  courseId: 'course-1',
  lessonId: 'lesson-1',
  moduleId: 'module-1',
  kind: 'question',
  threadId: 'post-1',
  postId: 'post-1',
  authorId: 'user-1',
  authorName: 'Erin Nguyen',
  authorIsInstructor: false,
  title: 'Why?',
  body: 'Because.',
  createdAt: '2026-11-16T10:00:00.000Z',
} as const;

type Params = {
  Item: Record<string, unknown>;
  IndexName?: string;
  ExpressionAttributeValues: Record<string, string>;
};

describe('discussionPost', () => {
  it('accepts a complete question', () => {
    expect(() => post.create(question).params()).not.toThrow();
  });

  it('defaults state to shown and the counters to 0', () => {
    const { Item } = post.create(question).params() as Params;
    expect(Item).toMatchObject({
      state: 'shown',
      replyCount: 0,
      instructorReplyCount: 0,
      voteCount: 0,
    });
  });

  it.each([
    'courseId',
    'lessonId',
    'moduleId',
    'kind',
    'threadId',
    'postId',
    'authorId',
    'authorName',
    'authorIsInstructor',
    'createdAt',
  ])('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...question };
    delete record[field];
    expect(() => post.create(record as never).params()).toThrow();
  });

  it('accepts a question with and without promptAnswer', () => {
    const without = post.create(question).params() as Params;
    expect(without.Item).not.toHaveProperty('promptAnswer');
    const { Item } = post
      .create({ ...question, promptAnswer: true })
      .params() as Params;
    expect(Item.promptAnswer).toBe(true);
  });

  it('refuses a kind other than question or reply', () => {
    expect(() =>
      post.create({ ...question, kind: 'comment' } as never).params(),
    ).toThrow();
  });

  it('sorts a question and a reply of the same lesson into separate ranges', () => {
    const q = post.create(question).params() as Params;
    const r = post
      .create({ ...question, kind: 'reply', postId: 'post-2' })
      .params() as Params;
    expect(q.Item.pk).toBe(r.Item.pk);
    expect(String(q.Item.sk)).toContain('question');
    expect(String(r.Item.sk)).toContain('reply');
    const questions = post.query
      .primary({ courseId: 'course-1', kind: 'question', lessonId: 'lesson-1' })
      .params() as Params;
    const prefix = Object.values(questions.ExpressionAttributeValues).find(
      (v) => String(v).includes('question'),
    ) as string;
    expect(String(q.Item.sk).startsWith(prefix)).toBe(true);
    expect(String(r.Item.sk).startsWith(prefix)).toBe(false);
  });

  it('queries byUnanswered on gsi2 with a key no other entity can equal', () => {
    const params = post.query
      .byUnanswered({ unanswered: 'course-1' })
      .params() as Params;
    expect(params.IndexName).toBe('gsi2pk-gsi2sk-index');
    const [key] = Object.values(params.ExpressionAttributeValues);
    expect(key).toContain('discussionpost_unanswered');
  });

  it('queries byReported on gsi1 with a key no content item can equal', () => {
    const params = post.query
      .byReported({ reported: 'course-1' })
      .params() as Params;
    expect(params.IndexName).toBe('gsi1pk-gsi1sk-index');
    const [key] = Object.values(params.ExpressionAttributeValues);
    expect(key).toContain('discussionpost_reported');

    const pending = contentItem.query
      .byTranscodePending({ transcodePending: 'pending' })
      .params() as Params;
    const [pendingKey] = Object.values(pending.ExpressionAttributeValues);
    expect(pending.IndexName).toBe(params.IndexName);
    expect(pendingKey).not.toBe(key);
  });

  it('leaves a post written without `unanswered` out of byUnanswered', () => {
    const { Item } = post.create(question).params() as Params;
    expect(Item.gsi2pk).toBeUndefined();
    expect(Item.gsi2sk).toBeUndefined();
  });

  it('indexes a question written with `unanswered`, but not by byReported', () => {
    const { Item } = post
      .create({
        ...question,
        unanswered: 'c1',
        unansweredSince: question.createdAt,
      })
      .params() as Params;
    expect(Item.gsi2pk).toBeDefined();
    expect(Item.gsi1pk).toBeUndefined();
  });

  it('indexes a post written with `reported` in byReported only', () => {
    const { Item } = post
      .create({
        ...question,
        reported: 'c1',
        reportedSince: question.createdAt,
        reportedBy: new Set(['user-2']),
      } as never)
      .params() as Params;
    expect(Item.gsi1pk).toBeDefined();
    expect(Item.gsi2pk).toBeUndefined();
  });

  // ElectroDB re-evaluates a sparse index's condition when an update provides
  // one of its composites. Neither queue may lose its keys to a write that
  // does not touch its flag (discussionWrites relies on this).
  describe('an update of a flagged post', () => {
    const key = {
      courseId: 'course-1',
      kind: 'question',
      lessonId: 'lesson-1',
      threadId: 'post-1',
      postId: 'post-1',
    } as const;
    const expression = (params: unknown) =>
      (params as { UpdateExpression: string }).UpdateExpression;
    const keyFields = /#gsi[12]p?k|#gsi[12]sk/;

    it.each([
      ['a counter', () => post.update(key).add({ replyCount: 1 })],
      ['the body', () => post.patch(key).set({ body: 'edited' })],
      ['the state', () => post.patch(key).set({ state: 'hidden' })],
      [
        'accepting an answer',
        () => post.patch(key).set({ acceptedPostId: 'r' }),
      ],
    ])("leaves both queues' keys alone for %s", (_, build) => {
      expect(expression(build().params())).not.toMatch(keyFields);
    });

    it("sets only its own queue's keys when a flag is set", () => {
      const params = expression(
        post
          .patch(key)
          .set({
            unanswered: 'course-1',
            unansweredSince: question.createdAt,
          })
          .params(),
      );
      expect(params).toMatch(/#gsi2pk/);
      expect(params).not.toMatch(/#gsi1/);
    });

    it("clears only its own queue's keys when a flag is removed", () => {
      const unanswered = expression(
        post.patch(key).remove(['unanswered', 'unansweredSince']).params(),
      );
      expect(unanswered).toMatch(/REMOVE.*#gsi2pk/);
      expect(unanswered).not.toMatch(/#gsi1/);
      const reported = expression(
        post
          .patch(key)
          .remove(['reported', 'reportedSince', 'reportedBy'])
          .params(),
      );
      expect(reported).toMatch(/REMOVE.*#gsi1pk/);
      expect(reported).not.toMatch(/#gsi2/);
    });
  });
});
