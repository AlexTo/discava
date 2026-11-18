/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type createCoreTableService,
  DISCUSSION_MAX_VISIBLE_REPLIES,
  DiscussionInputError,
  type DiscussionOperation,
  discussionWrites,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import { transactionConflict } from '../lib/course-lifecycle.js';
import {
  DiscussionPostSchema,
  DismissReportsInputSchema,
  HidePostInputSchema,
  type IDiscussionPost,
  type IQueuePost,
  QueueInputSchema,
  QueueOutputSchema,
  RemovePostInputSchema,
  UnhidePostInputSchema,
} from '../schema/index.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type StoredPost = NonNullable<
  Awaited<
    ReturnType<ReturnType<CoreTable['entities']['discussionPost']['get']>['go']>
  >['data']
>;

const PAGE = 20;
const MAX_ATTEMPTS = 3;

const notFound = () => new TRPCError({ code: 'NOT_FOUND' });

// A question's postId is its threadId.
const kindOf = (threadId: string, postId: string) =>
  postId === threadId ? ('question' as const) : ('reply' as const);

// Any course status is allowed: moderating an archived course is how a queue
// is cleared. A missing course is NOT_FOUND, anyone else without a
// courseInstructor record FORBIDDEN.
const requireCourseInstructor = async (
  coreTable: CoreTable,
  courseId: string,
  instructorId: string,
) => {
  const { data: membership } = await coreTable.entities.courseInstructor
    .get({ courseId, instructorId })
    .go();
  if (membership) {
    return;
  }
  const { data: course } = await coreTable.entities.course
    .get({ courseId })
    .go();
  throw course ? new TRPCError({ code: 'FORBIDDEN' }) : notFound();
};

const getPost = async (
  coreTable: CoreTable,
  courseId: string,
  lessonId: string,
  kind: 'question' | 'reply',
  threadId: string,
  postId: string,
) =>
  (
    await coreTable.entities.discussionPost
      .get({ courseId, kind, lessonId, threadId, postId })
      .go()
  ).data;

// Built key by key, so `reportedBy` never leaves.
const toPost = (post: StoredPost, userId: string): IDiscussionPost => ({
  postId: post.postId,
  threadId: post.threadId,
  kind: post.kind,
  state: post.state,
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
      post.acceptedPostId !== undefined || (post.instructorReplyCount ?? 0) > 0,
  }),
  mine: post.authorId === userId,
  reportCount: [...(post.reportedBy ?? [])].length,
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

// The page's posts with their lesson's title, from one keyed get per
// distinct lesson.
const withLessonTitles = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
  posts: StoredPost[],
): Promise<IQueuePost[]> => {
  const lessons = new Map(
    posts.map(({ moduleId, lessonId }) => [lessonId, moduleId]),
  );
  const titles = new Map<string, string>();
  await Promise.all(
    [...lessons].map(async ([lessonId, moduleId]) => {
      const { data } = await coreTable.entities.lesson
        .get({ courseId, moduleId, lessonId })
        .go();
      titles.set(lessonId, data?.title ?? '');
    }),
  );
  return posts.map((post) => ({
    ...toPost(post, userId),
    moduleId: post.moduleId,
    lessonId: post.lessonId,
    lessonTitle: titles.get(post.lessonId) ?? '',
  }));
};

export const unanswered = courseProcedure
  .input(QueueInputSchema)
  .output(QueueOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, cursor } = input;
    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    checkCursor(courseId, cursor);

    // Oldest first. Hidden and deleted questions are not in the index.
    const { data, cursor: next } = await coreTable.entities.discussionPost.query
      .byUnanswered({ unanswered: courseId })
      .go({ limit: PAGE, cursor });
    return {
      items: await withLessonTitles(coreTable, courseId, ctx.user.sub, data),
      ...(next && { cursor: next }),
    };
  });

export const reported = courseProcedure
  .input(QueueInputSchema)
  .output(QueueOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, cursor } = input;
    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    checkCursor(courseId, cursor);

    const { data, cursor: next } = await coreTable.entities.discussionPost.query
      .byReported({ reported: courseId })
      .go({ limit: PAGE, cursor });
    return {
      items: await withLessonTitles(coreTable, courseId, ctx.user.sub, data),
      ...(next && { cursor: next }),
    };
  });

const toPostRead = (post: StoredPost) => ({
  kind: post.kind,
  threadId: post.threadId,
  postId: post.postId,
  authorId: post.authorId,
  authorIsInstructor: post.authorIsInstructor,
  state: post.state,
});

const toQuestionRead = (question: StoredPost) => ({
  threadId: question.threadId,
  state: question.state,
  acceptedPostId: question.acceptedPostId,
  replyCount: question.replyCount,
  instructorReplyCount: question.instructorReplyCount,
  createdAt: question.createdAt,
});

interface Step {
  /** What to write, or nothing when the post is already as asked. */
  op?: DiscussionOperation;
}

type ModerateInput = {
  courseId: string;
  lessonId: string;
  threadId: string;
  postId: string;
};

// Reads, decides and writes with no course or lesson checks. A cancelled
// transaction is run again from the reads, up to three times, then CONFLICT.
// Returns the post as stored after the write.
const moderate = async (
  coreTable: CoreTable,
  userId: string,
  { courseId, lessonId, threadId, postId }: ModerateInput,
  decide: (post: StoredPost, question: StoredPost) => Step,
): Promise<IDiscussionPost> => {
  const kind = kindOf(threadId, postId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Keyed by the course, so a post of another course is not found.
    const post = await getPost(
      coreTable,
      courseId,
      lessonId,
      kind,
      threadId,
      postId,
    );
    if (!post) {
      throw notFound();
    }
    const question =
      kind === 'question'
        ? post
        : await getPost(
            coreTable,
            courseId,
            lessonId,
            'question',
            threadId,
            threadId,
          );
    if (!question) {
      throw notFound();
    }
    const { op } = decide(post, question);
    if (!op) {
      return toPost(post, userId);
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
      const fresh = await getPost(
        coreTable,
        courseId,
        lessonId,
        kind,
        threadId,
        postId,
      );
      if (!fresh) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'The post was not found after it was written',
        });
      }
      return toPost(fresh, userId);
    }
  }
  throw transactionConflict();
};

const stateChange =
  (type: 'hide' | 'unhide', from: 'shown' | 'hidden', scope: ModerateInput) =>
  (post: StoredPost, question: StoredPost): Step => {
    if (post.state === 'deleted') {
      throw notFound();
    }
    if (post.state !== from) {
      return {};
    }
    if (
      type === 'unhide' &&
      post.kind === 'reply' &&
      (question.replyCount ?? 0) >= DISCUSSION_MAX_VISIBLE_REPLIES
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This question already has 500 replies',
      });
    }
    return {
      op: {
        type,
        courseId: scope.courseId,
        lessonId: scope.lessonId,
        post: toPostRead(post),
        question: toQuestionRead(question),
      },
    };
  };

export const hide = courseProcedure
  .input(HidePostInputSchema)
  .output(DiscussionPostSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    await requireCourseInstructor(coreTable, input.courseId, ctx.user.sub);
    return moderate(
      coreTable,
      ctx.user.sub,
      input,
      stateChange('hide', 'shown', input),
    );
  });

export const unhide = courseProcedure
  .input(UnhidePostInputSchema)
  .output(DiscussionPostSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    await requireCourseInstructor(coreTable, input.courseId, ctx.user.sub);
    return moderate(
      coreTable,
      ctx.user.sub,
      input,
      stateChange('unhide', 'hidden', input),
    );
  });

export const remove = courseProcedure
  .input(RemovePostInputSchema)
  .output(DiscussionPostSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    await requireCourseInstructor(coreTable, input.courseId, ctx.user.sub);
    return moderate(coreTable, ctx.user.sub, input, (post, question) =>
      // Deleting a deleted post is a no-op.
      post.state === 'deleted'
        ? {}
        : {
            op: {
              type: 'delete',
              courseId: input.courseId,
              lessonId: input.lessonId,
              post: toPostRead(post),
              question: toQuestionRead(question),
            },
          },
    );
  });

export const dismissReports = courseProcedure
  .input(DismissReportsInputSchema)
  .output(DiscussionPostSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    await requireCourseInstructor(coreTable, input.courseId, ctx.user.sub);
    return moderate(coreTable, ctx.user.sub, input, (post) =>
      // The write is conditioned on the flag, so a post without one is left.
      post.reported === undefined
        ? {}
        : {
            op: {
              type: 'dismiss',
              courseId: input.courseId,
              lessonId: input.lessonId,
              post: toPostRead(post),
            },
          },
    );
  });
