/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  checkPostId,
  DISCUSSION_MAX_REPORTERS,
  DISCUSSION_MAX_VISIBLE_REPLIES,
  discussionNotificationWrites,
  toPostRead,
  toQuestionRead,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import {
  asNotificationPost,
  assertOpen,
  authorOf,
  checkCursor,
  getPost,
  getVote,
  idTaken,
  kindOf,
  notFound,
  placeholder,
  readOne,
  requireStored,
  type StoredPost,
  shownPost,
  toPost,
  viewerOf,
  writeWithRetry,
} from '../helpers/discussion.js';
import { requireDiscussionAccess } from '../helpers/discussion-access.js';
import { courseProcedure } from '../init.js';
import {
  AcceptInputSchema,
  AskInputSchema,
  DiscussionPostSchema,
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

const QUESTIONS_PAGE = 20;
const REPLIES_PAGE = 50;

export const listQuestions = courseProcedure
  .input(ListQuestionsInputSchema)
  .output(ListQuestionsOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
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
    const coreTable = ctx.coreTable;
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
    const coreTable = ctx.coreTable;
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
    const coreTable = ctx.coreTable;
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
      const author = await authorOf(coreTable, user, access);
      const now = new Date();
      return {
        op: {
          type: 'reply',
          ...ref,
          threadId,
          postId,
          author,
          body,
          now,
        },
        // An unusable postId is refused by discussionWrites, before any use.
        notify: async () => {
          const createdAt = checkPostId(postId, now).time;
          return createdAt === undefined
            ? []
            : discussionNotificationWrites(coreTable, {
                kind: 'reply',
                question: asNotificationPost(question),
                reply: {
                  ...asNotificationPost(question),
                  postId,
                  authorId: author.userId,
                  authorName: author.name,
                  body,
                  state: 'shown',
                  createdAt,
                },
              });
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
    const coreTable = ctx.coreTable;
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
    const coreTable = ctx.coreTable;
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
      const accepted = shownPost(
        await getPost(coreTable, ref, 'reply', threadId, postId),
      );
      // Accepting the accepted reply again writes nothing.
      if (question.acceptedPostId === postId) {
        return { result };
      }
      const at = new Date().toISOString();
      return {
        op: { type: 'accept', ...scope, replyId: postId } as const,
        notify: async () =>
          discussionNotificationWrites(coreTable, {
            kind: 'accepted',
            question: asNotificationPost(question),
            reply: asNotificationPost(accepted),
            acceptedBy: user.sub,
            acceptedByName: (await authorOf(coreTable, user, access)).name,
            at,
          }),
        result,
      };
    });
  });

export const report = courseProcedure
  .input(ReportInputSchema)
  .output(ReportOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
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
    const coreTable = ctx.coreTable;
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
