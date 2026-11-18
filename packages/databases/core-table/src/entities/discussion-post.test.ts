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
  process.env.LOCAL_DEV = 'true';
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
      .byUnanswered({ courseId: 'course-1' })
      .params() as Params;
    expect(params.IndexName).toBe('gsi2pk-gsi2sk-index');
    const [key] = Object.values(params.ExpressionAttributeValues);
    expect(key).toContain('discussionpost_unanswered');
  });

  it('queries byReported on gsi1 with a key no content item can equal', () => {
    const params = post.query
      .byReported({ courseId: 'course-1' })
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
      .create({ ...question, unanswered: 'unanswered' })
      .params() as Params;
    expect(Item.gsi2pk).toBeDefined();
    expect(Item.gsi1pk).toBeUndefined();
  });

  it('indexes a post written with `reported` in byReported only', () => {
    const { Item } = post
      .create({
        ...question,
        reported: 'reported',
        reportedBy: new Set(['user-2']),
      } as never)
      .params() as Params;
    expect(Item.gsi1pk).toBeDefined();
    expect(Item.gsi2pk).toBeUndefined();
  });
});
