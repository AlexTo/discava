/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  answeredState,
  DISCUSSION_BODY_MAX,
  DISCUSSION_MAX_REPORTERS,
  DISCUSSION_MAX_VISIBLE_REPLIES,
  DISCUSSION_TITLE_MAX,
} from '../discussion-text.js';
import { uuidV7Time } from '../uuid-v7.js';
import { type Check, groupBy, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

const discussionKey = (p: {
  courseId: string;
  lessonId: string;
  threadId: string;
  postId: string;
}) => ({
  courseId: p.courseId,
  lessonId: p.lessonId,
  threadId: p.threadId,
  postId: p.postId,
});

const DISCUSSION_STATES = ['shown', 'hidden', 'deleted'];

// A discussion post is well formed: a question has a title of 1 to 120
// characters and `postId = threadId`; a reply has none of the question-only
// attributes; the body is 1 to 4,000 characters, or gone (with the title and
// reports) once the post is deleted; the id is a UUID v7 made at createdAt;
// the author is named; and at most 20 reporters, none of them the author.
export const checkDiscussionPostShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.discussionPosts.flatMap((p) => {
    const problems: string[] = [];
    const deleted = p.state === 'deleted';
    if (!DISCUSSION_STATES.includes(p.state)) {
      problems.push(`state ${p.state} is not allowed`);
    }
    if (p.kind === 'question') {
      if (p.postId !== p.threadId) {
        problems.push("a question's postId is not its threadId");
      }
      if (deleted) {
        if (p.title !== undefined) {
          problems.push('a deleted question still has a title');
        }
      } else if (
        p.title === undefined ||
        [...p.title].length < 1 ||
        [...p.title].length > DISCUSSION_TITLE_MAX
      ) {
        problems.push(
          `a question's title is not 1 to ${DISCUSSION_TITLE_MAX} characters`,
        );
      }
    } else if (p.kind === 'reply') {
      if (p.title !== undefined) {
        problems.push('a reply has a title');
      }
      if (p.acceptedPostId !== undefined) {
        problems.push('a reply has an acceptedPostId');
      }
      if (p.unanswered !== undefined) {
        problems.push('a reply is marked unanswered');
      }
      if ((p.replyCount ?? 0) !== 0 || (p.instructorReplyCount ?? 0) !== 0) {
        problems.push('a reply has reply counts');
      }
    } else {
      problems.push(`kind ${p.kind} is not allowed`);
    }
    if (p.promptAnswer !== undefined) {
      if (p.promptAnswer !== true) {
        problems.push('promptAnswer is not true');
      }
      if (p.kind !== 'question') {
        problems.push('a post that is not a question has promptAnswer');
      }
    }
    if (deleted) {
      if (p.body !== undefined) {
        problems.push('a deleted post still has a body');
      }
      if (p.reportedBy !== undefined || p.reported !== undefined) {
        problems.push('a deleted post still has reports');
      }
    } else if (
      p.body === undefined ||
      [...p.body].length < 1 ||
      [...p.body].length > DISCUSSION_BODY_MAX
    ) {
      problems.push(`body is not 1 to ${DISCUSSION_BODY_MAX} characters`);
    }
    if (uuidV7Time(p.postId) !== p.createdAt) {
      problems.push('postId is not a UUID v7 made at createdAt');
    }
    if (!p.authorName) {
      problems.push('authorName is not set');
    }
    const reporters = p.reportedBy ?? [];
    if (reporters.length > DISCUSSION_MAX_REPORTERS) {
      problems.push(
        `${reporters.length} reporters, more than ${DISCUSSION_MAX_REPORTERS}`,
      );
    }
    if (reporters.includes(p.authorId)) {
      problems.push('the author is among the reporters');
    }
    return problems.map((problem) =>
      violation('discussion-post-shape', discussionKey(p), problem),
    );
  });

// A reply belongs to a question of the same course, lesson and thread,
// and every post's lesson exists (an archived lesson is fine) with the
// moduleId the post carries.
export const checkDiscussionThreadLinks = (
  snapshot: TableSnapshot,
): Violation[] => {
  const questions = new Set(
    snapshot.discussionPosts
      .filter((p) => p.kind === 'question')
      .map((p) => `${p.courseId}/${p.lessonId}/${p.postId}`),
  );
  const lessons = new Map(
    snapshot.lessons.map((l) => [`${l.courseId}/${l.lessonId}`, l]),
  );
  return snapshot.discussionPosts.flatMap((p) => {
    const problems: string[] = [];
    if (
      p.kind === 'reply' &&
      !questions.has(`${p.courseId}/${p.lessonId}/${p.threadId}`)
    ) {
      problems.push('its question does not exist');
    }
    const lesson = lessons.get(`${p.courseId}/${p.lessonId}`);
    if (lesson === undefined) {
      problems.push('its lesson does not exist');
    } else if (lesson.moduleId !== p.moduleId) {
      problems.push(
        `moduleId is ${p.moduleId}, but the lesson is in ${lesson.moduleId}`,
      );
    }
    return problems.map((problem) =>
      violation('discussion-thread-links', discussionKey(p), problem),
    );
  });
};

// A question's replyCount and instructorReplyCount equal its shown
// replies (and those by instructors), at most 500; a post's voteCount equals
// its votes.
export const checkDiscussionCountsMatch = (
  snapshot: TableSnapshot,
): Violation[] => {
  const shownReplies = groupBy(
    snapshot.discussionPosts.filter(
      (p) => p.kind === 'reply' && p.state === 'shown',
    ),
    (p) => `${p.courseId}/${p.lessonId}/${p.threadId}`,
  );
  const votes = groupBy(
    snapshot.discussionVotes,
    (v) => `${v.courseId}/${v.lessonId}/${v.threadId}/${v.postId}`,
  );
  return snapshot.discussionPosts.flatMap((p) => {
    const problems: string[] = [];
    if (p.kind === 'question') {
      const replies =
        shownReplies.get(`${p.courseId}/${p.lessonId}/${p.postId}`) ?? [];
      const instructors = replies.filter((r) => r.authorIsInstructor);
      const replyCount = p.replyCount ?? 0;
      const instructorReplyCount = p.instructorReplyCount ?? 0;
      if (replyCount !== replies.length) {
        problems.push(
          `replyCount is ${replyCount}, but it has ${replies.length} shown replies`,
        );
      }
      if (instructorReplyCount !== instructors.length) {
        problems.push(
          `instructorReplyCount is ${instructorReplyCount}, but ${instructors.length} shown replies are by instructors`,
        );
      }
      if (
        replyCount > DISCUSSION_MAX_VISIBLE_REPLIES ||
        instructorReplyCount > DISCUSSION_MAX_VISIBLE_REPLIES
      ) {
        problems.push(
          `more than ${DISCUSSION_MAX_VISIBLE_REPLIES} shown replies`,
        );
      }
    }
    const voteCount = p.voteCount ?? 0;
    const actual = (
      votes.get(`${p.courseId}/${p.lessonId}/${p.threadId}/${p.postId}`) ?? []
    ).length;
    if (voteCount !== actual) {
      problems.push(`voteCount is ${voteCount}, but it has ${actual} votes`);
    }
    return problems.map((problem) =>
      violation('discussion-counts-match', discussionKey(p), problem),
    );
  });
};

// A question's acceptedPostId, if set, names a shown reply of that
// question, and the question is not deleted.
export const checkDiscussionAcceptedValid = (
  snapshot: TableSnapshot,
): Violation[] => {
  const replies = new Map(
    snapshot.discussionPosts
      .filter((p) => p.kind === 'reply')
      .map((p) => [`${p.courseId}/${p.lessonId}/${p.postId}`, p]),
  );
  return snapshot.discussionPosts
    .filter((p) => p.kind === 'question' && p.acceptedPostId !== undefined)
    .flatMap((p) => {
      const accepted = replies.get(
        `${p.courseId}/${p.lessonId}/${p.acceptedPostId}`,
      );
      const problem =
        p.state === 'deleted'
          ? 'a deleted question still has an accepted answer'
          : accepted === undefined
            ? 'its accepted answer does not exist'
            : accepted.threadId !== p.postId
              ? 'its accepted answer is a reply of another question'
              : accepted.state !== 'shown'
                ? `its accepted answer is ${accepted.state}`
                : undefined;
      return problem
        ? [violation('discussion-accepted-valid', discussionKey(p), problem)]
        : [];
    });
};

// `unanswered` is set exactly when answeredState says the question is
// unanswered, and on questions only.
export const checkDiscussionUnansweredMatches = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.discussionPosts.flatMap((p) => {
    const expected = p.kind === 'question' && answeredState(p) === 'unanswered';
    const set = p.unanswered !== undefined;
    if (set && expected && p.unanswered !== p.courseId) {
      return [
        violation(
          'discussion-unanswered-matches',
          discussionKey(p),
          `unanswered is ${p.unanswered}, not its courseId`,
        ),
      ];
    }
    if (set === expected) {
      return [];
    }
    return [
      violation(
        'discussion-unanswered-matches',
        discussionKey(p),
        p.kind === 'reply'
          ? 'a reply is marked unanswered'
          : set
            ? 'is marked unanswered, but is not unanswered'
            : 'is unanswered, but is not marked',
      ),
    ];
  });

// An answer to the first-lesson prompt and its enrolment's state go together:
// every post with `promptAnswer` is a question whose author has an `answered`
// enrolment in that course, an author has at most one per course, and every
// `answered` enrolment has exactly one such post by that learner, in any state
// (a hidden or deleted answer still counts).
export const checkFirstLessonPromptMatchesAnswers = (
  snapshot: TableSnapshot,
): Violation[] => {
  const answers = snapshot.discussionPosts.filter(
    (p) => p.promptAnswer !== undefined,
  );
  const enrolments = new Map(
    snapshot.enrolments.map((e) => [`${e.courseId}/${e.userId}`, e]),
  );
  const byLearner = groupBy(answers, (p) => `${p.courseId}/${p.authorId}`);
  const problems = answers.flatMap((p) => {
    const enrolment = enrolments.get(`${p.courseId}/${p.authorId}`);
    const problem =
      p.kind !== 'question'
        ? 'a prompt answer is not a question'
        : enrolment === undefined
          ? 'its author has no enrolment in the course'
          : enrolment.firstLessonPromptState !== 'answered'
            ? `its author's enrolment has state ${enrolment.firstLessonPromptState ?? 'none'}, not answered`
            : (byLearner.get(`${p.courseId}/${p.authorId}`)?.length ?? 0) > 1
              ? 'its author has more than one prompt answer in the course'
              : undefined;
    return problem
      ? [
          violation(
            'first-lesson-prompt-matches-answers',
            discussionKey(p),
            problem,
          ),
        ]
      : [];
  });
  const missing = snapshot.enrolments
    .filter(
      (e) =>
        e.firstLessonPromptState === 'answered' &&
        !byLearner.has(`${e.courseId}/${e.userId}`),
    )
    .map((e) =>
      violation(
        'first-lesson-prompt-matches-answers',
        { courseId: e.courseId, userId: e.userId },
        'an answered enrolment has no prompt answer',
      ),
    );
  return [...problems, ...missing];
};

// A vote is for a post that exists, by someone other than its author,
// with the lesson and thread the post has.
export const checkDiscussionVotesValid = (
  snapshot: TableSnapshot,
): Violation[] => {
  const posts = new Map(
    snapshot.discussionPosts.map((p) => [`${p.courseId}/${p.postId}`, p]),
  );
  return snapshot.discussionVotes.flatMap((v) => {
    const post = posts.get(`${v.courseId}/${v.postId}`);
    const problem =
      post === undefined
        ? 'its post does not exist'
        : post.lessonId !== v.lessonId || post.threadId !== v.threadId
          ? "its lessonId or threadId differs from its post's"
          : post.authorId === v.userId
            ? "the voter is the post's author"
            : undefined;
    return problem
      ? [
          violation(
            'discussion-votes-valid',
            {
              courseId: v.courseId,
              userId: v.userId,
              postId: v.postId,
            },
            problem,
          ),
        ]
      : [];
  });
};

// `reported` is set exactly while reportedBy is non-empty.
export const checkDiscussionReportsValid = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.discussionPosts.flatMap((p) => {
    const reporters = (p.reportedBy ?? []).length > 0;
    if (reporters && p.reported !== undefined && p.reported !== p.courseId) {
      return [
        violation(
          'discussion-reports-valid',
          discussionKey(p),
          `reported is ${p.reported}, not its courseId`,
        ),
      ];
    }
    if (reporters === (p.reported !== undefined)) {
      return [];
    }
    return [
      violation(
        'discussion-reports-valid',
        discussionKey(p),
        reporters
          ? 'has reporters but is not marked reported'
          : 'is marked reported without reporters',
      ),
    ];
  });

export const DISCUSSION_CHECKS = [
  { name: 'discussion-post-shape', check: checkDiscussionPostShape },
  { name: 'discussion-thread-links', check: checkDiscussionThreadLinks },
  { name: 'discussion-counts-match', check: checkDiscussionCountsMatch },
  { name: 'discussion-accepted-valid', check: checkDiscussionAcceptedValid },
  {
    name: 'discussion-unanswered-matches',
    check: checkDiscussionUnansweredMatches,
  },
  {
    name: 'first-lesson-prompt-matches-answers',
    check: checkFirstLessonPromptMatchesAnswers,
  },
  { name: 'discussion-votes-valid', check: checkDiscussionVotesValid },
  { name: 'discussion-reports-valid', check: checkDiscussionReportsValid },
] as const satisfies readonly Check[];
