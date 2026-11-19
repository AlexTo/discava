/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DiscussionNotificationPost,
  discussionExcerpt,
  discussionNotificationWrites,
} from './discussion-notifications.js';
import { buildNotification } from './notification-types.js';

const { notificationWrites } = vi.hoisted(() => ({
  notificationWrites: vi.fn(),
}));
vi.mock('./notification.js', () => ({ notificationWrites }));

const service = {} as never;
const post = (
  over: Partial<DiscussionNotificationPost>,
): DiscussionNotificationPost => ({
  courseId: 'c1',
  lessonId: 'l1',
  threadId: 'q1',
  postId: 'q1',
  authorId: 'asker',
  authorName: 'Asker',
  body: 'question',
  state: 'shown',
  createdAt: '2026-11-16T10:00:00.000Z',
  ...over,
});
const question = post({});
const reply = post({
  postId: 'r1',
  authorId: 'replier',
  authorName: 'Replier',
  body: 'the answer',
  createdAt: '2026-11-16T10:05:00.000Z',
});
const AT = '2026-11-16T11:00:00.000Z';

const calls = () => notificationWrites.mock.calls.map(([, input]) => input);

beforeEach(() => {
  notificationWrites.mockReset();
  notificationWrites.mockImplementation(async (_s, input) => [input]);
});

describe('reply', () => {
  it('notifies the asker once, keyed by the reply', async () => {
    const items = await discussionNotificationWrites(service, {
      kind: 'reply',
      reply,
      question,
    });
    expect(items).toHaveLength(1);
    expect(calls()).toEqual([
      {
        type: 'discussion.reply',
        userId: 'asker',
        params: {
          courseId: 'c1',
          lessonId: 'l1',
          authorName: 'Replier',
          excerpt: 'the answer',
        },
        dedupeKey: 'r1',
        occurredAt: '2026-11-16T10:05:00.000Z',
      },
    ]);
  });

  it('tells nobody about the asker replying to themselves', async () => {
    expect(
      await discussionNotificationWrites(service, {
        kind: 'reply',
        reply: post({ postId: 'r2', authorId: 'asker' }),
        question,
      }),
    ).toEqual([]);
    expect(notificationWrites).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'deleted'] as const)(
    'writes nothing for a %s question',
    async (state) => {
      expect(
        await discussionNotificationWrites(service, {
          kind: 'reply',
          reply,
          question: post({ state }),
        }),
      ).toEqual([]);
    },
  );
});

describe('accepted', () => {
  const accepted = (acceptedBy: string, over = {}) => ({
    kind: 'accepted' as const,
    question,
    reply,
    acceptedBy,
    acceptedByName: 'Teacher',
    at: AT,
    ...over,
  });

  it('tells the replier and the asker when a third person accepts', async () => {
    await discussionNotificationWrites(service, accepted('teacher'));
    expect(calls()).toEqual([
      {
        type: 'discussion.accepted',
        userId: 'replier',
        params: { courseId: 'c1', lessonId: 'l1', excerpt: 'the answer' },
        dedupeKey: 'q1:r1',
        occurredAt: AT,
      },
      {
        type: 'discussion.answered',
        userId: 'asker',
        params: {
          courseId: 'c1',
          lessonId: 'l1',
          authorName: 'Teacher',
          excerpt: 'the answer',
        },
        dedupeKey: 'q1:r1',
        occurredAt: AT,
      },
    ]);
  });

  it('tells only the replier when the asker accepts', async () => {
    await discussionNotificationWrites(service, accepted('asker'));
    expect(calls().map((c) => [c.type, c.userId])).toEqual([
      ['discussion.accepted', 'replier'],
    ]);
  });

  it('tells only the asker when the replier accepts their own reply', async () => {
    await discussionNotificationWrites(service, accepted('replier'));
    expect(calls().map((c) => [c.type, c.userId])).toEqual([
      ['discussion.answered', 'asker'],
    ]);
  });

  it('sends one notification when the asker wrote the accepted reply', async () => {
    await discussionNotificationWrites(
      service,
      accepted('teacher', { reply: post({ postId: 'r3' }) }),
    );
    expect(calls().map((c) => [c.type, c.userId])).toEqual([
      ['discussion.accepted', 'asker'],
    ]);
  });

  it('writes nothing for a hidden reply', async () => {
    expect(
      await discussionNotificationWrites(
        service,
        accepted('teacher', { reply: post({ postId: 'r1', state: 'hidden' }) }),
      ),
    ).toEqual([]);
  });

  it('builds valid input for every call', async () => {
    await discussionNotificationWrites(service, {
      kind: 'reply',
      reply,
      question,
    });
    await discussionNotificationWrites(service, accepted('teacher'));
    expect(calls()).toHaveLength(3);
    for (const input of calls()) {
      expect(() => buildNotification(input.type, input.params)).not.toThrow();
    }
  });
});

describe('discussionExcerpt', () => {
  it('keeps short text and collapses whitespace', () => {
    expect(discussionExcerpt('  a\n\n b  ')).toBe('a b');
  });

  it('cuts at 140 characters with an ellipsis', () => {
    const out = discussionExcerpt('x'.repeat(141));
    expect([...out]).toHaveLength(140);
    expect(out.endsWith('…')).toBe(true);
    expect(discussionExcerpt('x'.repeat(140))).toBe('x'.repeat(140));
  });

  it('does not split an emoji', () => {
    expect(discussionExcerpt('😀'.repeat(200)).endsWith('…')).toBe(true);
  });
});
