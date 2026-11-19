/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type CoreTable,
  DiscussionInputError,
  type DiscussionNotificationPost,
  type DiscussionOperation,
  discussionNotificationWrites,
  discussionWrites,
  isShown,
  learnerName,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { transactionConflict } from '../lib/transaction.js';
import type { IDiscussionPost, ILessonRef } from '../schema/index.js';
import type { DiscussionAccess } from './discussion-access.js';

export type StoredPost = NonNullable<
  Awaited<
    ReturnType<ReturnType<CoreTable['entities']['discussionPost']['get']>['go']>
  >['data']
>;
export type Caller = { sub: string; groups: string[] };

const MAX_ATTEMPTS = 3;
export const CLOSED = 'Questions are closed for this lesson';

export const notFound = () => new TRPCError({ code: 'NOT_FOUND' });

// A question's postId is its threadId.
export const kindOf = (threadId: string, postId: string) =>
  postId === threadId ? ('question' as const) : ('reply' as const);

export const getPost = async (
  coreTable: CoreTable,
  { courseId, lessonId }: Pick<ILessonRef, 'courseId' | 'lessonId'>,
  kind: 'question' | 'reply',
  threadId: string,
  postId: string,
) =>
  (
    await coreTable.entities.discussionPost
      .get({ courseId, kind, lessonId, threadId, postId })
      .go()
  ).data;

export const getVote = async (
  coreTable: CoreTable,
  ref: ILessonRef,
  userId: string,
  threadId: string,
  postId: string,
) =>
  (
    await coreTable.entities.discussionVote
      .get({
        courseId: ref.courseId,
        userId,
        lessonId: ref.lessonId,
        threadId,
        postId,
      })
      .go()
  ).data;

export const asNotificationPost = (
  post: StoredPost,
): DiscussionNotificationPost => ({
  courseId: post.courseId,
  lessonId: post.lessonId,
  threadId: post.threadId,
  postId: post.postId,
  authorId: post.authorId,
  authorName: post.authorName,
  body: post.body,
  state: post.state,
  createdAt: post.createdAt,
});

export const placeholder = (
  post: Pick<StoredPost, 'postId' | 'threadId' | 'kind' | 'state'>,
): IDiscussionPost => ({
  postId: post.postId,
  threadId: post.threadId,
  kind: post.kind,
  state: post.state,
});

// A post as the caller may see it. Built key by key: a student gets only the
// ids and state of a hidden or deleted post, and `reportedBy` never leaves.
export const toPost = (
  post: StoredPost,
  viewer: { userId: string; isInstructor: boolean },
  upvotedByMe: boolean,
): IDiscussionPost => {
  if (post.state !== 'shown' && !viewer.isInstructor) {
    return placeholder(post);
  }
  return {
    ...placeholder(post),
    authorName: post.authorName,
    authorIsInstructor: post.authorIsInstructor,
    ...(post.title !== undefined && { title: post.title }),
    ...(post.body !== undefined && { body: post.body }),
    createdAt: post.createdAt,
    voteCount: post.voteCount ?? 0,
    ...(post.kind === 'question' && {
      replyCount: post.replyCount ?? 0,
      accepted: post.acceptedPostId !== undefined,
      answered:
        post.acceptedPostId !== undefined ||
        (post.instructorReplyCount ?? 0) > 0,
    }),
    upvotedByMe,
    mine: post.authorId === viewer.userId,
    ...(viewer.isInstructor && {
      reportCount: [...(post.reportedBy ?? [])].length,
    }),
  };
};

export const viewerOf = (user: Caller, access: DiscussionAccess) => ({
  userId: user.sub,
  isInstructor: access.isInstructor,
});

// A cursor is ElectroDB's last key as base64url JSON, so one for another
// course is refused before it reaches the table.
export const checkCursor = (courseId: string, cursor: string | undefined) => {
  if (cursor === undefined) {
    return;
  }
  try {
    const { pk } = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { pk?: unknown };
    if (typeof pk === 'string' && pk.includes(courseId)) {
      return;
    }
  } catch {
    // falls through
  }
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid cursor' });
};

// Writes need the course published and the module and lesson shown; an
// instructor can reach a lesson that is neither.
export const assertOpen = ({ course, module, lesson }: DiscussionAccess) => {
  if (course.status !== 'published' || !isShown(module) || !isShown(lesson)) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: CLOSED });
  }
};

export interface Step<T> {
  /** What to write, or nothing when the answer is already true. */
  op?: DiscussionOperation;
  /** The result, read after the write (transactions return nothing). */
  result: () => Promise<T>;
  /** Notification items for the same transaction (at most two). */
  notify?: () => ReturnType<typeof discussionNotificationWrites>;
}

// Reads, decides and writes. A cancelled transaction is run again from the
// reads, so the error is decided on fresh state, up to three times, then
// CONFLICT.
export const writeWithRetry = async <T>(
  coreTable: CoreTable,
  step: () => Promise<Step<T>>,
): Promise<T> => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { op, result, notify } = await step();
    if (!op) {
      return result();
    }
    // Built fresh on every attempt: they pin the user's notification state.
    // A cancellation from a notification that already exists (a retry)
    // runs the step again, which finds the post or answer already written.
    const notifications = (await notify?.()) ?? [];
    let canceled: boolean;
    try {
      ({ canceled } = await coreTable.transaction
        .write((entities) => {
          const items = discussionWrites(entities, op);
          return items ? [...items, ...notifications] : [];
        })
        .go());
    } catch (error) {
      if (error instanceof DiscussionInputError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }
    if (!canceled) {
      return result();
    }
  }
  throw transactionConflict();
};

// The caller's own record, for the name a new post carries.
export const authorOf = async (
  coreTable: CoreTable,
  user: Caller,
  access: DiscussionAccess,
) => {
  const { data } = await coreTable.entities.user.get({ userId: user.sub }).go();
  return {
    userId: user.sub,
    name: learnerName(data),
    isInstructor: access.isInstructor,
  };
};

export const readOne = async (
  coreTable: CoreTable,
  ref: ILessonRef,
  user: Caller,
  access: DiscussionAccess,
  post: StoredPost,
) => {
  const vote = await getVote(
    coreTable,
    ref,
    user.sub,
    post.threadId,
    post.postId,
  );
  return toPost(post, viewerOf(user, access), vote !== null);
};

export const requireStored = <T>(post: T | null | undefined): T => {
  if (!post) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The post was not found after it was written',
    });
  }
  return post;
};

// A student cannot tell a post that is gone from one that is hidden.
export const shownPost = (post: StoredPost | null | undefined) => {
  if (!post || post.state !== 'shown') {
    throw notFound();
  }
  return post;
};

export const idTaken = () =>
  new TRPCError({ code: 'CONFLICT', message: 'That post id is already used' });
