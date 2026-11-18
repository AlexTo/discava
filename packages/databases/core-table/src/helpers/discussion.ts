/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { uuidV7Time } from './announcement.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];

// The pure rules of a lesson's discussion (data-model.md "Rules"): limits,
// text and id checks, and whether a question counts as unanswered. Nothing
// here reads or writes the table; the write helper and the invariants both
// call these, so they cannot disagree.

export const DISCUSSION_TITLE_MAX = 120;
export const DISCUSSION_BODY_MAX = 4000;
export const DISCUSSION_MAX_VISIBLE_REPLIES = 500;
export const DISCUSSION_MAX_REPORTERS = 20;
export const DISCUSSION_POST_ID_WINDOW_MS = 600_000;

export type DiscussionTextProblem = 'empty' | 'too-long';

export type NormalisedDiscussionText =
  | { text: string; reason?: undefined }
  | { text?: undefined; reason: DiscussionTextProblem };

/**
 * The text trimmed, or why it can't be used. Length is counted in characters
 * as written (an emoji or an accented letter is one), not in UTF-16 units.
 */
export const normaliseDiscussionText = (
  text: string,
  { min, max }: { min: number; max: number },
): NormalisedDiscussionText => {
  const trimmed = text.trim();
  const length = [...trimmed].length;
  if (length < min) {
    return { reason: 'empty' };
  }
  if (length > max) {
    return { reason: 'too-long' };
  }
  return { text: trimmed };
};

/** Milliseconds since the epoch in a UUID v7's time part, else undefined. */
export const postIdTime = (id: string): number | undefined => {
  const time = uuidV7Time(id);
  return time === undefined ? undefined : new Date(time).getTime();
};

export type PostIdProblem = 'not-uuid-v7' | 'outside-window';

export type PostIdCheck =
  | { time: string; reason?: undefined }
  | { time?: undefined; reason: PostIdProblem };

/**
 * Whether `id` is a UUID v7 minted within 10 minutes of `now` (either side),
 * with its ISO time (the post's createdAt) when it is.
 */
export const checkPostId = (id: string, now: Date): PostIdCheck => {
  const time = postIdTime(id);
  if (time === undefined) {
    return { reason: 'not-uuid-v7' };
  }
  if (Math.abs(time - now.getTime()) > DISCUSSION_POST_ID_WINDOW_MS) {
    return { reason: 'outside-window' };
  }
  return { time: new Date(time).toISOString() };
};

export type AnsweredState = 'unanswered' | 'answered' | 'not-open';

/**
 * Whether a question is waiting for an answer: only a shown question with no
 * accepted answer and no instructor reply is `unanswered`. A hidden or deleted
 * one is `not-open`.
 */
export const answeredState = ({
  state,
  acceptedPostId,
  instructorReplyCount,
}: {
  state: 'shown' | 'hidden' | 'deleted';
  acceptedPostId?: string;
  instructorReplyCount?: number;
}): AnsweredState => {
  if (state !== 'shown') {
    return 'not-open';
  }
  return acceptedPostId === undefined && (instructorReplyCount ?? 0) === 0
    ? 'unanswered'
    : 'answered';
};

// The input names something a discussion can't have or do: callers map it to a
// BAD_REQUEST (or CONFLICT, as the operation says).
export class DiscussionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscussionInputError';
  }
}

type PostState = 'shown' | 'hidden' | 'deleted';

export interface DiscussionAuthor {
  userId: string;
  /** `learnerName(user)`, never the email. */
  name: string;
  isInstructor: boolean;
}

interface Scope {
  courseId: string;
  moduleId: string;
  lessonId: string;
}

/** A post as the caller read it, which the operation's conditions pin. */
export interface DiscussionPostRead {
  kind: 'question' | 'reply';
  threadId: string;
  postId: string;
  authorId?: string;
  authorIsInstructor?: boolean;
  state: PostState;
}

/** A question as the caller read it. */
export interface DiscussionQuestionRead {
  threadId: string;
  state: PostState;
  acceptedPostId?: string;
  replyCount?: number;
  instructorReplyCount?: number;
  /** The question's createdAt, which orders the unanswered queue. */
  createdAt: string;
}

interface ModerateInput<T extends string> {
  type: T;
  post: DiscussionPostRead;
  /** The post's question as read: needed for a reply, and to unhide a question. */
  question?: DiscussionQuestionRead;
}

export type DiscussionOperation =
  | (Scope & {
      type: 'ask';
      postId: string;
      author: DiscussionAuthor;
      title: string;
      body: string;
      now: Date;
    })
  | (Scope & {
      type: 'reply';
      threadId: string;
      postId: string;
      author: DiscussionAuthor;
      body: string;
      now: Date;
    })
  | (Scope & { type: 'vote'; userId: string; post: DiscussionPostRead })
  | (Scope & { type: 'unvote'; userId: string; post: DiscussionPostRead })
  | (Scope & {
      type: 'accept';
      question: DiscussionQuestionRead;
      replyId: string;
    })
  | (Scope & { type: 'unaccept'; question: DiscussionQuestionRead })
  | (Pick<Scope, 'courseId' | 'lessonId'> & ModerateInput<'hide'>)
  | (Pick<Scope, 'courseId' | 'lessonId'> & ModerateInput<'unhide'>)
  | (Pick<Scope, 'courseId' | 'lessonId'> & ModerateInput<'delete'>)
  | (Scope & {
      type: 'report';
      reporterId: string;
      post: DiscussionPostRead;
      /** The post's reporters and `reportedSince`, as read. */
      reporterIds?: string[];
      reportedSince?: string;
      now: Date;
    })
  | (Pick<Scope, 'courseId' | 'lessonId'> & {
      type: 'dismiss';
      post: DiscussionPostRead;
    });

type Items = ReturnType<TransactionWrites>;

/**
 * The items of one discussion write's transaction, or `undefined` when there
 * is nothing to write (the post is already in the state asked for, or a
 * report beyond the 20th): the caller succeeds without a transaction. Throws
 * DiscussionInputError for input that can never work, before any item is
 * built. The caller adds notification items and runs it; a cancelled
 * transaction is re-read and retried.
 */
export const discussionWrites = (
  entities: TransactionEntities,
  op: DiscussionOperation,
): Items | undefined => {
  switch (op.type) {
    case 'ask':
      return ask(entities, op);
    case 'reply':
      return reply(entities, op);
    case 'vote':
      return vote(entities, op);
    case 'unvote':
      return unvote(entities, op);
    case 'accept':
      return accept(entities, op);
    case 'unaccept':
      return unaccept(entities, op);
    case 'hide':
    case 'unhide':
    case 'delete':
      return moderate(entities, op);
    case 'report':
      return report(entities, op);
    case 'dismiss':
      return dismiss(entities, op);
  }
};

// The same first three items as studentActivityWrites: the course is
// published and the module and lesson are visible and not archived.
const checks = (
  { course, module, lesson }: TransactionEntities,
  { courseId, moduleId, lessonId }: Scope,
): Items => [
  course
    .check({ courseId })
    .where((attr, op) => op.eq(attr.status, 'published'))
    .commit(),
  module
    .check({ courseId, moduleId })
    .where(
      (attr, op) =>
        `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
    )
    .commit(),
  lesson
    .check({ courseId, moduleId, lessonId })
    .where(
      (attr, op) =>
        `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
    )
    .commit(),
];

const postKey = (
  { courseId, lessonId }: Pick<Scope, 'courseId' | 'lessonId'>,
  {
    kind,
    threadId,
    postId,
  }: Pick<DiscussionPostRead, 'kind' | 'threadId' | 'postId'>,
) => ({ courseId, kind, lessonId, threadId, postId });

const questionKey = (
  { courseId, lessonId }: Pick<Scope, 'courseId' | 'lessonId'>,
  threadId: string,
) =>
  postKey(
    { courseId, lessonId },
    { kind: 'question', threadId, postId: threadId },
  );

const UNANSWERED = ['unanswered', 'unansweredSince'] as const;
const REPORTED = ['reported', 'reportedSince'] as const;

const textOf = (
  text: string,
  name: string,
  limits: { min: number; max: number },
) => {
  const { text: normalised, reason } = normaliseDiscussionText(text, limits);
  if (reason === 'empty') {
    throw new DiscussionInputError(`${name} must not be empty`);
  }
  if (reason === 'too-long') {
    throw new DiscussionInputError(
      `${name} must be at most ${limits.max} characters`,
    );
  }
  return normalised as string;
};

const newPost = (
  scope: Scope,
  {
    postId,
    author,
    body,
    now,
  }: {
    postId: string;
    author: DiscussionAuthor;
    body: string;
    now: Date;
  },
) => {
  const id = checkPostId(postId, now);
  if (id.reason === 'not-uuid-v7') {
    throw new DiscussionInputError('postId must be a UUID v7');
  }
  if (id.reason === 'outside-window') {
    throw new DiscussionInputError(
      'postId must have been created within the last 10 minutes',
    );
  }
  return {
    courseId: scope.courseId,
    moduleId: scope.moduleId,
    lessonId: scope.lessonId,
    postId,
    authorId: author.userId,
    authorName: author.name,
    authorIsInstructor: author.isInstructor,
    body: textOf(body, 'body', { min: 1, max: DISCUSSION_BODY_MAX }),
    createdAt: id.time as string,
  };
};

const ask = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'ask' }>,
): Items => {
  const title = textOf(op.title, 'title', {
    min: 1,
    max: DISCUSSION_TITLE_MAX,
  });
  const post = newPost(op, op);
  return [
    ...checks(entities, op),
    entities.discussionPost
      .create({
        ...post,
        kind: 'question',
        threadId: op.postId,
        title,
        // A new question has no answer: it joins the unanswered queue.
        unanswered: op.courseId,
        unansweredSince: post.createdAt,
      })
      .commit(),
  ];
};

const reply = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'reply' }>,
): Items => {
  const post = newPost(op, op);
  const instructor = op.author.isInstructor;
  const patch = entities.discussionPost
    .patch(questionKey(op, op.threadId))
    .add({
      replyCount: 1,
      ...(instructor ? { instructorReplyCount: 1 } : {}),
    });
  return [
    ...checks(entities, op),
    (instructor ? patch.remove([...UNANSWERED]) : patch)
      .where(
        (attr, o) =>
          `${o.eq(attr.state, 'shown')} AND ${o.lt(attr.replyCount, DISCUSSION_MAX_VISIBLE_REPLIES)}`,
      )
      .commit(),
    entities.discussionPost
      .create({ ...post, kind: 'reply', threadId: op.threadId })
      .commit(),
  ];
};

const vote = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'vote' }>,
): Items => {
  const { post, userId } = op;
  if (post.authorId === userId) {
    throw new DiscussionInputError('You cannot vote on your own post');
  }
  return [
    ...checks(entities, op),
    entities.discussionVote
      .create({
        courseId: op.courseId,
        userId,
        lessonId: op.lessonId,
        threadId: post.threadId,
        postId: post.postId,
      })
      .commit(),
    entities.discussionPost
      .patch(postKey(op, post))
      .add({ voteCount: 1 })
      .where(
        (attr, o) =>
          `${o.eq(attr.state, 'shown')} AND ${o.ne(attr.authorId, userId)}`,
      )
      .commit(),
  ];
};

// A vote on a post hidden later can still be removed, so the post's state is
// not checked.
const unvote = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'unvote' }>,
): Items => [
  ...checks(entities, op),
  entities.discussionVote
    .delete({
      courseId: op.courseId,
      userId: op.userId,
      lessonId: op.lessonId,
      threadId: op.post.threadId,
      postId: op.post.postId,
    })
    .where((attr, o) => o.exists(attr.userId))
    .commit(),
  entities.discussionPost
    .patch(postKey(op, op.post))
    .subtract({ voteCount: 1 })
    .commit(),
];

// The condition that a question's acceptedPostId is still what was read.
const acceptedIs =
  (acceptedPostId: string | undefined) =>
  (
    attr: { acceptedPostId: never },
    o: {
      eq: (a: never, v: string) => string;
      notExists: (a: never) => string;
    },
  ) =>
    acceptedPostId === undefined
      ? o.notExists(attr.acceptedPostId)
      : o.eq(attr.acceptedPostId, acceptedPostId);

/**
 * What a question's unanswered flag must become when its answer and instructor
 * replies change from `question` to `next`: nothing to do, the pair to set,
 * or the pair to remove.
 */
const unansweredChange = (
  question: DiscussionQuestionRead,
  next: {
    state?: PostState;
    acceptedPostId?: string;
    instructorReplyCount: number;
  },
) => {
  const was = answeredState(question);
  const will = answeredState({
    state: next.state ?? question.state,
    acceptedPostId: next.acceptedPostId,
    instructorReplyCount: next.instructorReplyCount,
  });
  if (was === will || (was !== 'unanswered' && will !== 'unanswered')) {
    return 'keep' as const;
  }
  return will === 'unanswered' ? ('set' as const) : ('remove' as const);
};

const accept = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'accept' }>,
): Items | undefined => {
  const { question, replyId } = op;
  if (question.acceptedPostId === replyId) {
    return undefined;
  }
  return [
    ...checks(entities, op),
    // A shown reply of this question (its key holds the threadId).
    entities.discussionPost
      .check(
        postKey(op, {
          kind: 'reply',
          threadId: question.threadId,
          postId: replyId,
        }),
      )
      .where((attr, o) => o.eq(attr.state, 'shown'))
      .commit(),
    entities.discussionPost
      .patch(questionKey(op, question.threadId))
      .set({ acceptedPostId: replyId })
      .remove([...UNANSWERED])
      .where(
        (attr, o) =>
          `${o.eq(attr.state, 'shown')} AND ${acceptedIs(question.acceptedPostId)(attr as never, o as never)}`,
      )
      .commit(),
  ];
};

const unaccept = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'unaccept' }>,
): Items | undefined => {
  const { question } = op;
  if (question.acceptedPostId === undefined) {
    return undefined;
  }
  const instructorReplyCount = question.instructorReplyCount ?? 0;
  const restore =
    unansweredChange(question, {
      acceptedPostId: undefined,
      instructorReplyCount,
    }) === 'set';
  const patch = entities.discussionPost
    .patch(questionKey(op, question.threadId))
    .remove(['acceptedPostId']);
  return [
    ...checks(entities, op),
    (restore
      ? entities.discussionPost
          .patch(questionKey(op, question.threadId))
          .set({ unanswered: op.courseId, unansweredSince: question.createdAt })
          .remove(['acceptedPostId'])
      : patch
    )
      .where(
        (attr, o) =>
          `${o.eq(attr.state, question.state)} AND ${acceptedIs(question.acceptedPostId)(attr as never, o as never)} AND ${o.eq(attr.instructorReplyCount, instructorReplyCount)}`,
      )
      .commit(),
  ];
};

const TEXT_ATTRIBUTES = ['title', 'body', 'reportedBy', ...REPORTED] as const;

const moderate = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'hide' | 'unhide' | 'delete' }>,
): Items | undefined => {
  const { post, type } = op;
  const target: PostState =
    type === 'hide' ? 'hidden' : type === 'unhide' ? 'shown' : 'deleted';
  if (post.state === target) {
    return undefined;
  }
  if (post.state === 'deleted') {
    throw new DiscussionInputError('A deleted post cannot be changed');
  }
  const key = postKey(op, post);
  const isReply = post.kind === 'reply';
  const leavesShown = post.state === 'shown';
  const { question } = op;
  if (isReply && !question) {
    throw new DiscussionInputError('A reply needs its question');
  }
  if (
    isReply &&
    target === 'shown' &&
    (question?.replyCount ?? 0) >= DISCUSSION_MAX_VISIBLE_REPLIES
  ) {
    throw new DiscussionInputError('This question already has 500 replies');
  }

  let patch = entities.discussionPost.patch(key).set({ state: target });
  let where = (attr: any, o: any) => o.eq(attr.state, post.state) as string;
  if (type === 'delete') {
    patch = patch.remove([
      ...TEXT_ATTRIBUTES,
      ...(isReply ? [] : ['acceptedPostId', ...UNANSWERED]),
    ] as never);
  } else if (!isReply && type === 'hide') {
    patch = patch.remove([...UNANSWERED]);
  } else if (!isReply && question) {
    // Unhide: the question is as it was, queued again if still unanswered.
    const instructorReplyCount = question.instructorReplyCount ?? 0;
    if (answeredState({ ...question, state: 'shown' }) === 'unanswered') {
      patch = patch.set({
        unanswered: op.courseId,
        unansweredSince: question.createdAt,
      });
    }
    where = (attr, o) =>
      `${o.eq(attr.state, post.state)} AND ${acceptedIs(question.acceptedPostId)(attr, o)} AND ${o.eq(attr.instructorReplyCount, instructorReplyCount)}`;
  } else if (!isReply) {
    throw new DiscussionInputError('Unhiding a question needs its record');
  }

  return [
    patch.where(where).commit(),
    ...(isReply && question && (leavesShown || target === 'shown')
      ? [replyCounts(entities, op, question, target === 'shown')]
      : []),
  ];
};

const replyCounts = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'hide' | 'unhide' | 'delete' }>,
  question: DiscussionQuestionRead,
  adding: boolean,
) => {
  const instructor = op.post.authorIsInstructor === true;
  const before = question.instructorReplyCount ?? 0;
  const after = before + (instructor ? (adding ? 1 : -1) : 0);
  const loses = !adding && question.acceptedPostId === op.post.postId;
  const acceptedPostId = loses ? undefined : question.acceptedPostId;
  const change = unansweredChange(question, {
    acceptedPostId,
    instructorReplyCount: after,
  });
  const counts = instructor
    ? { replyCount: 1, instructorReplyCount: 1 }
    : { replyCount: 1 };
  const base = entities.discussionPost.patch(
    questionKey(op, question.threadId),
  );
  const moved = adding ? base.add(counts) : base.subtract(counts);
  // The builder's type changes with each call; these are the optional steps.
  const withAccepted = (
    loses ? moved.remove(['acceptedPostId']) : moved
  ) as typeof moved;
  const withFlag = (
    change === 'set'
      ? withAccepted.set({
          unanswered: op.courseId,
          unansweredSince: question.createdAt,
        })
      : change === 'remove'
        ? withAccepted.remove([...UNANSWERED])
        : withAccepted
  ) as typeof moved;
  return withFlag
    .where(
      (attr, o) =>
        `${o.eq(attr.state, question.state)} AND ${acceptedIs(question.acceptedPostId)(attr as never, o as never)} AND ${o.eq(attr.instructorReplyCount, before)}${
          adding
            ? ` AND ${o.lt(attr.replyCount, DISCUSSION_MAX_VISIBLE_REPLIES)}`
            : ''
        }`,
    )
    .commit();
};

const report = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'report' }>,
): Items | undefined => {
  const { post, reporterId } = op;
  if (post.authorId === reporterId) {
    throw new DiscussionInputError('You cannot report your own post');
  }
  const ids = op.reporterIds ?? [];
  const present = ids.includes(reporterId);
  if (!present && ids.length >= DISCUSSION_MAX_REPORTERS) {
    return undefined;
  }
  return [
    ...checks(entities, op),
    entities.discussionPost
      .patch(postKey(op, post))
      .add({ reportedBy: [reporterId] })
      .set({
        reported: op.courseId,
        // Kept from the first report.
        reportedSince: op.reportedSince ?? op.now.toISOString(),
      })
      .where(
        (attr, o) =>
          `${o.eq(attr.state, 'shown')} AND ${o.ne(attr.authorId, reporterId)} AND (${o.notExists(attr.reportedBy)} OR ${o.contains(attr.reportedBy, reporterId)} OR size(${o.name(attr.reportedBy)}) < ${o.value(attr.voteCount, DISCUSSION_MAX_REPORTERS)})`,
      )
      .commit(),
  ];
};

const dismiss = (
  entities: TransactionEntities,
  op: Extract<DiscussionOperation, { type: 'dismiss' }>,
): Items => [
  entities.discussionPost
    .patch(postKey(op, op.post))
    .remove(['reportedBy', ...REPORTED])
    .where((attr, o) => o.exists(attr.reported))
    .commit(),
];

/** Whether any question has been asked on the lesson. */
export const lessonHasDiscussion = async (
  service: CoreTable,
  { courseId, lessonId }: { courseId: string; lessonId: string },
): Promise<boolean> => {
  const { data } = await service.entities.discussionPost.query
    .primary({ courseId, kind: 'question', lessonId })
    .go({ limit: 1 });
  return data.length > 0;
};
