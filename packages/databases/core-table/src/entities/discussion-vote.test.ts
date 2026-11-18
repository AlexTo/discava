/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createDiscussionVoteEntity } from './discussion-vote.js';

let vote: Awaited<ReturnType<typeof createDiscussionVoteEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  vote = await createDiscussionVoteEntity();
});

const full = {
  courseId: 'course-1',
  userId: 'user-1',
  lessonId: 'lesson-1',
  threadId: 'thread-1',
  postId: 'post-1',
};

describe('discussionVote', () => {
  it('accepts a complete record', () => {
    expect(() => vote.create(full).params()).not.toThrow();
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => vote.create(record as never).params()).toThrow();
  });

  it('keys by course and voter, then the post voted on', () => {
    const { Item } = vote.create(full).params() as {
      Item: Record<string, string>;
    };
    expect(Item.pk).toContain('course-1');
    expect(Item.pk).toContain('user-1');
    expect(Item.sk).toContain('lesson-1');
    expect(Item.sk).toContain('thread-1');
    expect(Item.sk).toContain('post-1');
  });

  it("lists a voter's votes in one thread by a sort key prefix", () => {
    const { Item } = vote.create(full).params() as {
      Item: Record<string, string>;
    };
    const params = vote.query
      .primary({
        courseId: 'course-1',
        userId: 'user-1',
        lessonId: 'lesson-1',
        threadId: 'thread-1',
      })
      .params() as { ExpressionAttributeValues: Record<string, string> };
    const prefix = Object.values(params.ExpressionAttributeValues).find((v) =>
      String(v).includes('thread-1'),
    ) as string;
    expect(Item.sk.startsWith(prefix)).toBe(true);
  });

  it('has no other index, so a vote is one per person per post by its key', () => {
    const { Item } = vote.create(full).params() as {
      Item: Record<string, string>;
    };
    expect(Item.gsi1pk).toBeUndefined();
    expect(Item.gsi2pk).toBeUndefined();
  });
});
