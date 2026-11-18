/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type createCoreTableService,
  DISCUSSION_MAX_REPORTERS,
  DISCUSSION_MAX_VISIBLE_REPLIES,
  DiscussionInputError,
  type DiscussionOperation,
  discussionWrites,
  isShown,
  learnerName,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import {
  type DiscussionAccess,
  requireDiscussionAccess,
} from '../helpers/discussion-access.js';
import { courseProcedure } from '../init.js';
import { transactionConflict } from '../lib/transaction.js';
import {
  AcceptInputSchema,
  AskInputSchema,
  DiscussionPostSchema,
  type IDiscussionPost,
  type ILessonRef,
  ListQuestionsInputSchema,
  ListQuestionsOutputSchema,
  RemoveOwnInputSchema,
  ReplyInputSchema,
  ReportInputSchema,
  ReportOutputSchema,
  ThreadInputSchema,
  ThreadOutputSchema,
  VoteInputSchema,
  VoteOutputSchema,
} from '../schema/index.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type StoredPost = NonNullable<
  Awaited<
    ReturnType<ReturnType<CoreTable['entities']['discussionPost']['get']>['go']>
  >['data']
>;
type Caller = { sub: string; groups: string[] };

const QUESTIONS_PAGE = 20;
const REPLIES_PAGE = 50;
const MAX_ATTEMPTS = 3;
const CLOSED = 'Questions are closed for this lesson';

const notFound = () => new TRPCError({ code: 'NOT_FOUND' });

// A question's postId is its threadId.
const kindOf = (threadId: string, postId: string) =>
  postId === threadId ? ('question' as const) : ('reply' as const);

const getPost = async (
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

const getVote = async (
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

const placeholder = (
  post: Pick<StoredPost, 'postId' | 'threadId' | 'kind' | 'state'>,
): IDiscussionPost => ({
  postId: post.postId,
  threadId: post.threadId,
  kind: post.kind,
  state: post.state,
});

// A post as the caller may see it. Built key by key: a student gets only the
// ids and state of a hidden or deleted post, and `reportedBy` never leaves.
const toPost = (
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

const viewerOf = (user: Caller, access: DiscussionAccess) => ({
  userId: user.sub,
  isInstructor: access.isInstructor,
});

const toQuestionRead = (question: StoredPost) => ({
  threadId: question.threadId,
  state: question.state,
  acceptedPostId: question.acceptedPostId,
  replyCount: question.replyCount,
  instructorReplyCount: question.instructorReplyCount,
  createdAt: question.createdAt,
});

const toPostRead = (post: StoredPost) => ({
  kind: post.kind,
  threadId: post.threadId,
  postId: post.postId,
  authorId: post.authorId,
  authorIsInstructor: post.authorIsInstructor,
  state: post.state,
});

// A cursor is ElectroDB's last key as base64url JSON, so one for another
// course is refused before it reaches the table.
const checkCursor = (courseId: string, cursor: string | undefined) => {
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
const assertOpen = ({ course, module, lesson }: DiscussionAccess) => {
  if (course.status !== 'published' || !isShown(module) || !isShown(lesson)) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: CLOSED });
  }
};

interface Step<T> {
  /** What to write, or nothing when the answer is already true. */
  op?: DiscussionOperation;
  /** The result, read after the write (transactions return nothing). */
  result: () => Promise<T>;
}

// Reads, decides and writes. A cancelled transaction is run again from the
// reads, so the error is decided on fresh state, up to three times, then
// CONFLICT.
const writeWithRetry = async <T>(
  coreTable: CoreTable,
  step: () => Promise<Step<T>>,
): Promise<T> => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { op, result } = await step();
    if (!op) {
      return result();
    }
    let canceled: boolean;
    try {
      ({ canceled } = await coreTable.transaction
        .write((entities) => discussionWrites(entities, op) ?? [])
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
const authorOf = async (
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

const readOne = async (
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

const requireStored = <T>(post: T | null | undefined): T => {
  if (!post) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The post was not found after it was written',
    });
  }
  return post;
};

// A student cannot tell a post that is gone from one that is hidden.
const shownPost = (post: StoredPost | null | undefined) => {
  if (!post || post.state !== 'shown') {
    throw notFound();
  }
  return post;
};

const idTaken = () =>
  new TRPCError({ code: 'CONFLICT', message: 'That post id is already used' });

export const listQuestions = courseProcedure
  .input(ListQuestionsInputSchema)
  .output(ListQuestionsOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { cursor, ...ref } = input;
    const access = await requireDiscussionAccess(coreTable, ctx.user, ref);
    checkCursor(ref.courseId, cursor);

    const { data, cursor: next } = await coreTable.entities.discussionPost.query
      .primary({
        courseId: ref.courseId,
        kind: 'question',
        lessonId: ref.lessonId,
      })
      .go({ order: 'desc', limit: QUESTIONS_PAGE, cursor });

    // One batch of keyed gets for the page's questions.
    const upvoted = new Set<string>();
    if (data.length > 0) {
      const { data: votes } = await coreTable.entities.discussionVote
        .get(
          data.map((question) => ({
            courseId: ref.courseId,
            userId: ctx.user.sub,
            lessonId: ref.lessonId,
            threadId: question.threadId,
            postId: question.postId,
          })),
        )
        .go();
      for (const vote of votes) {
        upvoted.add(vote.postId);
      }
    }

    const viewer = viewerOf(ctx.user, access);
    return {
      items: data.map((question) =>
        toPost(question, viewer, upvoted.has(question.postId)),
      ),
      ...(next && { cursor: next }),
    };
  });

export const thread = courseProcedure
  .input(ThreadInputSchema)
  .output(ThreadOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { cursor, threadId, ...ref } = input;
    const access = await requireDiscussionAccess(coreTable, ctx.user, ref);
    checkCursor(ref.courseId, cursor);

    const question = await getPost(
      coreTable,
      ref,
      'question',
      threadId,
      threadId,
    );
    if (!question) {
      throw notFound();
    }
    const viewer = viewerOf(ctx.user, access);
    if (question.state !== 'shown' && !viewer.isInstructor) {
      return { question: placeholder(question), replies: [] };
    }

    const [{ data: replies, cursor: next }, { data: votes }, acceptedReply] =
      await Promise.all([
        coreTable.entities.discussionPost.query
          .primary({
            courseId: ref.courseId,
            kind: 'reply',
            lessonId: ref.lessonId,
            threadId,
          })
          .go({ order: 'asc', limit: REPLIES_PAGE, cursor }),
        coreTable.entities.discussionVote.query
          .primary({ courseId: ref.courseId, userId: ctx.user.sub })
          .begins({ lessonId: ref.lessonId, threadId })
          .go({ pages: 'all' }),
        question.acceptedPostId === undefined
          ? Promise.resolve(null)
          : getPost(coreTable, ref, 'reply', threadId, question.acceptedPostId),
      ]);
    const upvoted = new Set(votes.map((vote) => vote.postId));
    const view = (post: StoredPost) =>
      toPost(post, viewer, upvoted.has(post.postId));

    return {
      question: view(question),
      ...(acceptedReply && { accepted: view(acceptedReply) }),
      replies: replies
        .filter((reply) => reply.postId !== question.acceptedPostId)
        .map(view),
      ...(next && { cursor: next }),
    };
  });

export const ask = courseProcedure
  .input(AskInputSchema)
  .output(DiscussionPostSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { postId, title, body, ...ref } = input;
    const user = ctx.user;

    return writeWithRetry(coreTable, async () => {
      const access = await requireDiscussionAccess(coreTable, user, ref);
      const existing = await getPost(
        coreTable,
        ref,
        'question',
        postId,
        postId,
      );
      // A retry by the same author returns the question unchanged.
      if (existing) {
        if (existing.authorId !== user.sub) {
          throw idTaken();
        }
        return {
          result: () => readOne(coreTable, ref, user, access, existing),
        };
      }
      assertOpen(access);
      return {
        op: {
          type: 'ask',
          ...ref,
          postId,
          author: await authorOf(coreTable, user, access),
          title,
          body,
          now: new Date(),
        },
        result: async () =>
          readOne(
            coreTable,
            ref,
            user,
            access,
            requireStored(
              await getPost(coreTable, ref, 'question', postId, postId),
            ),
          ),
      };
    });
  });

export const reply = courseProcedure
  .input(ReplyInputSchema)
  .output(DiscussionPostSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { threadId, postId, body, ...ref } = input;
    const user = ctx.user;
    // The question's own id would make later calls take the reply for the
    // question (see kindOf).
    if (postId === threadId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: "postId must not be the question's id",
      });
    }

    return writeWithRetry(coreTable, async () => {
      const access = await requireDiscussionAccess(coreTable, user, ref);
      const existing = await getPost(coreTable, ref, 'reply', threadId, postId);
      if (existing) {
        if (existing.authorId !== user.sub) {
          throw idTaken();
        }
        return {
          result: () => readOne(coreTable, ref, user, access, existing),
        };
      }
      assertOpen(access);
      const question = shownPost(
        await getPost(coreTable, ref, 'question', threadId, threadId),
      );
      if ((question.replyCount ?? 0) >= DISCUSSION_MAX_VISIBLE_REPLIES) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This question has reached its reply limit',
        });
      }
      return {
        op: {
          type: 'reply',
          ...ref,
          threadId,
          postId,
          author: await authorOf(coreTable, user, access),
          body,
          now: new Date(),
        },
        result: async () =>
          readOne(
            coreTable,
            ref,
            user,
            access,
            requireStored(
              await getPost(coreTable, ref, 'reply', threadId, postId),
            ),
          ),
      };
    });
  });

export const vote = courseProcedure
  .input(VoteInputSchema)
  .output(VoteOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { threadId, postId, voted, ...ref } = input;
    const user = ctx.user;
    const kind = kindOf(threadId, postId);

    return writeWithRetry(coreTable, async () => {
      const access = await requireDiscussionAccess(coreTable, user, ref);
      assertOpen(access);
      const post = await getPost(coreTable, ref, kind, threadId, postId);
      // Taking back a vote on a post hidden since is allowed.
      if (
        !post ||
        post.state === 'deleted' ||
        (voted && post.state !== 'shown')
      ) {
        throw notFound();
      }
      if (post.authorId === user.sub) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You cannot vote on your own post',
        });
      }
      const existing = await getVote(
        coreTable,
        ref,
        user.sub,
        threadId,
        postId,
      );
      const result = async () => {
        const [fresh, mine] = await Promise.all([
          getPost(coreTable, ref, kind, threadId, postId),
          getVote(coreTable, ref, user.sub, threadId, postId),
        ]);
        return {
          voteCount: fresh?.voteCount ?? 0,
          upvotedByMe: mine !== null,
        };
      };
      // Already in the state asked for.
      if ((existing !== null) === voted) {
        return { result };
      }
      return {
        op: {
          type: voted ? 'vote' : 'unvote',
          ...ref,
          userId: user.sub,
          post: toPostRead(post),
        },
        result,
      };
    });
  });

export const accept = courseProcedure
  .input(AcceptInputSchema)
  .output(DiscussionPostSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { threadId, postId, ...ref } = input;
    const user = ctx.user;

    return writeWithRetry(coreTable, async () => {
      const access = await requireDiscussionAccess(coreTable, user, ref);
      const question = shownPost(
        await getPost(coreTable, ref, 'question', threadId, threadId),
      );
      if (question.authorId !== user.sub && !access.isInstructor) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the asker or an instructor can mark an answer',
        });
      }
      assertOpen(access);
      const result = async () =>
        readOne(
          coreTable,
          ref,
          user,
          access,
          requireStored(
            await getPost(coreTable, ref, 'question', threadId, threadId),
          ),
        );
      const scope = { ...ref, question: toQuestionRead(question) };
      if (postId === null) {
        return { op: { type: 'unaccept', ...scope }, result };
      }
      shownPost(await getPost(coreTable, ref, 'reply', threadId, postId));
      // Accepting the accepted reply again writes nothing.
      return {
        op:
          question.acceptedPostId === postId
            ? undefined
            : ({ type: 'accept', ...scope, replyId: postId } as const),
        result,
      };
    });
  });

export const report = courseProcedure
  .input(ReportInputSchema)
  .output(ReportOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { threadId, postId, ...ref } = input;
    const user = ctx.user;

    return writeWithRetry(coreTable, async () => {
      const access = await requireDiscussionAccess(coreTable, user, ref);
      assertOpen(access);
      const post = shownPost(
        await getPost(
          coreTable,
          ref,
          kindOf(threadId, postId),
          threadId,
          postId,
        ),
      );
      if (post.authorId === user.sub) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You cannot report your own post',
        });
      }
      const result = async () => ({ reported: true as const });
      const reporterIds = [...(post.reportedBy ?? [])];
      // Reported by the caller already, or past the 20th reporter: success
      // with no change.
      if (
        reporterIds.includes(user.sub) ||
        reporterIds.length >= DISCUSSION_MAX_REPORTERS
      ) {
        return { result };
      }
      return {
        op: {
          type: 'report',
          ...ref,
          reporterId: user.sub,
          post: toPostRead(post),
          reporterIds,
          reportedSince: post.reportedSince,
          now: new Date(),
        },
        result,
      };
    });
  });

export const removeOwn = courseProcedure
  .input(RemoveOwnInputSchema)
  .output(DiscussionPostSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { threadId, postId, ...ref } = input;
    const user = ctx.user;
    const kind = kindOf(threadId, postId);

    return writeWithRetry(coreTable, async () => {
      // Needs access to the course, not a published one or a shown lesson.
      await requireDiscussionAccess(coreTable, user, ref, {
        lessonMustBeShown: false,
      });
      const post = await getPost(coreTable, ref, kind, threadId, postId);
      if (!post) {
        throw notFound();
      }
      if (post.authorId !== user.sub) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own posts',
        });
      }
      const result = async () => placeholder({ ...post, state: 'deleted' });
      if (post.state === 'deleted') {
        return { result };
      }
      const question =
        kind === 'reply'
          ? await getPost(coreTable, ref, 'question', threadId, threadId)
          : post;
      if (!question) {
        throw notFound();
      }
      return {
        op: {
          type: 'delete',
          courseId: ref.courseId,
          lessonId: ref.lessonId,
          post: toPostRead(post),
          question: toQuestionRead(question),
        },
        result,
      };
    });
  });
