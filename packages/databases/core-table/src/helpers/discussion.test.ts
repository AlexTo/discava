/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCoreTableService } from '../service.js';
import {
  answeredState,
  checkPostId,
  DISCUSSION_BODY_MAX,
  DISCUSSION_TITLE_MAX,
  DiscussionInputError,
  type DiscussionOperation,
  type DiscussionPostRead,
  discussionWrites,
  lessonHasDiscussion,
  normaliseDiscussionText,
  postIdTime,
} from './discussion.js';
import { checkTableInvariants, type TableSnapshot } from './invariants.js';

const NOW = new Date('2026-11-16T10:00:00.000Z');

// A UUID v7 whose time part is `at`.
const v7 = (at: Date) => {
  const hex = at.getTime().toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-000000000001`;
};
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('normaliseDiscussionText', () => {
  const body = { min: 1, max: DISCUSSION_BODY_MAX };

  it('trims the text', () => {
    expect(normaliseDiscussionText('  hello \n', body)).toEqual({
      text: 'hello',
    });
  });

  it.each(['', '   ', '\n\t '])('refuses %j as empty', (text) => {
    expect(normaliseDiscussionText(text, body)).toEqual({ reason: 'empty' });
  });

  it('accepts 4,000 characters and refuses 4,001', () => {
    expect(normaliseDiscussionText('a'.repeat(4000), body).text).toHaveLength(
      4000,
    );
    expect(normaliseDiscussionText('a'.repeat(4001), body)).toEqual({
      reason: 'too-long',
    });
  });

  it('counts the trimmed text, not the padding', () => {
    expect(
      normaliseDiscussionText(` ${'a'.repeat(4000)} `, body).text,
    ).toHaveLength(4000);
  });

  it('counts an emoji and an accented letter as written, one each', () => {
    const emoji = '😀'.repeat(4000);
    expect(normaliseDiscussionText(emoji, body).text).toBe(emoji);
    expect(normaliseDiscussionText(`${emoji}😀`, body)).toEqual({
      reason: 'too-long',
    });
    const accents = 'é'.repeat(DISCUSSION_TITLE_MAX);
    expect(
      normaliseDiscussionText(accents, { min: 1, max: DISCUSSION_TITLE_MAX })
        .text,
    ).toBe(accents);
  });
});

describe('postIdTime', () => {
  it('reads the milliseconds of a UUID v7', () => {
    expect(postIdTime(v7(NOW))).toBe(NOW.getTime());
  });

  it.each([
    ['a UUID v4', '3b241101-e2bb-4255-8caf-4136c566a962'],
    ['a malformed string', 'not-an-id'],
    ['an empty string', ''],
  ])('is undefined for %s', (_, id) => {
    expect(postIdTime(id)).toBeUndefined();
  });
});

describe('checkPostId', () => {
  it('accepts an id from 9 minutes ago, and gives its time', () => {
    expect(checkPostId(v7(minutes(-9)), NOW)).toEqual({
      time: minutes(-9).toISOString(),
    });
  });

  it('accepts an id from 9 minutes ahead', () => {
    expect(checkPostId(v7(minutes(9)), NOW).reason).toBeUndefined();
  });

  it.each([
    ['a v4 UUID', '3b241101-e2bb-4255-8caf-4136c566a962', 'not-uuid-v7'],
    ['a malformed string', 'nope', 'not-uuid-v7'],
    ['an id 11 minutes in the past', v7(minutes(-11)), 'outside-window'],
    ['an id 11 minutes in the future', v7(minutes(11)), 'outside-window'],
  ])('refuses %s', (_, id, reason) => {
    expect(checkPostId(id, NOW)).toEqual({ reason });
  });
});

describe('answeredState', () => {
  it.each([
    ['shown', undefined, 0, 'unanswered'],
    ['shown', undefined, undefined, 'unanswered'],
    ['shown', 'r1', 0, 'answered'],
    ['shown', undefined, 1, 'answered'],
    ['shown', 'r1', 2, 'answered'],
    ['hidden', undefined, 0, 'not-open'],
    ['hidden', 'r1', 1, 'not-open'],
    ['deleted', undefined, 0, 'not-open'],
    ['deleted', 'r1', 1, 'not-open'],
  ] as const)(
    'a %s question, accepted %s, %s instructor replies: %s',
    (state, acceptedPostId, instructorReplyCount, expected) => {
      expect(
        answeredState({ state, acceptedPostId, instructorReplyCount }),
      ).toBe(expected);
    },
  );
});

// The requests ElectroDB would send, checked without a table.

let coreTable: Awaited<ReturnType<typeof createCoreTableService>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  coreTable = await createCoreTableService();
});

interface Conditional {
  ConditionExpression?: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}
interface TransactItem {
  ConditionCheck?: Conditional;
  Update?: Conditional & { UpdateExpression: string };
  Put?: Conditional & { Item: Record<string, unknown> };
  Delete?: Conditional;
}

const itemsOf = (op: DiscussionOperation): TransactItem[] | undefined => {
  let built = false;
  const { TransactItems } = coreTable.transaction
    .write((entities) => {
      const items = discussionWrites(entities, op);
      built = items !== undefined;
      return items ?? [];
    })
    .params() as { TransactItems: TransactItem[] };
  return built ? TransactItems : undefined;
};
const items = (op: DiscussionOperation) => itemsOf(op) as TransactItem[];

const requestOf = (item: TransactItem) =>
  (item.ConditionCheck ??
    item.Update ??
    item.Put ??
    item.Delete) as Conditional;

// A request's condition, with names and values filled in.
const conditionOf = (item: TransactItem) => {
  const request = requestOf(item);
  return (request.ConditionExpression ?? '').replace(
    /#\w+|:\w+/g,
    (token) =>
      `${request.ExpressionAttributeNames[token] ?? JSON.stringify(request.ExpressionAttributeValues[token]) ?? token}`,
  );
};
// The update's ADD, REMOVE and SET clauses, with names filled in.
const updateOf = (item: TransactItem) => {
  const request = item.Update as Conditional & { UpdateExpression: string };
  return request.UpdateExpression.replace(
    /#\w+/g,
    (t) => request.ExpressionAttributeNames[t] ?? t,
  ).replace(/:\w+/g, (t) =>
    JSON.stringify(request.ExpressionAttributeValues[t]),
  );
};
const clause = (update: string, name: 'SET' | 'ADD' | 'REMOVE') =>
  new RegExp(`${name} (.*?)(?= (?:SET|ADD|REMOVE|DELETE) |$)`).exec(
    update,
  )?.[1] ?? '';

const AT = new Date('2026-11-16T10:00:00.000Z');
const QID = v7(AT);
const RID = v7(new Date(AT.getTime() + 1000));
const scope = { courseId: 'c1', moduleId: 'm1', lessonId: 'l1' };
const student = { userId: 'student', name: 'Ada', isInstructor: false };
const teacher = { userId: 'teacher', name: 'Bo', isInstructor: true };
const ASK = {
  ...scope,
  type: 'ask' as const,
  postId: QID,
  author: student,
  title: 'Why?',
  body: 'Because.',
  now: AT,
};
const question = (over = {}) => ({
  threadId: QID,
  state: 'shown' as const,
  instructorReplyCount: 0,
  replyCount: 1,
  createdAt: AT.toISOString(),
  ...over,
});
const questionPost = {
  kind: 'question' as const,
  threadId: QID,
  postId: QID,
  authorId: 'student',
  state: 'shown' as const,
};
const replyPost = (over = {}) => ({
  kind: 'reply' as const,
  threadId: QID,
  postId: RID,
  authorId: 'other',
  authorIsInstructor: false,
  state: 'shown' as const,
  ...over,
});

const expectChecks = (list: TransactItem[]) => {
  expect(conditionOf(list[0]!)).toContain('status = "published"');
  expect(conditionOf(list[1]!)).toContain('visibility = "visible"');
  expect(conditionOf(list[1]!)).toContain('attribute_not_exists(archivedAt)');
  expect(conditionOf(list[2]!)).toContain('visibility = "visible"');
  expect(conditionOf(list[2]!)).toContain('attribute_not_exists(archivedAt)');
};

describe('ask', () => {
  it('checks the course, module and lesson and creates the question once', () => {
    const list = items(ASK);

    expect(list).toHaveLength(4);
    expectChecks(list);
    expect(list[3]!.Put?.Item).toMatchObject({
      kind: 'question',
      postId: QID,
      threadId: QID,
      createdAt: AT.toISOString(),
      title: 'Why?',
      body: 'Because.',
      authorId: 'student',
      authorName: 'Ada',
      authorIsInstructor: false,
      moduleId: 'm1',
      state: 'shown',
      replyCount: 0,
      instructorReplyCount: 0,
      voteCount: 0,
    });
    expect(conditionOf(list[3]!)).toContain('attribute_not_exists');
  });

  it('queues a new question as unanswered', () => {
    expect(items(ASK)[3]!.Put?.Item).toMatchObject({
      unanswered: 'c1',
      unansweredSince: AT.toISOString(),
    });
  });

  it('takes createdAt from the id, not the clock', () => {
    const later = new Date(AT.getTime() + 5 * 60_000);

    expect(items({ ...ASK, now: later })[3]!.Put?.Item).toMatchObject({
      createdAt: AT.toISOString(),
    });
  });

  it('trims the title and body', () => {
    expect(
      items({ ...ASK, title: '  Why? ', body: ' Because.\n' })[3]!.Put?.Item,
    ).toMatchObject({ title: 'Why?', body: 'Because.' });
  });

  it.each([
    ['an id that is not a UUID v7', { postId: 'abc' }],
    ['a UUID v4', { postId: '3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b3c' }],
    [
      'an id from 11 minutes ago',
      { postId: v7(new Date(AT.getTime() - 11 * 60_000)) },
    ],
    [
      'an id from 11 minutes ahead',
      { postId: v7(new Date(AT.getTime() + 11 * 60_000)) },
    ],
    ['a blank title', { title: '  ' }],
    ['a title over 120 characters', { title: 'a'.repeat(121) }],
    ['a blank body', { body: '' }],
    ['a body over 4,000 characters', { body: 'a'.repeat(4001) }],
  ])('refuses %s before building any item', (_name, over) => {
    expect(() => items({ ...ASK, ...over })).toThrow(DiscussionInputError);
  });
});

describe('reply', () => {
  const REPLY = {
    ...scope,
    type: 'reply' as const,
    threadId: QID,
    postId: RID,
    author: student,
    body: 'Like this.',
    now: AT,
  };

  it("refuses a reply whose postId is the question's id", () => {
    expect(() => items({ ...REPLY, postId: QID })).toThrow(
      DiscussionInputError,
    );
  });

  it('checks, adds one to replyCount only, and creates the reply', () => {
    const list = items(REPLY);

    expect(list).toHaveLength(5);
    expectChecks(list);
    const update = updateOf(list[3]!);
    expect(clause(update, 'ADD')).toBe('replyCount 1');
    expect(clause(update, 'REMOVE')).toBe('');
    expect(list[4]!.Put?.Item).toMatchObject({
      kind: 'reply',
      threadId: QID,
      postId: RID,
      createdAt: new Date(AT.getTime() + 1000).toISOString(),
    });
    expect(list[4]!.Put?.Item).not.toHaveProperty('title');
    expect(list[4]!.Put?.Item).not.toHaveProperty('unanswered');
  });

  it('is conditioned on the question being shown and under 500 replies', () => {
    const condition = conditionOf(items(REPLY)[3]!);

    expect(condition).toContain('state = "shown"');
    expect(condition).toContain('replyCount < 500');
    expect(condition).toContain('attribute_exists(pk)');
    expect(condition.match(/ AND /g)).toHaveLength(3);
    expect(conditionOf(items(REPLY)[4]!)).toContain('attribute_not_exists');
  });

  it('also counts an instructor’s reply and takes the question off the unanswered queue', () => {
    const list = items({ ...REPLY, author: teacher });
    const update = updateOf(list[3]!);

    expect(clause(update, 'ADD')).toContain('replyCount 1');
    expect(clause(update, 'ADD')).toContain('instructorReplyCount 1');
    expect(clause(update, 'REMOVE')).toContain('unanswered');
    expect(clause(update, 'REMOVE')).toContain('unansweredSince');
    expect(list[4]!.Put?.Item).toMatchObject({ authorIsInstructor: true });
  });

  it.each([
    [
      'an id outside the window',
      { postId: v7(new Date(AT.getTime() - 11 * 60_000)) },
    ],
    ['a body over 4,000 characters', { body: 'a'.repeat(4001) }],
    ['a blank body', { body: ' ' }],
  ])('refuses %s', (_name, over) => {
    expect(() => items({ ...REPLY, ...over })).toThrow(DiscussionInputError);
  });
});

describe('vote and unvote', () => {
  const VOTE = {
    ...scope,
    type: 'vote' as const,
    userId: 'voter',
    post: replyPost(),
  };

  it('creates the vote once and adds one to the post’s voteCount', () => {
    const list = items(VOTE);

    expect(list).toHaveLength(5);
    expectChecks(list);
    expect(list[3]!.Put?.Item).toMatchObject({
      userId: 'voter',
      threadId: QID,
      postId: RID,
    });
    expect(conditionOf(list[3]!)).toContain('attribute_not_exists');
    expect(clause(updateOf(list[4]!), 'ADD')).toBe('voteCount 1');
  });

  it('needs the post shown and not the voter’s own, even when the author was not known', () => {
    const condition = conditionOf(
      items({ ...VOTE, post: replyPost({ authorId: undefined }) })[4]!,
    );

    expect(condition).toContain('state = "shown"');
    expect(condition).toContain('authorId <> "voter"');
  });

  it('refuses a vote on one’s own post before building items', () => {
    expect(() =>
      items({ ...VOTE, post: replyPost({ authorId: 'voter' }) }),
    ).toThrow(DiscussionInputError);
  });

  it('removes a vote that exists and takes one off voteCount, whatever the post’s state', () => {
    const list = items({
      ...VOTE,
      type: 'unvote',
      post: replyPost({ state: 'hidden' }),
    });

    expect(list).toHaveLength(5);
    expectChecks(list);
    expect(list[3]!.Delete).toBeDefined();
    expect(conditionOf(list[3]!)).toContain('attribute_exists(userId)');
    expect(clause(updateOf(list[4]!), 'SET')).toContain(
      'voteCount = (if_not_exists(voteCount, 0) - 1)',
    );
    expect(conditionOf(list[4]!)).not.toContain('state');
  });
});

describe('accept', () => {
  const ACCEPT = {
    ...scope,
    type: 'accept' as const,
    question: question(),
    replyId: RID,
  };

  it('sets the first answer, off the unanswered queue, if the reply is a shown one of a shown question', () => {
    const list = items(ACCEPT);

    expect(list).toHaveLength(5);
    expectChecks(list);
    expect(conditionOf(list[3]!)).toContain('state = "shown"');
    expect(list[3]!.ConditionCheck?.ExpressionAttributeValues).toBeDefined();
    const update = updateOf(list[4]!);
    expect(clause(update, 'SET')).toContain(`acceptedPostId = \"${RID}"`);
    expect(clause(update, 'REMOVE')).toContain('unanswered');
    const condition = conditionOf(list[4]!);
    expect(condition).toContain('state = "shown"');
    expect(condition).toContain('attribute_not_exists(acceptedPostId)');
  });

  it('replaces an answer, conditioned on the one read', () => {
    const list = items({
      ...ACCEPT,
      question: question({ acceptedPostId: 'old' }),
    });

    expect(conditionOf(list[4]!)).toContain('acceptedPostId = "old"');
    expect(clause(updateOf(list[4]!), 'SET')).toContain(
      `acceptedPostId = \"${RID}"`,
    );
  });

  it('is a no-op when the reply is already the answer', () => {
    expect(
      itemsOf({ ...ACCEPT, question: question({ acceptedPostId: RID }) }),
    ).toBeUndefined();
  });

  it('checks the reply of that question: the key holds its threadId and kind', () => {
    const check = items(ACCEPT)[3]!.ConditionCheck as unknown as {
      Key: { sk: string };
    };

    expect(check.Key.sk).toContain('kind_reply');
    expect(check.Key.sk).toContain(`threadid_${QID}`);
  });
});

describe('unaccept', () => {
  const UNACCEPT = {
    ...scope,
    type: 'unaccept' as const,
    question: question({ acceptedPostId: RID }),
  };

  it('removes the answer and queues the question again when no instructor replied', () => {
    const list = items(UNACCEPT);
    const update = updateOf(list[3]!);

    expect(list).toHaveLength(4);
    expectChecks(list);
    expect(clause(update, 'REMOVE')).toContain('acceptedPostId');
    expect(clause(update, 'SET')).toContain('unanswered = \"c1"');
    expect(clause(update, 'SET')).toContain('unansweredSince');
    const condition = conditionOf(list[3]!);
    expect(condition).toContain(`acceptedPostId = "${RID}"`);
    expect(condition).toContain('instructorReplyCount = 0');
  });

  it('leaves the queue alone when an instructor has replied', () => {
    const list = items({
      ...UNACCEPT,
      question: question({ acceptedPostId: RID, instructorReplyCount: 1 }),
    });
    const update = updateOf(list[3]!);

    expect(clause(update, 'REMOVE')).toContain('acceptedPostId');
    expect(clause(update, 'SET')).not.toContain('unanswered = \"');
    expect(conditionOf(list[3]!)).toContain('instructorReplyCount = 1');
  });

  it('is a no-op when there is no answer', () => {
    expect(itemsOf({ ...UNACCEPT, question: question() })).toBeUndefined();
  });
});

describe('hide, unhide and delete', () => {
  const op = (type: 'hide' | 'unhide' | 'delete', over = {}) =>
    ({
      courseId: 'c1',
      lessonId: 'l1',
      type,
      ...over,
    }) as DiscussionOperation;
  const REPLY_BY_STUDENT = { post: replyPost(), question: question() };
  const REPLY_BY_TEACHER = {
    post: replyPost({ authorIsInstructor: true }),
    question: question({ instructorReplyCount: 1 }),
  };

  it('includes no course, module or lesson check', () => {
    expect(items(op('hide', REPLY_BY_STUDENT))).toHaveLength(2);
    expect(items(op('hide', { post: questionPost }))).toHaveLength(1);
  });

  describe('a reply', () => {
    it('hiding a student’s reply moves only replyCount and the reply’s state', () => {
      const list = items(op('hide', REPLY_BY_STUDENT));

      expect(clause(updateOf(list[0]!), 'SET')).toContain('state = \"hidden"');
      expect(conditionOf(list[0]!)).toContain('state = "shown"');
      const update = updateOf(list[1]!);
      expect(clause(update, 'SET')).toContain(
        'replyCount = (if_not_exists(replyCount, 0) - 1)',
      );
      expect(clause(update, 'SET')).not.toContain('instructorReplyCount');
      expect(clause(update, 'REMOVE')).toBe('');
      expect(clause(update, 'SET')).not.toContain('unanswered = \"');
    });

    it('hiding an instructor’s only reply queues the question again', () => {
      const update = updateOf(items(op('hide', REPLY_BY_TEACHER))[1]!);

      expect(clause(update, 'SET')).toContain(
        'instructorReplyCount = (if_not_exists(instructorReplyCount, 0) - 1)',
      );
      expect(clause(update, 'SET')).toContain('unanswered = \"c1"');
      expect(conditionOf(items(op('hide', REPLY_BY_TEACHER))[1]!)).toContain(
        'instructorReplyCount = 1',
      );
    });

    it('hiding one of two instructor replies leaves the queue alone', () => {
      const update = updateOf(
        items(
          op('hide', {
            post: replyPost({ authorIsInstructor: true }),
            question: question({ instructorReplyCount: 2 }),
          }),
        )[1]!,
      );

      expect(clause(update, 'SET')).toContain(
        'instructorReplyCount = (if_not_exists(instructorReplyCount, 0) - 1)',
      );
      expect(clause(update, 'SET')).not.toContain('unanswered = \"');
      expect(clause(update, 'REMOVE')).not.toContain('unanswered');
    });

    it('hiding the accepted answer removes it, and queues the question when no instructor replied', () => {
      const list = items(
        op('hide', {
          post: replyPost(),
          question: question({ acceptedPostId: RID }),
        }),
      );
      const update = updateOf(list[1]!);

      expect(clause(update, 'REMOVE')).toContain('acceptedPostId');
      expect(clause(update, 'SET')).toContain('unanswered = \"c1"');
      expect(conditionOf(list[1]!)).toContain(`acceptedPostId = "${RID}"`);
    });

    it('hiding the accepted answer of an instructor-answered question keeps it answered', () => {
      const update = updateOf(
        items(
          op('hide', {
            post: replyPost(),
            question: question({
              acceptedPostId: RID,
              instructorReplyCount: 1,
            }),
          }),
        )[1]!,
      );

      expect(clause(update, 'REMOVE')).toContain('acceptedPostId');
      expect(clause(update, 'SET')).not.toContain('unanswered = \"');
    });

    it('unhiding adds one back, and an instructor’s reply takes the question off the queue', () => {
      const student = items(
        op('unhide', {
          post: replyPost({ state: 'hidden' }),
          question: question({ replyCount: 0 }),
        }),
      );
      const teacher = items(
        op('unhide', {
          post: replyPost({ state: 'hidden', authorIsInstructor: true }),
          question: question({ replyCount: 0 }),
        }),
      );

      expect(clause(updateOf(student[1]!), 'ADD')).toBe('replyCount 1');
      expect(conditionOf(student[1]!)).toContain('replyCount < 500');
      expect(clause(updateOf(teacher[1]!), 'ADD')).toContain(
        'instructorReplyCount 1',
      );
      expect(clause(updateOf(teacher[1]!), 'REMOVE')).toContain('unanswered');
    });

    it('refuses to unhide a reply of a question with 500 shown replies', () => {
      expect(() =>
        items(
          op('unhide', {
            post: replyPost({ state: 'hidden' }),
            question: question({ replyCount: 500 }),
          }),
        ),
      ).toThrow(DiscussionInputError);
    });

    it('deleting a shown reply is final and counts like a hide', () => {
      const list = items(op('delete', REPLY_BY_STUDENT));
      const update = updateOf(list[0]!);

      expect(clause(update, 'SET')).toContain('state = \"deleted"');
      for (const name of [
        'title',
        'body',
        'reportedBy',
        'reported',
        'reportedSince',
      ]) {
        expect(clause(update, 'REMOVE')).toContain(name);
      }
      expect(clause(updateOf(list[1]!), 'SET')).toContain(
        'replyCount = (if_not_exists(replyCount, 0) - 1)',
      );
    });

    it('deleting a hidden reply changes no counts', () => {
      const list = items(
        op('delete', {
          post: replyPost({ state: 'hidden' }),
          question: question(),
        }),
      );

      expect(list).toHaveLength(1);
      expect(conditionOf(list[0]!)).toContain('state = "hidden"');
    });
  });

  describe('a question', () => {
    it('hiding takes it off the unanswered queue and keeps its answer', () => {
      const update = updateOf(items(op('hide', { post: questionPost }))[0]!);

      expect(clause(update, 'SET')).toContain('state = \"hidden"');
      expect(clause(update, 'REMOVE')).toContain('unanswered');
      expect(clause(update, 'REMOVE')).not.toContain('acceptedPostId');
    });

    it('unhiding queues an unanswered question again, conditioned on what was read', () => {
      const list = items(
        op('unhide', {
          post: { ...questionPost, state: 'hidden' },
          question: question({ state: 'hidden' }),
        }),
      );
      const update = updateOf(list[0]!);

      expect(clause(update, 'SET')).toContain('state = \"shown"');
      expect(clause(update, 'SET')).toContain('unanswered = \"c1"');
      const condition = conditionOf(list[0]!);
      expect(condition).toContain('state = "hidden"');
      expect(condition).toContain('attribute_not_exists(acceptedPostId)');
      expect(condition).toContain('instructorReplyCount = 0');
    });

    it('unhiding an answered question restores it as it was', () => {
      const update = updateOf(
        items(
          op('unhide', {
            post: { ...questionPost, state: 'hidden' },
            question: question({ state: 'hidden', acceptedPostId: RID }),
          }),
        )[0]!,
      );

      expect(clause(update, 'SET')).not.toContain('unanswered = \"');
      expect(clause(update, 'REMOVE')).not.toContain('acceptedPostId');
    });

    it('deleting removes its text, reports, answer and queue entry', () => {
      const update = updateOf(
        items(
          op('delete', {
            post: { ...questionPost, state: 'hidden' },
            question: question({ state: 'hidden', acceptedPostId: RID }),
          }),
        )[0]!,
      );

      expect(clause(update, 'SET')).toContain('state = \"deleted"');
      for (const name of [
        'title',
        'body',
        'reportedBy',
        'reported',
        'acceptedPostId',
        'unanswered',
      ]) {
        expect(clause(update, 'REMOVE')).toContain(name);
      }
    });
  });

  it('hide on hide is a no-op the caller can detect', () => {
    expect(
      itemsOf(
        op('hide', {
          post: replyPost({ state: 'hidden' }),
          question: question(),
        }),
      ),
    ).toBeUndefined();
    expect(
      itemsOf(
        op('delete', {
          post: replyPost({ state: 'deleted' }),
          question: question(),
        }),
      ),
    ).toBeUndefined();
  });

  it.each(['hide', 'unhide'] as const)(
    '%s of a deleted post is refused',
    (type) => {
      expect(() =>
        items(
          op(type, {
            post: replyPost({ state: 'deleted' }),
            question: question(),
          }),
        ),
      ).toThrow(DiscussionInputError);
    },
  );
});

describe('report and dismiss', () => {
  const REPORT = {
    ...scope,
    type: 'report' as const,
    reporterId: 'r1',
    post: replyPost(),
    now: AT,
  };

  it('adds the reporter and flags the post, for a shown post of someone else', () => {
    const list = items(REPORT);

    expect(list).toHaveLength(4);
    expectChecks(list);
    const update = updateOf(list[3]!);
    expect(clause(update, 'SET')).toContain('reported = \"c1"');
    expect(clause(update, 'SET')).toContain(
      `reportedSince = \"${AT.toISOString()}"`,
    );
    expect(list[3]!.Update!.UpdateExpression).toMatch(/ADD .*reportedBy/);
    const condition = conditionOf(list[3]!);
    expect(condition).toContain('state = "shown"');
    expect(condition).toContain('authorId <> "r1"');
    expect(condition).toContain('attribute_not_exists(reportedBy)');
    expect(condition).toContain('contains(reportedBy, "r1")');
    expect(condition).toContain('size(reportedBy) < 20');
  });

  it('uses every attribute name it sends, which DynamoDB insists on', () => {
    for (const item of items(REPORT)) {
      const request = requestOf(item) as Conditional & {
        UpdateExpression?: string;
      };
      const text = `${request.ConditionExpression ?? ''} ${request.UpdateExpression ?? ''}`;
      for (const name of Object.keys(request.ExpressionAttributeNames)) {
        expect(text, name).toMatch(new RegExp(`${name}(?!\\w)`));
      }
    }
  });

  it('keeps the time of the first report', () => {
    const since = '2026-11-16T09:00:00.000Z';

    expect(
      clause(
        updateOf(
          items({ ...REPORT, reporterIds: ['r0'], reportedSince: since })[3]!,
        ),
        'SET',
      ),
    ).toContain(`reportedSince = "${since}"`);
  });

  it('lets the same reporter report again, but the 21st reporter is a no-write', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `r${i}`);

    const full = { ...REPORT, reporterIds: twenty };

    expect(itemsOf({ ...full, reporterId: 'r20' })).toBeUndefined();
    expect(itemsOf({ ...full, reporterId: 'r0' })).toBeDefined();
    expect(
      itemsOf({ ...REPORT, reporterId: 'r20', reporterIds: twenty.slice(1) }),
    ).toBeDefined();
  });

  it('refuses a report of one’s own post', () => {
    expect(() =>
      items({ ...REPORT, post: replyPost({ authorId: 'r1' }) }),
    ).toThrow(DiscussionInputError);
  });

  it('does not report a post that is hidden meanwhile: the condition needs it shown', () => {
    expect(conditionOf(items(REPORT)[3]!)).toContain('state = "shown"');
  });

  it('dismiss removes both flags, if the post is still reported, with no checks', () => {
    const list = items({
      type: 'dismiss',
      courseId: 'c1',
      lessonId: 'l1',
      post: replyPost(),
    });

    expect(list).toHaveLength(1);
    const remove = clause(updateOf(list[0]!), 'REMOVE');
    for (const name of ['reportedBy', 'reported', 'reportedSince']) {
      expect(remove).toContain(name);
    }
    expect(conditionOf(list[0]!)).toContain('attribute_exists(reported)');
  });
});

describe('lessonHasDiscussion', () => {
  // A one-query stand-in: it answers by the key it is asked for.
  const serviceWith = (posts: { lessonId: string }[]) => {
    const asked: unknown[] = [];
    const service = {
      entities: {
        discussionPost: {
          query: {
            primary: (key: {
              courseId: string;
              kind: string;
              lessonId: string;
            }) => ({
              go: async (options: unknown) => {
                asked.push({ key, options });
                return {
                  data: posts
                    .filter((p) => p.lessonId === key.lessonId)
                    .slice(0, 1),
                };
              },
            }),
          },
        },
      },
    } as unknown as typeof coreTable;
    return { service, asked };
  };

  it('is true with a post, false with none, and ignores another lesson’s', async () => {
    const key = { courseId: 'c1', lessonId: 'l1' };

    expect(
      await lessonHasDiscussion(serviceWith([{ lessonId: 'l1' }]).service, key),
    ).toBe(true);
    expect(await lessonHasDiscussion(serviceWith([]).service, key)).toBe(false);
    expect(
      await lessonHasDiscussion(serviceWith([{ lessonId: 'l2' }]).service, key),
    ).toBe(false);
  });

  it('is one keyed query on questions of the lesson, limit 1', async () => {
    const { service, asked } = serviceWith([]);
    await lessonHasDiscussion(service, { courseId: 'c1', lessonId: 'l1' });

    expect(asked).toEqual([
      {
        key: { courseId: 'c1', kind: 'question', lessonId: 'l1' },
        options: { limit: 1 },
      },
    ]);
  });
});

// An in-memory stand-in for the entities discussionWrites builds from. It
// keeps DynamoDB's transaction rules that matter here: every condition is
// checked against the table as it was before the transaction, all of the items
// apply or none, and two operations on one item are refused. Transactions run
// one at a time, which is the order DynamoDB would give two that raced; each
// request is built from a read taken beforehand, so a later one meets what the
// earlier one wrote.
describe('concurrent writes against an in-memory table', () => {
  type Row = Record<string, any>;
  interface Operation {
    key: string;
    allowed: (row?: Row) => boolean;
    apply: (row?: Row) => Row | undefined;
  }

  const KEY_FIELDS: Record<string, string[]> = {
    course: ['courseId'],
    module: ['courseId', 'moduleId'],
    lesson: ['courseId', 'moduleId', 'lessonId'],
    discussionPost: ['courseId', 'kind', 'lessonId', 'threadId', 'postId'],
    discussionVote: ['courseId', 'userId', 'lessonId', 'threadId', 'postId'],
  };
  const keyOf = (entity: string, row: Row) =>
    `${entity}|${KEY_FIELDS[entity]!.map((f) => row[f]).join('|')}`;

  // A `where` callback builds its condition from the operations below, each of
  // which returns a token standing for its predicate; DynamoDB treats a
  // comparison with a missing attribute as false (but `<>` as true).
  const conditionOf = (where?: (attr: any, op: any) => string) => {
    const tests: ((row?: Row) => boolean)[] = [];
    const token = (test: (row?: Row) => boolean) => {
      tests.push(test);
      return `[${tests.length - 1}]`;
    };
    const attr = new Proxy({}, { get: (_, name) => String(name) });
    const op = {
      eq: (n: string, v: unknown) => token((r) => r?.[n] === v),
      ne: (n: string, v: unknown) => token((r) => r?.[n] !== v),
      lt: (n: string, v: number) =>
        token((r) => r?.[n] !== undefined && r[n] < v),
      exists: (n: string) => token((r) => r?.[n] !== undefined),
      notExists: (n: string) => token((r) => r?.[n] === undefined),
      contains: (n: string, v: string) =>
        token((r) => (r?.[n] as Set<string> | undefined)?.has(v) ?? false),
      name: (n: string) => `@${n}`,
      value: (_n: string, v: number) => `#${v}`,
    };
    let expression = where?.(attr, op) ?? '';
    expression = expression.replace(
      /size\(@(\w+)\) < #(\d+)/g,
      (_all, n: string, v: string) =>
        token((r) => r?.[n] !== undefined && r[n].size < Number(v)),
    );
    const source = expression
      .replace(/ AND /g, ' && ')
      .replace(/ OR /g, ' || ')
      .replace(/\[(\d+)\]/g, 't($1)');
    if (!/^[\s\d&|()t]*$/.test(source)) {
      throw new Error(`The fake cannot read ${expression}`);
    }
    const evaluate = new Function('t', `return ${source || 'true'}`) as (
      t: (n: number) => boolean,
    ) => boolean;
    return (row?: Row) => evaluate((n) => tests[n]!(row));
  };

  const builder = (
    entity: string,
    key: Row,
    mode: 'create' | 'patch' | 'check' | 'delete',
    item?: Row,
  ) => {
    let where: ((attr: any, op: any) => string) | undefined;
    const changes: { set: Row; add: Row; subtract: Row; remove: string[] } = {
      set: {},
      add: {},
      subtract: {},
      remove: [],
    };
    const self: any = {
      set: (v: Row) => (Object.assign(changes.set, v), self),
      add: (v: Row) => (Object.assign(changes.add, v), self),
      subtract: (v: Row) => (Object.assign(changes.subtract, v), self),
      remove: (names: string[]) => (changes.remove.push(...names), self),
      where: (fn: typeof where) => ((where = fn), self),
      commit: (): Operation => {
        const holds = conditionOf(where);
        return {
          key: keyOf(entity, item ?? key),
          allowed: (row) => {
            if (mode === 'create') {
              return row === undefined;
            }
            if (mode === 'patch' && row === undefined) {
              return false;
            }
            return holds(row);
          },
          apply: (row) => {
            if (mode === 'create') {
              return {
                state: 'shown',
                replyCount: 0,
                instructorReplyCount: 0,
                voteCount: 0,
                ...item,
              };
            }
            if (mode === 'delete') {
              return undefined;
            }
            const next = { ...row };
            Object.assign(next, changes.set);
            for (const [n, v] of Object.entries(changes.add)) {
              next[n] = Array.isArray(v)
                ? new Set([...(next[n] ?? []), ...v])
                : (next[n] ?? 0) + (v as number);
            }
            for (const [n, v] of Object.entries(changes.subtract)) {
              next[n] = (next[n] ?? 0) - (v as number);
            }
            for (const n of changes.remove) {
              delete next[n];
            }
            return next;
          },
        };
      },
    };
    return self;
  };

  const fakeEntities = () => {
    const entity = (name: string) => ({
      create: (item: Row) => builder(name, item, 'create', item),
      patch: (key: Row) => builder(name, key, 'patch'),
      check: (key: Row) => builder(name, key, 'check'),
      delete: (key: Row) => builder(name, key, 'delete'),
    });
    return {
      course: entity('course'),
      module: entity('module'),
      lesson: entity('lesson'),
      discussionPost: entity('discussionPost'),
      discussionVote: entity('discussionVote'),
    } as unknown as Parameters<typeof discussionWrites>[0];
  };

  let rows: Map<string, Row>;
  const WHEN = new Date('2026-11-16T10:00:00.000Z');
  let counter: number;
  const nextId = () => {
    counter += 1;
    const hex = (WHEN.getTime() + counter).toString(16).padStart(12, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-${String(counter).padStart(12, '0')}`;
  };

  // A published course with a visible module and lesson.
  const seed = () => {
    counter = 0;
    rows = new Map([
      [keyOf('course', scope), { courseId: 'c1', status: 'published' }],
      [keyOf('module', scope), { ...scope, visibility: 'visible' }],
      [keyOf('lesson', scope), { ...scope, visibility: 'visible' }],
    ]);
  };
  beforeEach(seed);

  // Takes effect or is cancelled, like one transaction.
  const run = (op: DiscussionOperation): 'ok' | 'cancelled' | 'no-write' => {
    const items = discussionWrites(fakeEntities(), op) as unknown as
      | Operation[]
      | undefined;
    if (items === undefined) {
      return 'no-write';
    }
    const keys = new Set(items.map((i) => i.key));
    if (keys.size !== items.length) {
      throw new Error('two operations on one item');
    }
    if (!items.every((i) => i.allowed(rows.get(i.key)))) {
      return 'cancelled';
    }
    const next = items.map((i) => [i.key, i.apply(rows.get(i.key))] as const);
    for (const [key, row] of next) {
      if (row === undefined) {
        rows.delete(key);
      } else {
        rows.set(key, row);
      }
    }
    return 'ok';
  };

  const posts = () =>
    [...rows.entries()]
      .filter(([k]) => k.startsWith('discussionPost|'))
      .map(([, r]) => r);
  const post = (postId: string) => posts().find((p) => p.postId === postId)!;
  const votes = () =>
    [...rows.entries()]
      .filter(([k]) => k.startsWith('discussionVote|'))
      .map(([, r]) => r);

  // Reads a post as a procedure would before it builds an operation.
  const read = (postId: string): DiscussionPostRead => {
    const p = post(postId);
    return {
      kind: p.kind,
      threadId: p.threadId,
      postId: p.postId,
      authorId: p.authorId,
      authorIsInstructor: p.authorIsInstructor,
      state: p.state,
    };
  };
  const readQuestion = (threadId: string) => {
    const q = post(threadId);
    return {
      threadId,
      state: q.state,
      acceptedPostId: q.acceptedPostId,
      replyCount: q.replyCount,
      instructorReplyCount: q.instructorReplyCount,
      createdAt: q.createdAt,
    };
  };

  const ask = (author = student) => {
    const postId = nextId();
    expect(run({ ...ASK, postId, author, title: 'Why?', now: WHEN })).toBe(
      'ok',
    );
    return postId;
  };
  const replyOp = (
    threadId: string,
    author = student,
  ): DiscussionOperation => ({
    ...scope,
    type: 'reply',
    threadId,
    postId: nextId(),
    author,
    body: 'Like this.',
    now: WHEN,
  });
  const replyTo = (threadId: string, author = student) => {
    const op = replyOp(threadId, author) as { postId: string };
    expect(run(op as DiscussionOperation)).toBe('ok');
    return op.postId;
  };
  const hideOp = (type: 'hide' | 'unhide' | 'delete', id: string) => {
    const p = read(id);
    return {
      type,
      courseId: 'c1',
      lessonId: 'l1',
      post: p,
      question: readQuestion(p.threadId),
    } as DiscussionOperation;
  };
  const acceptOp = (
    threadId: string,
    replyId: string,
  ): DiscussionOperation => ({
    ...scope,
    type: 'accept',
    question: readQuestion(threadId),
    replyId,
  });
  const voteOp = (id: string, userId: string): DiscussionOperation => ({
    ...scope,
    type: 'vote',
    userId,
    post: read(id),
  });

  // The invariant checks over the fake's records.
  const violations = () => {
    const snapshot = new Proxy(
      {
        lessons: [{ ...scope }],
        discussionPosts: posts().map((p) => ({
          ...p,
          reportedBy:
            p.reportedBy === undefined ? undefined : [...p.reportedBy],
        })),
        discussionVotes: votes(),
      } as Record<string, unknown>,
      { get: (target, name: string) => target[name] ?? [] },
    ) as unknown as TableSnapshot;
    return checkTableInvariants(snapshot)
      .filter((v) => v.invariant.startsWith('discussion-'))
      .map((v) => `${v.invariant}: ${v.message}`);
  };

  it('has checks that would catch a broken table', () => {
    const q = ask();
    post(q).replyCount = 3;

    expect(violations().join('\n')).toMatch(/discussion-counts-match/);
  });

  it('keeps the invariants for plain writes', () => {
    const q = ask();
    const r = replyTo(q, teacher);
    run(voteOp(r, 'voter'));

    expect(violations()).toEqual([]);
    expect(post(q)).toMatchObject({ replyCount: 1, instructorReplyCount: 1 });
    expect(post(q).unanswered).toBeUndefined();
    expect(post(r).voteCount).toBe(1);
  });

  it('counts 50 concurrent student replies, and refuses the 501st', () => {
    const q = ask();
    const requests = Array.from({ length: 50 }, () => replyOp(q));

    expect(requests.map(run)).toEqual(Array(50).fill('ok'));
    expect(post(q).replyCount).toBe(50);
    expect(violations()).toEqual([]);

    for (let i = 0; i < 450; i++) {
      replyTo(q);
    }
    expect(post(q).replyCount).toBe(500);
    expect(run(replyOp(q))).toBe('cancelled');
    expect(post(q).replyCount).toBe(500);
    expect(posts().filter((p) => p.kind === 'reply')).toHaveLength(500);
    expect(violations()).toEqual([]);
  });

  it('counts two votes by different users, and one by the same user twice', () => {
    const q = ask();
    const a = voteOp(q, 'a');
    const b = voteOp(q, 'b');
    expect([run(a), run(b)]).toEqual(['ok', 'ok']);
    expect(post(q).voteCount).toBe(2);

    const again = voteOp(q, 'c');
    const twice = voteOp(q, 'c');
    expect([run(again), run(twice)]).toEqual(['ok', 'cancelled']);
    expect(post(q).voteCount).toBe(3);
    expect(votes()).toHaveLength(3);
    expect(violations()).toEqual([]);
  });

  it('takes a vote back once, even after the post is hidden', () => {
    const q = ask();
    run(voteOp(q, 'a'));
    run(hideOp('hide', q));
    const unvote: DiscussionOperation = {
      ...scope,
      type: 'unvote',
      userId: 'a',
      post: read(q),
    };

    expect([run(unvote), run(unvote)]).toEqual(['ok', 'cancelled']);
    expect(post(q).voteCount).toBe(0);
    expect(violations()).toEqual([]);
  });

  describe('a reply racing a hide of its question', () => {
    it('is refused when the hide lands first', () => {
      const q = ask();
      const reply = replyOp(q);
      const hide = hideOp('hide', q);

      expect([run(hide), run(reply)]).toEqual(['ok', 'cancelled']);
      expect(post(q)).toMatchObject({ state: 'hidden', replyCount: 0 });
      expect(violations()).toEqual([]);
    });

    it('lands before the hide, and the counts match', () => {
      const q = ask();
      const reply = replyOp(q);
      const hide = hideOp('hide', q);

      expect([run(reply), run(hide)]).toEqual(['ok', 'ok']);
      expect(post(q)).toMatchObject({ state: 'hidden', replyCount: 1 });
      expect(post(q).unanswered).toBeUndefined();
      expect(violations()).toEqual([]);
    });
  });

  describe('accepting a reply', () => {
    it('never leaves the answer on a reply hidden at the same time (hide first)', () => {
      const q = ask();
      const r = replyTo(q);
      const accept = acceptOp(q, r);
      const hide = hideOp('hide', r);

      expect([run(hide), run(accept)]).toEqual(['ok', 'cancelled']);
      expect(post(q).acceptedPostId).toBeUndefined();
      expect(violations()).toEqual([]);
    });

    it('never leaves the answer on a reply hidden at the same time (accept first)', () => {
      const q = ask();
      const r = replyTo(q);
      const accept = acceptOp(q, r);
      const hide = hideOp('hide', r);

      expect([run(accept), run(hide)]).toEqual(['ok', 'cancelled']);
      expect(post(r).state).toBe('shown');

      // The retry re-reads, hides the reply and takes the answer off with it.
      expect(run(hideOp('hide', r))).toBe('ok');
      expect(post(q).acceptedPostId).toBeUndefined();
      expect(post(q).unanswered).toBe('c1');
      expect(violations()).toEqual([]);
    });

    it('never leaves the answer on a question deleted at the same time', () => {
      const setup = () => {
        seed();
        const q = ask();
        const r = replyTo(q);
        return { q, accept: acceptOp(q, r), remove: hideOp('delete', q) };
      };

      let { q, accept, remove } = setup();
      expect([run(accept), run(remove)]).toEqual(['ok', 'ok']);
      expect(post(q).state).toBe('deleted');
      expect(post(q).acceptedPostId).toBeUndefined();
      expect(post(q).unanswered).toBeUndefined();
      expect(violations()).toEqual([]);

      ({ q, accept, remove } = setup());
      expect([run(remove), run(accept)]).toEqual(['ok', 'cancelled']);
      expect(post(q).acceptedPostId).toBeUndefined();
      expect(violations()).toEqual([]);
    });
  });

  describe('hiding the only instructor reply', () => {
    it('leaves unanswered correct while a student replies', () => {
      const q = ask();
      const instructorReply = replyTo(q, teacher);
      expect(post(q).unanswered).toBeUndefined();
      const hide = hideOp('hide', instructorReply);
      const studentReply = replyOp(q);

      expect([run(studentReply), run(hide)]).toEqual(['ok', 'ok']);
      expect(post(q)).toMatchObject({ replyCount: 1, instructorReplyCount: 0 });
      expect(post(q).unanswered).toBe('c1');
      expect(violations()).toEqual([]);
    });

    it('is refused, and works on retry, when another instructor reply lands first', () => {
      const q = ask();
      const first = replyTo(q, teacher);
      const hide = hideOp('hide', first);
      const second = replyOp(q, teacher);

      expect([run(second), run(hide)]).toEqual(['ok', 'cancelled']);
      expect(run(hideOp('hide', first))).toBe('ok');
      expect(post(q)).toMatchObject({ replyCount: 1, instructorReplyCount: 1 });
      expect(post(q).unanswered).toBeUndefined();
      expect(violations()).toEqual([]);
    });
  });

  it('keeps the question and counts right through a hide, an unhide and a delete of its replies', () => {
    const q = ask();
    const r1 = replyTo(q);
    const r2 = replyTo(q, teacher);
    run(acceptOp(q, r1));

    expect(run(hideOp('hide', r1))).toBe('ok');
    expect(run(hideOp('hide', r1))).toBe('no-write');
    expect(run(hideOp('unhide', r1))).toBe('ok');
    expect(run(hideOp('delete', r2))).toBe('ok');
    expect(post(r2)).not.toHaveProperty('body');
    expect(post(q)).toMatchObject({ replyCount: 1, instructorReplyCount: 0 });
    expect(post(q).unanswered).toBe('c1');
    expect(violations()).toEqual([]);
  });

  it('reports once per person, caps at 20 and clears on dismiss', () => {
    const q = ask();
    const reportOp = (reporterId: string): DiscussionOperation => ({
      ...scope,
      type: 'report',
      reporterId,
      post: read(q),
      reporterIds: [...(post(q).reportedBy ?? [])],
      reportedSince: post(q).reportedSince,
      now: WHEN,
    });

    for (let i = 0; i < 20; i++) {
      expect(run(reportOp(`r${i}`))).toBe('ok');
    }
    expect(run(reportOp('r0'))).toBe('ok');
    expect(run(reportOp('r20'))).toBe('no-write');
    expect(post(q).reportedBy.size).toBe(20);
    expect(post(q).reported).toBe('c1');
    expect(violations()).toEqual([]);

    expect(
      run({ type: 'dismiss', courseId: 'c1', lessonId: 'l1', post: read(q) }),
    ).toBe('ok');
    expect(post(q).reported).toBeUndefined();
    expect(post(q).reportedBy).toBeUndefined();
    expect(violations()).toEqual([]);
  });
});
