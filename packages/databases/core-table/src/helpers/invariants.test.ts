/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aggregatesOf,
  contributions,
  funnelContributions,
  sumContributions,
} from './analytics.js';
import {
  checkTableInvariants as checkAllInvariants,
  type InvariantName,
  type TableSnapshot,
  violationId,
} from './invariants.js';
import { NOTIFICATION_TYPES } from './notification-types.js';

// Most tests below change a table's records to break one rule, and should not
// also trip the analytics rule because the aggregates no longer match them.
// This checks the table with its aggregates recomputed from its records; the
// rule itself is tested on its own, with `checkAllInvariants`, at the end.
const checkTableInvariants = (snapshot: TableSnapshot) => {
  const items = aggregatesOf(
    sumContributions([
      ...snapshot.enrolments.map((r) => contributions('enrolment', r)),
      ...snapshot.itemCompletions.map((r) =>
        contributions('itemCompletion', r),
      ),
      ...snapshot.quizAttempts.map((r) => contributions('quizAttempt', r)),
    ]),
  );
  return checkAllInvariants({
    ...snapshot,
    courseStats: items
      .filter(({ kind }) => kind === 'courseStats')
      .map(({ courseId, counters }) => ({
        courseId,
        enrolments: 0,
        completed: 0,
        dropped: 0,
        ...counters,
      })),
    periodStats: items
      .filter(({ kind }) => kind === 'periodStats')
      .map(({ courseId, sk, counters }) => ({
        courseId,
        periodKey: sk,
        enrolments: 0,
        activeLearners: 0,
        ...counters,
      })),
  });
};

const INVARIANTS_UNDER_TEST: InvariantName[] = [
  'activity-count-matches-students',
  'student-records-have-targets',
  'student-records-enrolled',
  'student-records-placed-with-item',
  'last-activity-at-current',
  'assignment-submission-shape',
];

const T = '2026-01-01T00:00:00.000Z';
// When the student did things: the text item, then two quiz attempts.
const AT = {
  text: '2026-01-02T09:00:00.000Z',
  a1: '2026-01-02T10:00:00.000Z',
  a2: '2026-01-02T10:05:00.000Z',
};
const ids = { courseId: 'c1', moduleId: 'm1', lessonId: 'l1' };
const shown = { visibility: 'visible' as const, publishedAt: T };
const prefix = 'courses/c1/modules/m1/lessons/l1/content-items';

// A published course whose student has done the text item and passed the quiz
// (on their second attempt), but not the video or the file: two of four items,
// so 50% and the lesson in progress. Items are in order: text, quiz, video, file.
const consistentTable = (): TableSnapshot => ({
  courses: [
    {
      courseId: 'c1',
      status: 'published',
      publishedAt: T,
      updatedAt: T,
      lastChildOrder: 1,
    },
  ],
  modules: [{ ...ids, ...shown, order: 1, lastChildOrder: 1 }],
  lessons: [{ ...ids, ...shown, kind: 'lesson', order: 1, lastChildOrder: 4 }],
  contentItems: [
    {
      ...ids,
      ...shown,
      contentItemId: 'text',
      type: 'text',
      status: 'ready',
      order: 1,
      studentActivityCount: 1,
    },
    {
      ...ids,
      ...shown,
      contentItemId: 'quiz',
      type: 'quiz',
      status: 'ready',
      order: 2,
      studentActivityCount: 1,
    },
    {
      ...ids,
      ...shown,
      contentItemId: 'video',
      type: 'video',
      status: 'ready',
      order: 3,
      s3Key: `${prefix}/video/n1/master.m3u8`,
      studentActivityCount: 0,
    },
    {
      ...ids,
      ...shown,
      contentItemId: 'file',
      type: 'file',
      status: 'ready',
      order: 4,
      s3Key: `${prefix}/file/u1/notes.pdf`,
      submissionNonce: 'u1',
      fileName: 'notes.pdf',
      fileSize: 596,
      mimeType: 'application/pdf',
      studentActivityCount: 0,
    },
  ],
  courseInstructors: [
    { courseId: 'c1', instructorId: 'teacher', courseUpdatedAt: T },
  ],
  enrolments: [
    {
      courseId: 'c1',
      userId: 'student',
      status: 'active',
      progressPercent: 50,
      lastActivityAt: AT.a2,
      createdAt: T,
    },
  ],
  itemCompletions: [
    { ...ids, userId: 'student', contentItemId: 'text', completedAt: AT.text },
    { ...ids, userId: 'student', contentItemId: 'quiz', completedAt: AT.a2 },
  ],
  progress: [
    {
      userId: 'student',
      courseId: 'c1',
      lessonId: 'l1',
      status: 'in_progress',
    },
  ],
  quizAttempts: [
    {
      ...ids,
      userId: 'student',
      contentItemId: 'quiz',
      attemptId: 'a1',
      answers: { q1: ['x'], q2: ['y'] },
      correctQuestionIds: ['q1'],
      scorePercent: 40,
      passed: false,
      submittedAt: AT.a1,
    },
    {
      ...ids,
      userId: 'student',
      contentItemId: 'quiz',
      attemptId: 'a2',
      answers: { q1: ['x'], q2: ['z'] },
      correctQuestionIds: ['q1', 'q2'],
      scorePercent: 80,
      passed: true,
      submittedAt: AT.a2,
    },
  ],
  quizSummaries: [
    {
      ...ids,
      userId: 'student',
      contentItemId: 'quiz',
      attemptsUsed: 2,
      bestScore: 80,
      bestAttemptId: 'a2',
      passedAt: T,
    },
  ],
  assignmentSubmissions: [],
  certificates: [],
  videoPositions: [],
  users: [{ userId: 'teacher' }, { userId: 'student' }],
  // What the stream handler leaves for the records above: one enrolment on
  // 1 January, and the student active on 2 January (week 1 of 2026).
  courseStats: [{ courseId: 'c1', enrolments: 1, completed: 0, dropped: 0 }],
  periodStats: [
    {
      courseId: 'c1',
      periodKey: 'DAY#2026-01-01',
      enrolments: 1,
      activeLearners: 0,
    },
    {
      courseId: 'c1',
      periodKey: 'DAY#2026-01-02',
      enrolments: 0,
      activeLearners: 1,
    },
    {
      courseId: 'c1',
      periodKey: 'WEEK#2026-W01',
      enrolments: 0,
      activeLearners: 1,
    },
  ],
  lessonStats: [
    { courseId: 'c1', lessonId: 'l1', inProgress: 1, completed: 0 },
  ],
  // The two attempts answered q1 and q2; q2 was missed once. The best score
  // of 80 is in band 8.
  quizQuestionStats: [
    {
      courseId: 'c1',
      contentItemId: 'quiz',
      questionId: 'q1',
      attempts: 2,
      misses: 0,
    },
    {
      courseId: 'c1',
      contentItemId: 'quiz',
      questionId: 'q2',
      attempts: 2,
      misses: 1,
    },
  ],
  quizScoreStats: [
    {
      courseId: 'c1',
      contentItemId: 'quiz',
      ...{ band0: 0, band1: 0, band2: 0, band3: 0, band4: 0 },
      ...{ band5: 0, band6: 0, band7: 0, band8: 1, band9: 0 },
    },
  ],
  notifications: [],
  notificationStates: [],
  notificationPreferences: [],
  notificationBroadcasts: [],
  announcements: [],
  categories: [],
  categoryClaims: [],
  discussionPosts: [],
  discussionVotes: [],

  reviews: [],
  courseRatings: [],
});

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});

const item = (contentItemId: string) => {
  const found = table.contentItems.find(
    (i) => i.contentItemId === contentItemId,
  );
  if (!found) throw new Error(`no item ${contentItemId}`);
  return found;
};

// The lesson figures the records add up to, as the analytics handler would
// have left them, for a test that changes progress or an enrolment to try
// another rule; rule 26 is tried against its own figures below.
const settleLessonStats = () => {
  table.lessonStats = aggregatesOf(
    sumContributions(
      table.enrolments.map((enrolled) =>
        funnelContributions(
          table.progress.filter(
            (p) =>
              p.courseId === enrolled.courseId && p.userId === enrolled.userId,
          ),
          enrolled,
        ),
      ),
    ),
  ).map(({ courseId, sk, counters }) => ({
    courseId,
    lessonId: sk.slice('LESSON#'.length),
    inProgress: counters.inProgress ?? 0,
    completed: counters.completed ?? 0,
  }));
};

// The same for the quiz figures, for a test that changes an attempt or a
// summary to try another rule.
const settleQuizStats = () => {
  const items = aggregatesOf(
    sumContributions([
      ...table.quizAttempts.map((r) => contributions('quizAttempt', r)),
      ...table.quizSummaries.map((r) => contributions('quizSummary', r)),
    ]),
  );
  table.quizQuestionStats = items
    .filter(({ kind }) => kind === 'quizQuestionStats')
    .map(({ courseId, sk, counters }) => {
      const [contentItemId, questionId] = sk.slice(5).split('#Q#');
      return {
        courseId,
        contentItemId,
        questionId,
        attempts: counters.attempts ?? 0,
        misses: counters.misses ?? 0,
      };
    });
  table.quizScoreStats = items
    .filter(({ kind }) => kind === 'quizScoreStats')
    .map(({ courseId, sk, counters }) => ({
      courseId,
      contentItemId: sk.slice(5, -'#SCORES'.length),
      ...Object.fromEntries(
        Array.from({ length: 10 }, (_, b) => [
          `band${b}`,
          counters[`band${b}`] ?? 0,
        ]),
      ),
    })) as typeof table.quizScoreStats;
};

// The invariants broken, each once, with the messages.
const broken = () => {
  settleLessonStats();
  settleQuizStats();
  const violations = checkTableInvariants(table);
  return {
    invariants: [...new Set(violations.map((v) => v.invariant))],
    messages: violations.map((v) => v.message),
    violations,
  };
};

const expectOnly = (invariant: InvariantName, message?: RegExp) => {
  const { invariants, messages } = broken();
  expect(invariants).toEqual([invariant]);
  if (message) {
    expect(messages).toContainEqual(expect.stringMatching(message));
  }
};

describe('checkTableInvariants', () => {
  it('finds nothing wrong with a consistent table', () => {
    expect(checkTableInvariants(table)).toEqual([]);
  });

  it('finds nothing wrong with an empty table', () => {
    expect(
      checkTableInvariants({
        courses: [],
        modules: [],
        lessons: [],
        contentItems: [],
        courseInstructors: [],
        enrolments: [],
        itemCompletions: [],
        progress: [],
        quizAttempts: [],
        quizSummaries: [],
        assignmentSubmissions: [],
        certificates: [],
        videoPositions: [],
        users: [],
        courseStats: [],
        periodStats: [],
        lessonStats: [],
        quizQuestionStats: [],
        quizScoreStats: [],
        notifications: [],
        notificationStates: [],
        notificationPreferences: [],
        notificationBroadcasts: [],
        announcements: [],
        categories: [],
        categoryClaims: [],
        discussionPosts: [],
        discussionVotes: [],

        reviews: [],
        courseRatings: [],
      }),
    ).toEqual([]);
  });

  describe('1. course-has-instructor', () => {
    it('reports a course nobody teaches', () => {
      table.courseInstructors = [];
      expectOnly('course-has-instructor');
    });
  });

  describe('2. activity-count-matches-students', () => {
    it('reports a count lower than the students with completions', () => {
      item('text').studentActivityCount = 0;
      expectOnly('activity-count-matches-students', /0, but 1 students/);
    });

    it('reports a count higher than the students with records', () => {
      item('video').studentActivityCount = 1;
      expectOnly('activity-count-matches-students', /1, but 0 students/);
    });

    it('counts a student once, whatever records they have', () => {
      // The quiz's student has both a completion and a summary.
      expect(item('quiz').studentActivityCount).toBe(1);
      expect(broken().invariants).toEqual([]);
    });

    it('counts a quiz attempted but not yet completed', () => {
      table.itemCompletions = table.itemCompletions.filter(
        (c) => c.contentItemId !== 'quiz',
      );
      table.enrolments[0].progressPercent = 25;
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('3. quiz-summary-matches-attempts', () => {
    it('reports attemptsUsed that is not the number of attempts', () => {
      table.quizSummaries[0].attemptsUsed = 3;
      expectOnly('quiz-summary-matches-attempts', /3, but there are 2/);
    });

    it('reports a bestScore that is not the best attempt', () => {
      table.quizSummaries[0].bestScore = 40;
      expectOnly('quiz-summary-matches-attempts', /the best attempt scored 80/);
    });

    it('reports a bestAttemptId that does not score bestScore', () => {
      table.quizSummaries[0].bestAttemptId = 'a1';
      expectOnly('quiz-summary-matches-attempts', /bestAttemptId a1/);
    });

    it('reports a pass without passedAt, and passedAt without a pass', () => {
      table.quizSummaries[0].passedAt = undefined;
      expectOnly('quiz-summary-matches-attempts', /passedAt is not set/);

      table = consistentTable();
      table.quizAttempts[1].passed = false;
      expectOnly('quiz-summary-matches-attempts', /no attempt passed/);
    });

    it('reports an attempt with no summary', () => {
      // Another enrolled student, whose attempt never got its summary.
      table.enrolments.push({
        courseId: 'c1',
        userId: 'classmate',
        status: 'active',
        progressPercent: 0,
        lastActivityAt: AT.a1,
      });
      table.quizAttempts.push({
        ...ids,
        userId: 'classmate',
        contentItemId: 'quiz',
        attemptId: 'a9',
        scorePercent: 10,
        passed: false,
        submittedAt: AT.a1,
      });
      const { violations } = broken();
      expect(violations).toContainEqual(
        expect.objectContaining({
          invariant: 'quiz-summary-matches-attempts',
          message: 'attempt has no quizSummary',
          record: expect.objectContaining({ attemptId: 'a9' }),
        }),
      );
    });
  });

  describe('4. progress-matches-completions', () => {
    it('reports a progressPercent the completions do not give', () => {
      table.enrolments[0].progressPercent = 75;
      expectOnly('progress-matches-completions', /75, but should be 50/);
    });

    it('reports lesson progress the completions do not give', () => {
      table.progress[0].status = 'not_started';
      expectOnly(
        'progress-matches-completions',
        /not_started, but should be in_progress/,
      );
    });

    it('treats a lesson with no progress record as not started', () => {
      table.progress = [];
      expectOnly(
        'progress-matches-completions',
        /not_started, but should be in_progress/,
      );
    });

    it('reports an enrolment not completed when every item is', () => {
      for (const contentItemId of ['video', 'file']) {
        table.itemCompletions.push({
          ...ids,
          userId: 'student',
          contentItemId,
          completedAt: AT.text,
        });
        item(contentItemId).studentActivityCount = 1;
      }
      table.enrolments[0].progressPercent = 100;
      table.progress[0] = {
        ...table.progress[0],
        status: 'completed',
        completedAt: T,
      };
      expectOnly('progress-matches-completions', /the enrolment is active/);
    });

    it('accepts completion that stays after new content is added', () => {
      table.progress[0] = {
        ...table.progress[0],
        status: 'completed',
        completedAt: T,
      };
      table.enrolments[0] = {
        ...table.enrolments[0],
        status: 'completed',
        completedAt: T,
      };
      expect(broken().invariants).toEqual([]);
    });

    it('counts only what students can see', () => {
      // Hiding the video and file leaves the two completed items: 100%.
      item('video').visibility = 'hidden';
      item('file').archivedAt = T;
      expectOnly('progress-matches-completions', /50, but should be 100/);
    });

    it('leaves dropped enrolments alone', () => {
      table.enrolments[0] = {
        ...table.enrolments[0],
        status: 'dropped',
        progressPercent: 0,
      };
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('5. instructor-course-updated-at', () => {
    it("reports a courseUpdatedAt that isn't the course's updatedAt", () => {
      table.courseInstructors[0].courseUpdatedAt = '2025-12-31T23:59:59.999Z';
      expectOnly('instructor-course-updated-at');
    });

    // course.setCertificates writes certificatesEnabled, which moves the
    // course's updatedAt; an instructor row left behind is a violation.
    it('reports a certificatesEnabled change that did not move courseUpdatedAt', () => {
      const course = table.courses[0];
      course.certificatesEnabled = !course.certificatesEnabled;
      course.updatedAt = '2025-06-01T00:00:00.000Z';
      expectOnly('instructor-course-updated-at');
    });

    it('accepts a certificatesEnabled change that moved courseUpdatedAt', () => {
      const course = table.courses[0];
      course.certificatesEnabled = !course.certificatesEnabled;
      course.updatedAt = '2025-06-01T00:00:00.000Z';
      for (const row of table.courseInstructors) {
        row.courseUpdatedAt = course.updatedAt;
      }
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('6. video-transcode-state', () => {
    it('reports transcodePending without transcodePendingSince', () => {
      Object.assign(item('video'), {
        status: 'pending',
        transcodePending: 'pending',
      });
      expectOnly('video-transcode-state', /not set together/);
    });

    it('reports transcodePending on a video that is no longer pending', () => {
      Object.assign(item('video'), {
        transcodePending: 'pending',
        transcodePendingSince: T,
      });
      expectOnly('video-transcode-state', /on a ready video/);
    });

    it("reports a ready video that doesn't play from a master.m3u8", () => {
      item('video').s3Key = `${prefix}/video/raw.mp4`;
      expectOnly('video-transcode-state', /raw.mp4/);
    });

    it('accepts a pending video with both attributes', () => {
      Object.assign(item('video'), {
        status: 'pending',
        s3Key: undefined,
        transcodePending: 'pending',
        transcodePendingSince: T,
      });
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('6. file-item-shape', () => {
    it('reports a file item missing its file', () => {
      item('file').fileSize = undefined;
      expectOnly('file-item-shape', /missing fileSize/);
    });

    it("reports a file outside its version's folder", () => {
      item('file').submissionNonce = 'u2';
      expectOnly('file-item-shape', /isn't in the item's u2 folder/);
    });
  });

  describe('7. published-at-set', () => {
    it('reports a published course without publishedAt', () => {
      // Its student is then enrolled in a course never published, too.
      table.courses[0].publishedAt = undefined;
      expect(broken().invariants).toEqual([
        'published-at-set',
        'enrolment-in-published-course',
      ]);
      expect(broken().messages).toContain(
        'published, but publishedAt is not set',
      );
    });

    it('reports a draft course with publishedAt', () => {
      table.courses[0].status = 'draft';
      expectOnly('published-at-set', /a draft, but/);
    });

    it('reports a visible record without publishedAt', () => {
      table.lessons[0].publishedAt = undefined;
      expectOnly('published-at-set', /visible, but/);
    });

    it('accepts a hidden record never published', () => {
      Object.assign(item('file'), {
        visibility: 'hidden',
        publishedAt: undefined,
      });
      // Hidden, it no longer counts: two of three items done.
      table.enrolments[0].progressPercent = 66;
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('8. completed-at-iff-completed', () => {
    it('reports completedAt without completed, on progress and enrolments', () => {
      table.progress[0].completedAt = T;
      expectOnly('completed-at-iff-completed', /the status is in_progress/);

      table = consistentTable();
      table.enrolments[0].completedAt = T;
      expectOnly('completed-at-iff-completed', /the status is active/);
    });

    it('reports completed without completedAt', () => {
      table.enrolments[0].status = 'completed';
      expectOnly('completed-at-iff-completed', /completedAt is not set/);
    });
  });

  describe('9. curriculum-has-parents', () => {
    it('reports a module, lesson or item whose parent is missing', () => {
      // The course's module is orphaned; so is its enrolment.
      table.courses = [];
      table.courseInstructors = [];
      expect(broken().invariants).toEqual([
        'curriculum-has-parents',
        'student-records-have-targets',
      ]);
      expect(broken().messages).toContain('its course is missing');

      // Without its lesson, nothing in it counts, so the student's progress
      // is wrong too.
      table = consistentTable();
      table.lessons = [];
      const { invariants, messages } = broken();
      expect(invariants).toEqual([
        'progress-matches-completions',
        'curriculum-has-parents',
      ]);
      expect(messages).toContain('its lesson is missing');
    });

    it('reports an item filed under a lesson of another module', () => {
      // Its completion is then filed somewhere else than the item, too.
      item('text').moduleId = 'm2';
      expect(broken().invariants).toEqual([
        'curriculum-has-parents',
        'student-records-placed-with-item',
      ]);
      expect(broken().messages).toContain('its lesson is missing');
    });
  });

  describe('10. student-records-have-targets', () => {
    it('reports an enrolment in a course that does not exist', () => {
      table.enrolments.push({
        courseId: 'gone',
        userId: 'student',
        status: 'active',
        progressPercent: 0,
      });
      expectOnly('student-records-have-targets', /enrolment/);
    });

    it('reports quiz records for something that is not a quiz', () => {
      item('quiz').type = 'text';
      expectOnly(
        'student-records-have-targets',
        /quiz summary for a text item/,
      );
    });

    it('reports a completion whose item was deleted', () => {
      table.itemCompletions.push({
        ...ids,
        userId: 'student',
        contentItemId: 'deleted',
        completedAt: AT.text,
      });
      expectOnly(
        'student-records-have-targets',
        /completion for a content item that does not exist/,
      );
    });
  });

  describe('11. instructor-has-user', () => {
    it('reports an instructor with no user record', () => {
      table.users = [{ userId: 'student' }];
      expectOnly('instructor-has-user');
    });
  });
});

describe('the rules added after #57', () => {
  describe('12. student-records-enrolled', () => {
    it('reports completions and quiz records with no enrolment', () => {
      table.enrolments = [];
      const { invariants, violations } = broken();
      expect(invariants).toEqual(['student-records-enrolled']);
      // Two completions, two attempts and a summary.
      expect(violations).toHaveLength(5);
    });

    it('still counts a dropped enrolment', () => {
      table.enrolments[0].status = 'dropped';
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('13. enrolment-in-published-course', () => {
    it('reports an enrolment in a course never published', () => {
      // A draft course: it has never been published.
      table.courses[0] = {
        ...table.courses[0],
        status: 'draft',
        publishedAt: undefined,
      };
      expect(broken().invariants).toContain('enrolment-in-published-course');
    });

    it('accepts an enrolment in a course archived after publishing', () => {
      table.courses[0].status = 'archived';
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('14. sibling-order-unique', () => {
    it('reports two content items of a lesson sharing an order', () => {
      item('file').order = 2;
      expectOnly('sibling-order-unique', /2 content items share this order/);
    });

    it('reports two lessons of a module, or modules of a course, sharing one', () => {
      table.lessons.push({
        ...ids,
        ...shown,
        kind: 'lesson',
        lessonId: 'l2',
        order: 1,
      });
      expectOnly('sibling-order-unique', /2 lessons/);

      table = consistentTable();
      table.modules.push({ ...ids, ...shown, moduleId: 'm2', order: 1 });
      expectOnly('sibling-order-unique', /2 modules/);
    });

    it('leaves out archived siblings, which keep the order they had', () => {
      item('file').order = 2;
      item('file').archivedAt = T;
      // Archived, the file no longer counts: two of three items done.
      table.enrolments[0].progressPercent = 66;
      expect(broken().invariants).toEqual([]);
    });

    it('accepts the same order under different parents', () => {
      table.modules[0].lastChildOrder = 2;
      table.lessons.push({
        ...ids,
        ...shown,
        kind: 'lesson',
        moduleId: 'm1',
        lessonId: 'l2',
        order: 2,
        lastChildOrder: 1,
      });
      table.contentItems.push({
        ...ids,
        ...shown,
        lessonId: 'l2',
        contentItemId: 'other',
        type: 'text',
        status: 'ready',
        order: 1,
        studentActivityCount: 0,
      });
      // One more item, not done: two of five.
      table.enrolments[0].progressPercent = 40;
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('15. student-records-placed-with-item', () => {
    it("reports a record filed under a lesson that isn't its item's", () => {
      table.itemCompletions[0].lessonId = 'l9';
      expectOnly(
        'student-records-placed-with-item',
        /lesson l9, but the item is in module m1, lesson l1/,
      );
    });
  });

  describe('16. last-activity-at-current', () => {
    it('reports a lastActivityAt older than the latest activity', () => {
      table.enrolments[0].lastActivityAt = AT.a1;
      expectOnly('last-activity-at-current', /latest activity was at/);
    });

    it('reports a missing lastActivityAt when there was activity', () => {
      table.enrolments[0].lastActivityAt = undefined;
      expectOnly('last-activity-at-current', /not set/);
    });
  });

  describe('17. draft-course-nothing-archived', () => {
    it('reports something archived in a draft course', () => {
      table = consistentTable();
      table.courses[0] = {
        ...table.courses[0],
        status: 'draft',
        publishedAt: undefined,
      };
      table.enrolments = [];
      table.itemCompletions = [];
      table.quizAttempts = [];
      table.quizSummaries = [];
      table.progress = [];
      for (const i of table.contentItems) i.studentActivityCount = 0;
      expect(broken().invariants).toEqual([]);

      item('video').archivedAt = T;
      expectOnly('draft-course-nothing-archived');
    });
  });

  describe('18. child-order-claimed', () => {
    it("reports a record above its parent's lastChildOrder", () => {
      item('file').order = 5;
      expectOnly('child-order-claimed', /order 5 is above .*\(4\)/);
    });

    it('reports one under a parent that never handed out an order', () => {
      table.modules[0].lastChildOrder = undefined;
      expectOnly('child-order-claimed', /\(0\)/);
    });

    it('accepts orders below it: the record at the top was removed', () => {
      table.lessons[0].lastChildOrder = 9;
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('19. assignment-lesson-shape', () => {
    // Moves the table's quiz into a new assignment lesson of its own.
    const assignmentLesson = () => {
      table.lessons.push({
        ...ids,
        ...shown,
        lessonId: 'a1',
        kind: 'assignment',
        order: 2,
        lastChildOrder: 1,
      });
      table.lessons[0].lastChildOrder = 3;
      const quiz = item('quiz');
      quiz.lessonId = 'a1';
      quiz.order = 1;
      table.itemCompletions[1].lessonId = 'a1';
      table.quizAttempts.forEach((a) => (a.lessonId = 'a1'));
      table.quizSummaries.forEach((a) => (a.lessonId = 'a1'));
      table.progress.push({
        userId: 'student',
        courseId: 'c1',
        lessonId: 'a1',
        status: 'completed',
        completedAt: AT.a2,
      });
      return quiz;
    };

    it('accepts an assignment lesson with a quiz or an upload assignment', () => {
      assignmentLesson();
      expect(broken().violations.map((v) => v.invariant)).not.toContain(
        'assignment-lesson-shape',
      );
      item('quiz').type = 'assignment';
      expect(broken().violations.map((v) => v.invariant)).not.toContain(
        'assignment-lesson-shape',
      );
    });

    it('reports an assignment lesson with no content item', () => {
      assignmentLesson();
      table.contentItems = table.contentItems.filter(
        (i) => i.contentItemId !== 'quiz',
      );
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/has 0 content items, not 1/),
      );
    });

    it('reports an assignment lesson with two content items', () => {
      assignmentLesson();
      table.contentItems.push({
        ...item('quiz'),
        contentItemId: 'quiz2',
        order: 2,
      });
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/has 2 content items, not 1/),
      );
    });

    it('reports an assignment lesson holding a text item', () => {
      assignmentLesson().type = 'text';
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/holds a text item/),
      );
    });

    it('reports an upload assignment outside an assignment lesson', () => {
      item('text').type = 'assignment';
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/isn't in an assignment lesson/),
      );
    });
  });
});

describe('submissions (#102)', () => {
  const SUBMITTED = '2026-01-02T09:30:00.000Z';
  const folder = `${prefix}/video/submissions/student/a1/`;

  // Turns the video item into an upload assignment the student has submitted
  // to, with its completion, as assignmentSubmissionWrites leaves them. Other
  // invariants (the lesson's shape, progress) are not the subject here.
  const submitted = () => {
    const upload = item('video');
    upload.type = 'assignment';
    upload.s3Key = undefined;
    upload.studentActivityCount = 1;
    table.itemCompletions.push({
      ...ids,
      userId: 'student',
      contentItemId: 'video',
      completedAt: SUBMITTED,
    });
    table.assignmentSubmissions.push({
      ...ids,
      userId: 'student',
      contentItemId: 'video',
      file: {
        key: `${folder}work.pdf`,
        fileName: 'work.pdf',
        fileSize: 10,
        mimeType: 'application/pdf',
      },
      version: 1,
      submittedAt: SUBMITTED,
    });
    return table.assignmentSubmissions[0];
  };
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  it.each(INVARIANTS_UNDER_TEST)('keeps %s for a proper submission', (name) => {
    submitted();
    expect(violationsOf(name)).toEqual([]);
  });

  it('reports a count that omits a submission-only student (2. activity-count-matches-students)', () => {
    submitted();
    table.itemCompletions.pop();
    item('video').studentActivityCount = 0;
    expect(violationsOf('activity-count-matches-students')).toHaveLength(1);
  });

  it('reports a submission whose item is gone (10. student-records-have-targets)', () => {
    submitted().contentItemId = 'gone';
    expect(violationsOf('student-records-have-targets')).toContainEqual(
      expect.objectContaining({
        message: 'submission for a content item that does not exist',
      }),
    );
  });

  it('reports a submission by a student who is not enrolled (12. student-records-enrolled)', () => {
    submitted().userId = 'stranger';
    expect(violationsOf('student-records-enrolled')).toContainEqual(
      expect.objectContaining({
        message: 'submission by a student not enrolled in the course',
      }),
    );
  });

  it('reports a submission filed under another lesson (15. student-records-placed-with-item)', () => {
    submitted().lessonId = 'other';
    expect(violationsOf('student-records-placed-with-item')).toHaveLength(1);
  });

  it('reports a resubmit that did not advance lastActivityAt (16. last-activity-at-current)', () => {
    submitted().submittedAt = '2026-01-03T00:00:00.000Z';
    expect(violationsOf('last-activity-at-current')).toHaveLength(1);
  });

  describe('20. assignment-submission-shape', () => {
    it.each([
      ['key', /missing its key/],
      ['fileName', /missing its key/],
      ['fileSize', /missing its key/],
      ['mimeType', /missing its key/],
    ])('reports a file without its %s', (field, message) => {
      const file = submitted().file as Record<string, unknown>;
      file[field] = field === 'fileSize' ? 0 : '';
      expect(violationsOf('assignment-submission-shape')[0]?.message).toMatch(
        message,
      );
    });

    it('reports a version below 1', () => {
      submitted().version = 0;
      expect(violationsOf('assignment-submission-shape')[0]?.message).toMatch(
        /version is 0/,
      );
    });

    it('reports a file outside the student’s own folder', () => {
      submitted().file.key = `${prefix}/video/submissions/someone-else/a1/work.pdf`;
      expect(violationsOf('assignment-submission-shape')[0]?.message).toMatch(
        /outside the student's folder/,
      );
    });

    it('reports a submission to an item that is not an upload assignment', () => {
      submitted();
      item('video').type = 'file';
      expect(violationsOf('assignment-submission-shape')[0]?.message).toMatch(
        /submitted to a file item/,
      );
    });

    it('reports a submission with no completion', () => {
      submitted();
      table.itemCompletions.pop();
      expect(violationsOf('assignment-submission-shape')[0]?.message).toMatch(
        /no completion/,
      );
    });

    it('does not check late against the item’s dueAt', () => {
      // A late record on an item with no due date: the instructor removed it.
      (submitted() as Record<string, unknown>).late = true;
      expect(violationsOf('assignment-submission-shape')).toEqual([]);
    });
  });
});

describe('21. certificate-shape and 22. certificate-has-completed-enrolment', () => {
  const COMPLETED = '2026-01-03T00:00:00.000Z';
  const issued = () => {
    table.enrolments[0].status = 'completed';
    table.enrolments[0].completedAt = COMPLETED;
    table.certificates.push({
      userId: 'student',
      courseId: 'c1',
      certificateId: '0123456789ABCDEF',
      learnerName: 'Erin Nguyen',
      courseTitle: 'Intro',
      completedAt: COMPLETED,
      issuedAt: COMPLETED,
    });
    return table.certificates[0];
  };
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  it('finds nothing wrong with a certificate for a completed enrolment', () => {
    issued();
    expect(violationsOf('certificate-shape')).toEqual([]);
    expect(violationsOf('certificate-has-completed-enrolment')).toEqual([]);
  });

  it.each(['0123456789ABCDE', '0123456789ABCDEI', '0123-4567-89AB-CDEF'])(
    'reports a bad ID (%s)',
    (id) => {
      issued().certificateId = id;
      expect(violationsOf('certificate-shape')[0]?.message).toMatch(
        /not 16 Crockford/,
      );
    },
  );

  it('reports a duplicate ID', () => {
    issued();
    table.certificates.push({
      ...table.certificates[0],
      userId: 'other',
    });
    expect(violationsOf('certificate-shape').map((v) => v.message)).toEqual([
      expect.stringMatching(/more than one/),
      expect.stringMatching(/more than one/),
    ]);
  });

  it.each(['learnerName', 'courseTitle', 'completedAt', 'issuedAt'] as const)(
    'reports a missing %s',
    (field) => {
      (issued() as Record<string, unknown>)[field] = '';
      expect(
        violationsOf('certificate-shape').map((v) => v.message),
      ).toContainEqual(`${field} is missing`);
    },
  );

  it('reports issuedAt before completedAt', () => {
    issued().issuedAt = '2026-01-02T00:00:00.000Z';
    expect(violationsOf('certificate-shape')[0]?.message).toMatch(
      /before completedAt/,
    );
  });

  it('reports a certificate with no enrolment', () => {
    issued();
    table.enrolments = [];
    expect(
      violationsOf('certificate-has-completed-enrolment')[0]?.message,
    ).toMatch(/not enrolled/);
  });

  it.each(['active', 'dropped'] as const)(
    'reports a certificate for a %s enrolment',
    (status) => {
      issued();
      table.enrolments[0].status = status;
      expect(
        violationsOf('certificate-has-completed-enrolment')[0]?.message,
      ).toMatch(new RegExp(`is ${status}`));
    },
  );

  it('reports a different completedAt', () => {
    issued();
    table.enrolments[0].completedAt = '2026-01-04T00:00:00.000Z';
    expect(
      violationsOf('certificate-has-completed-enrolment')[0]?.message,
    ).toMatch(/completedAt differs/);
  });

  it('reports a missing course', () => {
    issued();
    table.courses = [];
    expect(
      violationsOf('certificate-has-completed-enrolment').map((v) => v.message),
    ).toContainEqual(expect.stringMatching(/course that does not exist/));
  });

  it('does not report certificates off for the course', () => {
    issued();
    (table.courses[0] as Record<string, unknown>).certificatesEnabled = false;
    expect(violationsOf('certificate-shape')).toEqual([]);
    expect(violationsOf('certificate-has-completed-enrolment')).toEqual([]);
  });

  it('does not report a completed enrolment without a certificate', () => {
    issued();
    table.certificates = [];
    expect(checkTableInvariants(table)).toEqual([]);
  });

  it('does not count a student whose only record is a certificate, nor trip student-records checks', () => {
    issued();
    table.users.push({ userId: 'someone' });
    table.enrolments.push({
      courseId: 'c1',
      userId: 'someone',
      status: 'completed',
      progressPercent: 100,
      completedAt: COMPLETED,
    });
    table.certificates.push({
      ...table.certificates[0],
      userId: 'someone',
      certificateId: '89ABCDEF01234567',
    });
    const names = checkTableInvariants(table).map((v) => v.invariant);
    expect(names).not.toContain('activity-count-matches-students');
    expect(names.filter((n) => n.startsWith('student-records-'))).toEqual([]);
  });
});

describe('video-position-valid', () => {
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  const position = () => ({
    userId: 'student',
    courseId: 'c1',
    lessonId: 'l1',
    contentItemId: 'video',
    positionSeconds: 42,
    versionId: 'nonce-1',
  });

  it('accepts a valid position, and 0', () => {
    table.videoPositions.push(position(), {
      ...position(),
      contentItemId: 'video-2',
      positionSeconds: 0,
    });
    expect(violationsOf('video-position-valid')).toEqual([]);
  });

  it.each([
    ['a negative position', { positionSeconds: -1 }],
    ['a fractional position', { positionSeconds: 1.5 }],
    ['a position over the cap', { positionSeconds: 86_401 }],
    ['a missing versionId', { versionId: '' }],
  ])('reports %s', (_, change) => {
    table.videoPositions.push({ ...position(), ...change });
    expect(violationsOf('video-position-valid')).toHaveLength(1);
  });

  // A position is not a student record (research R-6): it may outlive its
  // item, and its student needs no activity count.
  it('is not a student record: an orphan position trips no other check', () => {
    table.users.push({ userId: 'someone' });
    table.videoPositions.push({
      ...position(),
      userId: 'someone',
      contentItemId: 'deleted-video',
    });
    expect(checkTableInvariants(table)).toEqual([]);
  });
});

describe('captions', () => {
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  const folder = `${prefix}/video`;
  const track = (language: string, overrides = {}) => ({
    trackId: `t-${language}`,
    nonce: 'n1',
    language,
    label: language,
    source: 'uploaded' as const,
    key: `${folder}/n1/captions/t-${language}.vtt`,
    isDefault: false,
    ...overrides,
  });
  const withTracks = (...tracks: ReturnType<typeof track>[]) => {
    item('video').captionTracks = tracks;
  };

  describe('6. video-transcode-state, caption attributes', () => {
    it('accepts a ready video with tracks, a status and a revision', () => {
      Object.assign(item('video'), {
        captionTracks: [track('en-US', { isDefault: true })],
        captionTracksRev: 2,
        captionsStatus: 'ready',
      });
      expect(checkTableInvariants(table)).toEqual([]);
    });

    it('accepts a ready video whose captioning is pending', () => {
      Object.assign(item('video'), {
        captionsStatus: 'pending',
        captionsPendingSince: T,
      });
      expect(checkTableInvariants(table)).toEqual([]);
    });

    it('reports a text item holding captionTracks', () => {
      item('text').captionTracks = [track('en-US', { isDefault: true })];
      expect(violationsOf('video-transcode-state')).toHaveLength(1);
      expect(violationsOf('video-transcode-state')[0].message).toMatch(
        /caption attributes are set on a text item/,
      );
    });

    it('reports a pending status on a pending video', () => {
      Object.assign(item('video'), {
        status: 'pending',
        s3Key: undefined,
        transcodePending: 'pending',
        transcodePendingSince: T,
        captionsStatus: 'pending',
        captionsPendingSince: T,
      });
      expect(violationsOf('video-transcode-state')).toEqual([
        expect.objectContaining({
          message: expect.stringMatching(/pending on a pending video/),
        }),
      ]);
    });

    it('reports a pending status without captionsPendingSince', () => {
      item('video').captionsStatus = 'pending';
      expect(violationsOf('video-transcode-state')[0].message).toMatch(
        /without captionsPendingSince/,
      );
    });

    it('reports captionsPendingSince without a pending status', () => {
      Object.assign(item('video'), {
        captionsStatus: 'ready',
        captionsPendingSince: T,
      });
      expect(violationsOf('video-transcode-state')).toHaveLength(1);
    });
  });

  describe('24. caption-tracks-valid', () => {
    it('accepts a video with no tracks, and a valid list', () => {
      expect(violationsOf('caption-tracks-valid')).toEqual([]);
      withTracks(track('en-US', { isDefault: true }), track('es-ES'));
      expect(violationsOf('caption-tracks-valid')).toEqual([]);
    });

    it('reports eleven tracks', () => {
      withTracks(
        ...Array.from({ length: 11 }, (_, i) =>
          track(`xx-${i}`, { isDefault: i === 0 }),
        ),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /11 caption tracks/,
      );
    });

    it('accepts the old version’s tracks while a replacement transcodes', () => {
      withTracks(track('en-US', { isDefault: true }));
      Object.assign(item('video'), {
        status: 'pending',
        s3Key: `${folder}/upload.mp4`,
        previousS3Key: `${folder}/n1/master.m3u8`,
        transcodePending: 'pending',
        transcodePendingSince: T,
      });
      expect(violationsOf('caption-tracks-valid')).toEqual([]);
    });

    it('still reports a track of neither version while one is replaced', () => {
      withTracks(
        track('en-US', {
          isDefault: true,
          nonce: 'older',
          key: `${folder}/older/captions/t.vtt`,
        }),
      );
      Object.assign(item('video'), {
        status: 'pending',
        s3Key: `${folder}/upload.mp4`,
        previousS3Key: `${folder}/n1/master.m3u8`,
        transcodePending: 'pending',
        transcodePendingSince: T,
      });
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /for version older, not the current n1/,
      );
    });

    it('reports a track whose nonce is not the current one', () => {
      withTracks(
        track('en-US', {
          isDefault: true,
          nonce: 'old',
          key: `${folder}/old/captions/t.vtt`,
        }),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /for version old, not the current n1/,
      );
    });

    it('reports two tracks in one language', () => {
      withTracks(
        track('en-US', { isDefault: true }),
        track('en-US', { trackId: 'other' }),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /two caption tracks in en-US/,
      );
    });

    it('reports no default, and two defaults', () => {
      withTracks(track('en-US'));
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /0 default/,
      );
      withTracks(
        track('en-US', { isDefault: true }),
        track('es-ES', { isDefault: true }),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /2 default/,
      );
    });

    it('reports a key outside the version’s captions folder', () => {
      withTracks(
        track('en-US', {
          isDefault: true,
          key: `${prefix}/other-item/n1/captions/t.vtt`,
        }),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /outside the version's captions folder/,
      );
    });
  });
});

describe('26. analytics-matches-records', () => {
  const violations = () =>
    checkAllInvariants(table).filter(
      (v) => v.invariant === 'analytics-matches-records',
    );

  it('passes when the aggregates equal the sums over the records', () => {
    expect(violations()).toEqual([]);
  });

  it('passes for a course with no enrolments and no items', () => {
    table.enrolments = [];
    table.itemCompletions = [];
    table.quizAttempts = [];
    table.quizSummaries = [];
    table.progress = [];
    table.courseStats = [];
    table.periodStats = [];
    table.lessonStats = [];
    table.quizQuestionStats = [];
    table.quizScoreStats = [];
    expect(violations()).toEqual([]);
  });

  it('reports an enrolments count that is off by one, with the course', () => {
    table.courseStats = [
      { courseId: 'c1', enrolments: 2, completed: 0, dropped: 0 },
    ];
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'SUMMARY' },
        message: 'enrolments is 2, but its records add up to 1',
      }),
    ]);
  });

  it('reports a completed count for a status nobody has', () => {
    table.courseStats = [
      { courseId: 'c1', enrolments: 1, completed: 1, dropped: 0 },
    ];
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'SUMMARY' },
        message: 'completed is 1, but its records add up to 0',
      }),
    ]);
  });

  it('expects a completed count for a completed enrolment', () => {
    table.enrolments[0].status = 'completed';
    expect(violations().map((v) => v.message)).toEqual([
      'completed is 0, but its records add up to 1',
    ]);
  });

  it('reports a missing summary for a course with enrolments', () => {
    table.courseStats = [];
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'SUMMARY' },
        message: 'enrolments is 0, but its records add up to 1',
      }),
    ]);
  });

  it('reports a day with the wrong number of active learners', () => {
    table.periodStats[1].activeLearners = 2;
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'DAY#2026-01-02' },
        message: 'activeLearners is 2, but its records add up to 1',
      }),
    ]);
  });

  it('expects a lesson count for a student partway through it', () => {
    table.lessonStats = [];
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'LESSON#l1' },
        message: 'inProgress is 0, but its records add up to 1',
      }),
    ]);
  });

  it('reports a lesson counted as completed that nobody completed', () => {
    table.lessonStats = [
      { courseId: 'c1', lessonId: 'l1', inProgress: 1, completed: 1 },
    ];
    expect(violations().map((v) => v.message)).toEqual([
      'completed is 1, but its records add up to 0',
    ]);
  });

  it('moves a lesson count with the status, and ignores not_started', () => {
    table.progress[0].status = 'completed';
    expect(
      violations()
        .map((v) => v.message)
        .sort(),
    ).toEqual([
      'completed is 0, but its records add up to 1',
      'inProgress is 1, but its records add up to 0',
    ]);
    table.progress[0].status = 'not_started';
    expect(violations().map((v) => v.message)).toEqual([
      'inProgress is 1, but its records add up to 0',
    ]);
  });

  it('counts nothing in lessons for a dropped student', () => {
    table.enrolments[0].status = 'dropped';
    expect(violations().map((v) => v.record)).toContainEqual({
      courseId: 'c1',
      item: 'LESSON#l1',
    });
    table.lessonStats = [];
    expect(
      violations().filter(
        (v) => (v.record as { item: string }).item === 'LESSON#l1',
      ),
    ).toEqual([]);
  });

  it('expects a miss count for a question answered wrongly', () => {
    table.quizQuestionStats[1].misses = 0;
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'QUIZ#quiz#Q#q2' },
        message: 'misses is 0, but its records add up to 1',
      }),
    ]);
  });

  it('reports an attempts count that is off for a question', () => {
    table.quizQuestionStats[0].attempts = 3;
    expect(violations().map((v) => v.message)).toEqual([
      'attempts is 3, but its records add up to 2',
    ]);
  });

  it('reports a missing item for a question that was answered', () => {
    table.quizQuestionStats = [];
    expect(violations().map((v) => v.record)).toEqual(
      expect.arrayContaining([
        { courseId: 'c1', item: 'QUIZ#quiz#Q#q1' },
        { courseId: 'c1', item: 'QUIZ#quiz#Q#q2' },
      ]),
    );
  });

  it('reports a student counted in the wrong score band', () => {
    table.quizScoreStats[0].band8 = 0;
    table.quizScoreStats[0].band4 = 1;
    expect(
      violations()
        .map((v) => v.message)
        .sort(),
    ).toEqual([
      'band4 is 1, but its records add up to 0',
      'band8 is 0, but its records add up to 1',
    ]);
  });

  it('moves a student’s band when their best score rises', () => {
    table.quizSummaries[0].bestScore = 100;
    expect(violations().map((v) => v.message)).toEqual(
      expect.arrayContaining([
        'band8 is 1, but its records add up to 0',
        'band9 is 0, but its records add up to 1',
      ]),
    );
  });

  it('reports aggregates for a course that has no records', () => {
    table.courseStats.push({
      courseId: 'gone',
      enrolments: 1,
      completed: 0,
      dropped: 0,
    });
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'gone', item: 'SUMMARY' },
      }),
    ]);
  });
});

describe('notifications', () => {
  const NOW = '2026-11-16T12:00:00.000Z';
  const ID = 'a1b2c3d4e5f60718';
  const POSITION = `2026-11-16T10:00:00.000Z#${ID}`;

  const notification = (
    over: Partial<TableSnapshot['notifications'][number]> = {},
  ): TableSnapshot['notifications'][number] => ({
    userId: 'student',
    occurredAt: '2026-11-16T10:00:00.000Z',
    id: ID,
    type: 'assignment.returned',
    link: { portal: 'student', path: '/learn/c1/lesson/l1' },
    email: { state: 'skipped', reason: 'never' },
    createdAt: '2026-11-16T10:00:00.000Z',
    ...over,
  });

  // One unread notification and its state, which is consistent.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    table.notifications = [notification()];
    table.notificationStates = [{ userId: 'student', unreadCount: 1 }];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds nothing wrong with a clean table', () => {
    expect(checkTableInvariants(table)).toEqual([]);
  });

  describe('27. notification-unread-count-matches', () => {
    it('reports a count too high', () => {
      table.notificationStates[0].unreadCount = 2;
      expectOnly('notification-unread-count-matches', /2, but 1 notifications/);
    });

    it('reports a count too low', () => {
      table.notificationStates[0].unreadCount = 0;
      expectOnly('notification-unread-count-matches', /0, but 1 notifications/);
    });

    it('does not count what is read, by readAt or by readThrough', () => {
      table.notifications = [
        notification({ readAt: NOW }),
        notification({
          id: 'b'.repeat(16),
          occurredAt: '2026-11-16T09:00:00.000Z',
        }),
        notification({
          id: 'c'.repeat(16),
          occurredAt: '2026-11-16T11:00:00.000Z',
        }),
      ];
      // 09:00 is at or before readThrough, the first has readAt; only 11:00
      // is unread.
      table.notificationStates = [
        {
          userId: 'student',
          unreadCount: 1,
          readThrough: `2026-11-16T09:30:00.000Z#${'0'.repeat(16)}`,
        },
      ];
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('28. notification-shape', () => {
    it('reports a sort key that is not <occurredAt>#<id>', () => {
      table.notifications[0].id = 'not-hex';
      expectOnly('notification-shape', /sort key/);

      table = consistentTable();
      table.notifications = [notification({ occurredAt: '2026-11-16' })];
      table.notificationStates = [{ userId: 'student', unreadCount: 1 }];
      expectOnly('notification-shape', /sort key/);
    });

    it('reports an unregistered type, and a path without a leading slash', () => {
      table.notifications[0].type = 'nope.nothing';
      expectOnly('notification-shape', /not registered/);

      table.notifications[0].type = 'assignment.returned';
      table.notifications[0].link = { portal: 'student', path: 'learn' };
      expectOnly('notification-shape', /does not start with/);
    });

    it('reports a sent email without a message id', () => {
      table.notifications[0].email = { state: 'sent', sentAt: NOW };
      expectOnly('notification-shape', /sent without sentAt and messageId/);
    });

    it('reports skipped and failed emails without a reason', () => {
      table.notifications[0].email = { state: 'skipped' };
      expectOnly('notification-shape', /skipped without a reason/);
      table.notifications[0].email = { state: 'failed' };
      expectOnly('notification-shape', /failed without a reason/);
    });

    it('reports an email sending for over an hour, not one just claimed', () => {
      table.notifications[0].email = {
        state: 'sending',
        claimedAt: '2026-11-16T10:30:00.000Z',
      };
      expectOnly('notification-shape', /sending for over an hour/);

      table.notifications[0].email = { state: 'sending', claimedAt: NOW };
      expect(broken().invariants).toEqual([]);
    });

    it('reports a pending email over an hour old', () => {
      table.notifications[0].email = { state: 'pending' };
      table.notifications[0].createdAt = '2026-11-16T10:30:00.000Z';
      expectOnly('notification-shape', /still pending/);
    });

    it('passes a pending email that was just created', () => {
      table.notifications[0].email = { state: 'pending' };
      table.notifications[0].createdAt = '2026-11-16T11:59:00.000Z';
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('29. notification-state-exists', () => {
    it('reports a user with notifications and no state', () => {
      table.notificationStates = [];
      expectOnly('notification-state-exists', /no notificationState/);
    });

    it('reports a negative count', () => {
      table.notifications = [];
      table.notificationStates[0].unreadCount = -1;
      const { violations } = broken();
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(/-1 is not a count/),
      );
    });

    it('reports a readThrough that is not a position', () => {
      table.notifications[0].readAt = NOW;
      table.notificationStates[0] = {
        userId: 'student',
        unreadCount: 0,
        readThrough: 'yesterday',
      };
      expectOnly('notification-state-exists', /not a position/);
    });

    it('accepts a valid readThrough', () => {
      table.notificationStates[0] = {
        userId: 'student',
        unreadCount: 0,
        readThrough: POSITION,
      };
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('30. notification-preference-shape', () => {
    it('accepts a preference for a registered type that can change', () => {
      table.notificationPreferences = [
        { userId: 'student', type: 'review.received' },
      ];
      expect(broken().invariants).toEqual([]);
    });

    it('reports an unregistered type', () => {
      table.notificationPreferences = [{ userId: 'student', type: 'nope.x' }];
      expectOnly('notification-preference-shape', /not registered/);
    });

    it('reports a preference for a required type', () => {
      const type = 'test.required';
      NOTIFICATION_TYPES[type] = {
        id: type,
        name: 'Required',
        description: 'Always sent',
        params: [],
        emailPolicy: 'required',
        build: () => ({
          title: 't',
          body: 'b',
          link: { portal: 'student', path: '/' },
        }),
      };
      try {
        table.notificationPreferences = [{ userId: 'student', type }];
        expectOnly('notification-preference-shape', /required/);
      } finally {
        delete NOTIFICATION_TYPES[type];
      }
    });
  });

  describe('31. notification-broadcast-done-complete', () => {
    const broadcast = (
      over: Partial<TableSnapshot['notificationBroadcasts'][number]>,
    ): TableSnapshot['notificationBroadcasts'][number] => ({
      id: 'b'.repeat(16),
      type: 'announcement.posted',
      courseId: 'c1',
      dedupeKey: 'k',
      occurredAt: '2026-11-16T11:59:00.000Z',
      status: 'pending',
      createdAt: '2026-11-16T11:59:00.000Z',
      ...over,
    });

    it('passes a done broadcast with completedAt, and a recent pending one', () => {
      table.notificationBroadcasts = [
        broadcast({ status: 'done', completedAt: NOW }),
        broadcast({ id: 'c'.repeat(16) }),
      ];
      expect(broken().invariants).toEqual([]);
    });

    it('reports a done broadcast without completedAt', () => {
      table.notificationBroadcasts = [broadcast({ status: 'done' })];
      expectOnly('notification-broadcast-done-complete', /without completedAt/);
    });

    it('reports a stuck broadcast', () => {
      table.notificationBroadcasts = [
        broadcast({ createdAt: '2026-11-16T10:00:00.000Z' }),
      ];
      expectOnly('notification-broadcast-done-complete', /over an hour/);
    });
  });

  describe('32. announcement-shape', () => {
    const AT = '2026-11-15T10:00:00.000Z';
    const ID = `${new Date(AT)
      .getTime()
      .toString(16)
      .padStart(12, '0')
      .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-000000000001`;
    const announcement = (
      over: Partial<TableSnapshot['announcements'][number]> = {},
    ): TableSnapshot['announcements'][number] => ({
      courseId: 'c1',
      announcementId: ID,
      title: 'Welcome',
      body: '{"type":"doc","content":[{"type":"paragraph"}]}',
      authorId: 'instructor',
      createdAt: AT,
      version: 1,
      ...over,
    });
    const broadcastFor = (a: TableSnapshot['announcements'][number]) => ({
      id: 'b'.repeat(16),
      type: 'announcement.posted',
      courseId: a.courseId,
      dedupeKey: a.announcementId,
      occurredAt: a.createdAt,
      status: 'done' as const,
      completedAt: NOW,
      createdAt: a.createdAt,
    });
    const hold = (a: TableSnapshot['announcements'][number]) => {
      table.announcements = [a];
      table.notificationBroadcasts = [broadcastFor(a)];
    };

    it('passes a well-formed announcement, edited or not', () => {
      hold(announcement());
      expect(broken().invariants).toEqual([]);
      hold(announcement({ version: 3, editedAt: '2026-11-15T11:00:00.000Z' }));
      expect(broken().invariants).toEqual([]);
    });

    it.each([
      [
        'its course does not exist',
        { courseId: 'gone' },
        /course does not exist/,
      ],
      ['an id that is not a UUID v7', { announcementId: 'nope' }, /UUID v7/],
      [
        'a createdAt other than the id time',
        { createdAt: '2026-11-15T10:00:01.000Z' },
        /UUID v7/,
      ],
      ['an empty title', { title: '  ' }, /title/],
      ['a title over 120 characters', { title: 'x'.repeat(121) }, /title/],
      ['a body that is not JSON', { body: 'plain' }, /body/],
      [
        'a body that is not a document',
        { body: '{"type":"paragraph"}' },
        /body/,
      ],
      [
        'a body over 20,000 characters',
        { body: `{"type":"doc","pad":"${'x'.repeat(20_000)}"}` },
        /body/,
      ],
      ['no author', { authorId: '' }, /authorId/],
      ['a version below 1', { version: 0 }, /version/],
      [
        'a version above 1 without editedAt',
        { version: 2 },
        /without editedAt/,
      ],
      [
        'editedAt at version 1',
        { editedAt: '2026-11-15T11:00:00.000Z' },
        /at version 1/,
      ],
      [
        'editedAt before createdAt',
        { version: 2, editedAt: '2026-11-15T09:00:00.000Z' },
        /before createdAt/,
      ],
    ])('reports %s', (_, over, message) => {
      const a = announcement(over as never);
      table.announcements = [a];
      table.notificationBroadcasts = [broadcastFor(announcement())];
      table.notificationBroadcasts[0].courseId = a.courseId;
      table.notificationBroadcasts[0].dedupeKey = a.announcementId;
      table.notificationBroadcasts[0].occurredAt = a.createdAt;
      const { violations } = broken();

      expect(violations.map((v) => v.invariant)).toContain(
        'announcement-shape',
      );
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
      expect(
        violations.find((v) => v.invariant === 'announcement-shape')?.record,
      ).toEqual({ courseId: a.courseId, announcementId: a.announcementId });
    });
  });

  describe('33. announcement-has-broadcast', () => {
    const AT = '2026-11-15T10:00:00.000Z';
    const ID = `${new Date(AT)
      .getTime()
      .toString(16)
      .padStart(12, '0')
      .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-000000000001`;
    const announcement: TableSnapshot['announcements'][number] = {
      courseId: 'c1',
      announcementId: ID,
      title: 'Welcome',
      body: '{"type":"doc","content":[{"type":"paragraph"}]}',
      authorId: 'instructor',
      createdAt: AT,
      version: 1,
    };
    const broadcast = (
      over: Partial<TableSnapshot['notificationBroadcasts'][number]> = {},
    ): TableSnapshot['notificationBroadcasts'][number] => ({
      id: 'b'.repeat(16),
      type: 'announcement.posted',
      courseId: 'c1',
      dedupeKey: ID,
      occurredAt: AT,
      status: 'done',
      completedAt: NOW,
      createdAt: AT,
      ...over,
    });

    it('passes an announcement with its broadcast', () => {
      table.announcements = [announcement];
      table.notificationBroadcasts = [broadcast()];
      expect(broken().invariants).toEqual([]);
    });

    it('reports an announcement whose broadcast was deleted', () => {
      table.announcements = [announcement];
      expectOnly('announcement-has-broadcast', /no announcement.posted/);
    });

    it.each([
      ['another dedupe key', { dedupeKey: 'other' }],
      ['another type', { type: 'review.received' }],
      ['another course', { courseId: 'c2' }],
    ])('reports a broadcast with %s', (_, over) => {
      table.announcements = [announcement];
      table.notificationBroadcasts = [broadcast(over)];
      expectOnly('announcement-has-broadcast', /no announcement.posted/);
    });

    it('reports a broadcast with another time', () => {
      table.announcements = [announcement];
      table.notificationBroadcasts = [
        broadcast({ occurredAt: '2026-11-15T10:00:01.000Z' }),
      ];
      expectOnly('announcement-has-broadcast', /occurredAt/);
    });

    it('does not report a broadcast whose announcement was deleted', () => {
      table.notificationBroadcasts = [broadcast()];
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('34. course-category-exists', () => {
    it('reports a course whose category does not exist', () => {
      table.courses[0].categoryId = 'gone';
      expectOnly('course-category-exists', /names no category/);
    });

    it('passes a course in an existing category, archived or not', () => {
      table.categories = [
        {
          categoryId: 'cat',
          name: 'Science',
          slug: 'science',
          status: 'archived',
        },
      ];
      table.categoryClaims = [
        { claim: 'slug#science', categoryId: 'cat' },
        { claim: 'name#science', categoryId: 'cat' },
      ];
      table.courses[0].categoryId = 'cat';
      expect(broken().invariants).toEqual([]);
    });

    it('does not report a course with no catalogue fields', () => {
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('35. category-claims-consistent', () => {
    const category = {
      categoryId: 'cat',
      name: 'Data  Science',
      slug: 'data-science',
      status: 'active' as const,
    };
    const claims = [
      { claim: 'slug#data-science', categoryId: 'cat' },
      { claim: 'name#data science', categoryId: 'cat' },
    ];
    beforeEach(() => {
      table.categories = [category];
      table.categoryClaims = [...claims];
    });

    it('passes a category with its two claims', () => {
      expect(broken().invariants).toEqual([]);
    });

    it('reports a category missing its slug claim', () => {
      table.categoryClaims = [claims[1]];
      expectOnly('category-claims-consistent', /0 slug claims/);
    });

    it('reports a category missing its name claim', () => {
      table.categoryClaims = [claims[0]];
      expectOnly('category-claims-consistent', /0 name claims/);
    });

    it('reports a claim pointing to no category', () => {
      table.categoryClaims = [
        ...claims,
        { claim: 'name#other', categoryId: 'missing' },
      ];
      expectOnly('category-claims-consistent', /points to no category/);
    });

    it('reports a claim whose slug differs from its category', () => {
      table.categoryClaims = [
        { claim: 'slug#other', categoryId: 'cat' },
        claims[1],
      ];
      expectOnly('category-claims-consistent', /not for its slug/);
    });

    it('reports a claim whose name differs from its category', () => {
      table.categoryClaims = [
        claims[0],
        { claim: 'name#other', categoryId: 'cat' },
      ];
      expectOnly('category-claims-consistent', /not for its name/);
    });
  });

  describe('36. course-catalogue-shape', () => {
    it('passes a course with valid fields', () => {
      Object.assign(table.courses[0], {
        tags: ['data science', 'sql'],
        level: 'beginner',
        language: 'en',
        durationHours: 500,
      });
      expect(broken().invariants).toEqual([]);
    });

    it.each([
      ['an unnormalised tag', { tags: [' SQL'] }],
      ['a duplicate tag', { tags: ['sql', 'sql'] }],
      ['nine tags', { tags: Array.from({ length: 9 }, (_, i) => `tag${i}`) }],
      ['a bad level', { level: 'expert' }],
      ['a bad language', { language: 'xx' }],
      ['a duration of 0', { durationHours: 0 }],
      ['a duration of 501', { durationHours: 501 }],
      ['a fractional duration', { durationHours: 2.5 }],
    ])('reports %s', (_, over) => {
      Object.assign(table.courses[0], over);
      expectOnly('course-catalogue-shape');
    });
  });

  describe('37 to 39. reviews and course ratings', () => {
    const REVIEWED = '2026-11-18T10:00:00.000Z';
    const review = (
      over: Partial<TableSnapshot['reviews'][number]> = {},
    ): TableSnapshot['reviews'][number] => ({
      courseId: 'c1',
      userId: 'student',
      rating: 4,
      reviewerName: 'Alex T.',
      status: 'visible',
      version: 1,
      ...over,
    });
    // Holds one review and the tally that counts it.
    const hold = (r = review(), tally?: Record<string, number>) => {
      table.reviews = [r];
      table.courseRatings = [
        { courseId: r.courseId, [`stars${r.rating}`]: 1, ...tally },
      ];
    };

    it('passes a consistent review and tally', () => {
      hold();
      expect(broken().invariants).toEqual([]);
    });

    it('passes the cases that are not violations', () => {
      // A review in an archived course, by a student who has since dropped.
      table.courses[0].status = 'archived';
      table.enrolments[0].status = 'dropped';
      hold();
      expect(broken().invariants).not.toContain('review-shape');
      expect(broken().invariants).not.toContain('review-has-enrolment');
      expect(broken().invariants).not.toContain(
        'course-rating-matches-reviews',
      );
    });

    it('passes an all-zero tally, and a removed review with a response', () => {
      table.reviews = [
        review({
          status: 'removed',
          removedAt: REVIEWED,
          removedBy: 'admin',
          removedReason: 'Spam',
          responseText: 'Thank you',
          responseAt: REVIEWED,
          responseById: 'teacher',
          responseByName: 'Teacher',
        }),
      ];
      table.courseRatings = [
        {
          courseId: 'c1',
          stars1: 0,
          stars2: 0,
          stars3: 0,
          stars4: 0,
          stars5: 0,
        },
      ];
      expect(broken().invariants).toEqual([]);
    });

    it('lets a student whose only record is a review keep every student-record rule', () => {
      table.enrolments.push({
        courseId: 'c1',
        userId: 'reviewer',
        status: 'active',
        progressPercent: 0,
        createdAt: T,
      });
      table.reviews = [review({ userId: 'reviewer' })];
      table.courseRatings = [{ courseId: 'c1', stars4: 1 }];

      // No student-records-* or activity-count violation, and the item counts
      // are unchanged by the review.
      expect(broken().invariants).toEqual([]);
    });

    it('leaves instructor-course-updated-at satisfied by a review and its rating', () => {
      hold();
      expect(broken().invariants).not.toContain('instructor-course-updated-at');
      expect(table.courses[0].updatedAt).toBe(T);
    });

    describe('review-shape', () => {
      it.each([
        ['a rating of 0', { rating: 0 }, /rating 0/],
        ['a rating of 6', { rating: 6 }, /rating 6/],
        ['a rating of 3.5', { rating: 3.5 }, /rating 3.5/],
        ['a version of 0', { version: 0 }, /version/],
        ['text over 2,000 characters', { text: 'a'.repeat(2001) }, /text/],
        ['no reviewer name', { reviewerName: '' }, /reviewerName/],
        [
          'a removal reason with no removal',
          { removedReason: 'Spam' },
          /removal/,
        ],
        [
          'a removed review with no reason',
          { status: 'removed' as const },
          /removed without/,
        ],
        [
          'a half-set response',
          { responseText: 'Thanks', responseAt: REVIEWED },
          /response/,
        ],
        [
          'a response over 1,000 characters',
          {
            responseText: 'a'.repeat(1001),
            responseAt: REVIEWED,
            responseById: 't',
            responseByName: 'T',
          },
          /responseText/,
        ],
        [
          'a visible review with removal fields',
          { removedAt: REVIEWED, removedBy: 'a', removedReason: 'Spam' },
          /visible but/,
        ],
      ])('reports %s', (_, over, message) => {
        table.reviews = [review(over as never)];
        // Keep the tally agreeing, so only the shape is wrong.
        table.courseRatings = [];
        const found = broken();
        expect(found.invariants).toContain('review-shape');
        expect(found.messages).toContainEqual(expect.stringMatching(message));
      });
    });

    describe('review-has-enrolment', () => {
      it('reports a review whose student has no enrolment', () => {
        hold(review({ userId: 'stranger' }));
        expectOnly('review-has-enrolment', /no enrolment/);
      });

      it('reports a review whose course does not exist', () => {
        table.enrolments.push({ ...table.enrolments[0], courseId: 'gone' });
        hold(review({ courseId: 'gone' }));
        const found = broken();
        expect(found.invariants).toContain('review-has-enrolment');
        expect(found.messages).toContainEqual(
          expect.stringMatching(/course does not exist/),
        );
      });
    });

    describe('course-rating-matches-reviews', () => {
      it('reports a counter one too high', () => {
        hold(review(), { stars4: 2 });
        expectOnly('course-rating-matches-reviews', /stars4 is 2, but 1/);
      });

      it('reports a counter one too low', () => {
        hold(review(), { stars4: 0 });
        expectOnly('course-rating-matches-reviews', /stars4 is 0, but 1/);
      });

      it('reports a visible review with no tally at all', () => {
        table.reviews = [review()];
        expectOnly('course-rating-matches-reviews', /stars4 is 0, but 1/);
      });

      it('reports a counter that counts a removed review', () => {
        table.reviews = [
          review({
            status: 'removed',
            removedAt: REVIEWED,
            removedBy: 'admin',
            removedReason: 'Spam',
          }),
        ];
        table.courseRatings = [{ courseId: 'c1', stars4: 1 }];
        expectOnly('course-rating-matches-reviews', /stars4 is 1, but 0/);
      });

      it('reports a tally for a course that does not exist', () => {
        table.courseRatings = [{ courseId: 'gone' }];
        expectOnly('course-rating-matches-reviews', /does not exist/);
      });
    });
  });
});

describe('discussion', () => {
  const v7 = (at: string, n: number) => {
    const hex = new Date(at).getTime().toString(16).padStart(12, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-${String(n).padStart(12, '0')}`;
  };
  const AT1 = '2026-11-16T10:00:00.000Z';
  const AT2 = '2026-11-16T10:05:00.000Z';
  const QID = v7(AT1, 1);
  const RID = v7(AT2, 2);
  type Post = TableSnapshot['discussionPosts'][number];

  const question = (over: Partial<Post> = {}): Post => ({
    courseId: 'c1',
    lessonId: 'l1',
    moduleId: 'm1',
    kind: 'question',
    threadId: QID,
    postId: QID,
    authorId: 'asker',
    authorName: 'Ada',
    authorIsInstructor: false,
    title: 'Why?',
    body: 'Because.',
    state: 'shown',
    replyCount: 1,
    instructorReplyCount: 0,
    voteCount: 1,
    createdAt: AT1,
    ...over,
  });
  const reply = (over: Partial<Post> = {}): Post => ({
    courseId: 'c1',
    lessonId: 'l1',
    moduleId: 'm1',
    kind: 'reply',
    threadId: QID,
    postId: RID,
    authorId: 'helper',
    authorName: 'Bo',
    authorIsInstructor: false,
    body: 'Like this.',
    state: 'shown',
    replyCount: 0,
    instructorReplyCount: 0,
    voteCount: 0,
    createdAt: AT2,
    ...over,
  });
  const vote = (over = {}) => ({
    courseId: 'c1',
    userId: 'voter',
    lessonId: 'l1',
    threadId: QID,
    postId: QID,
    ...over,
  });

  // An unanswered question with one reply (by a student) and one vote.
  beforeEach(() => {
    table.discussionPosts = [question({ unanswered: 'c1' }), reply()];
    table.discussionVotes = [vote()];
  });

  const hold = (posts: Post[], votes = table.discussionVotes) => {
    table.discussionPosts = posts;
    table.discussionVotes = votes;
  };

  it('passes a consistent thread', () => {
    expect(broken().invariants).toEqual([]);
  });

  it('is not student activity: a student with only posts and votes is not counted and trips no student-records check', () => {
    table.discussionPosts.push(
      question({
        postId: v7(AT2, 3),
        threadId: v7(AT2, 3),
        createdAt: AT2,
        authorId: 'stranger',
        replyCount: 0,
        voteCount: 1,
        unanswered: 'c1',
      }),
    );
    table.discussionVotes.push(
      vote({ userId: 'stranger', postId: QID }),
      vote({ userId: 'voter', threadId: v7(AT2, 3), postId: v7(AT2, 3) }),
    );
    table.discussionPosts[0].voteCount = 2;
    const { invariants } = broken();
    expect(invariants).toEqual([]);
    expect(
      checkTableInvariants(table).filter(
        (v) =>
          v.invariant === 'activity-count-matches-students' ||
          v.invariant.startsWith('student-records-'),
      ),
    ).toEqual([]);
  });

  it('leaves a certificate-style record of another entity untouched', () => {
    const before = checkTableInvariants(table);
    table.certificates.push({
      userId: 'asker',
      courseId: 'c1',
      certificateId: '0123456789ABCDEF',
      learnerName: 'Ada',
      courseTitle: 'Intro',
      completedAt: AT1,
      issuedAt: AT1,
    });
    const discussion = (vs: ReturnType<typeof checkTableInvariants>) =>
      vs.filter((v) => v.invariant.startsWith('discussion-'));
    expect(discussion(checkTableInvariants(table))).toEqual(discussion(before));
  });

  describe('37. discussion-post-shape', () => {
    it.each([
      ['a question without a title', question({ title: undefined }), /title/],
      ['a question with a blank title', question({ title: '' }), /title/],
      [
        'a question with a 121 character title',
        question({ title: 'a'.repeat(121) }),
        /title/,
      ],
      [
        'a question whose postId is not its threadId',
        question({ threadId: v7(AT1, 9) }),
        /postId is not its threadId/,
      ],
      ['a post without a body', question({ body: undefined }), /body/],
      [
        'a body of 4,001 characters',
        question({ body: 'a'.repeat(4001) }),
        /body/,
      ],
      [
        'a post without an author name',
        question({ authorName: '' }),
        /authorName/,
      ],
      [
        'a post with an unknown state',
        question({ state: 'gone' as never }),
        /state/,
      ],
      [
        'a postId that is not a UUID v7',
        question({ postId: 'x', threadId: 'x' }),
        /UUID v7/,
      ],
      [
        'a postId whose time differs from createdAt',
        question({ createdAt: AT2 }),
        /UUID v7/,
      ],
      [
        'a deleted post that still has a body',
        question({ state: 'deleted', title: undefined, replyCount: 1 }),
        /deleted post still has a body/,
      ],
      [
        'a deleted question that still has a title',
        question({ state: 'deleted', body: undefined }),
        /deleted question still has a title/,
      ],
      [
        'more than 20 reporters',
        question({
          reportedBy: Array.from({ length: 21 }, (_, i) => `u${i}`),
          reported: 'c1',
        }),
        /21 reporters/,
      ],
      [
        'the author among the reporters',
        question({ reportedBy: ['asker'], reported: 'c1' }),
        /author is among/,
      ],
    ])('reports %s', (_, post, message) => {
      const { violations } = (() => {
        hold([post, reply()]);
        return broken();
      })();
      expect(violations.map((v) => v.invariant)).toContain(
        'discussion-post-shape',
      );
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });

    it.each([
      ['a title', { title: 'Hello' }, /reply has a title/],
      ['an acceptedPostId', { acceptedPostId: RID }, /acceptedPostId/],
      ['an unanswered mark', { unanswered: 'c1' }, /unanswered/],
      ['a reply count', { replyCount: 1 }, /reply counts/],
    ])('reports a reply with %s', (_, over, message) => {
      hold([question({ unanswered: 'c1' }), reply(over)]);
      const { violations } = broken();
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });

    it('passes a deleted reply with no text, and 4,000 characters', () => {
      hold([
        question({
          unanswered: 'c1',
          body: 'a'.repeat(4000),
          replyCount: 0,
        }),
        reply({ state: 'deleted', body: undefined }),
      ]);
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('38. discussion-thread-links', () => {
    it('reports a reply with no question', () => {
      hold([reply()], []);
      expectOnly('discussion-thread-links', /question does not exist/);
    });

    it('reports a post whose lesson is missing', () => {
      table.lessons = table.lessons.filter((l) => l.lessonId !== 'l1');
      table.discussionPosts = [
        question({ unanswered: 'c1', lessonId: 'gone' }),
        reply({ lessonId: 'gone' }),
      ];
      table.discussionVotes = [vote({ lessonId: 'gone' })];
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/lesson does not exist/),
      );
    });

    it('is not a violation that the lesson is archived', () => {
      const lesson = table.lessons.find((l) => l.lessonId === 'l1');
      if (!lesson) throw new Error('no lesson');
      lesson.archivedAt = AT2;
      expect(
        checkTableInvariants(table).filter((v) =>
          v.invariant.startsWith('discussion-'),
        ),
      ).toEqual([]);
    });

    it('reports a wrong moduleId', () => {
      hold([question({ unanswered: 'c1', moduleId: 'other' }), reply()]);
      expectOnly('discussion-thread-links', /moduleId is other/);
    });
  });

  describe('39. discussion-counts-match', () => {
    it.each([
      ['replyCount too high', { replyCount: 2 }, /replyCount is 2/],
      ['replyCount too low', { replyCount: 0 }, /replyCount is 0/],
      [
        'instructorReplyCount too high',
        { instructorReplyCount: 1 },
        /instructorReplyCount is 1/,
      ],
      ['voteCount too high', { voteCount: 2 }, /voteCount is 2/],
      ['voteCount too low', { voteCount: 0 }, /voteCount is 0/],
    ])('reports %s', (_, over, message) => {
      hold([question({ unanswered: 'c1', ...over }), reply()]);
      const { violations } = broken();
      expect(violations.map((v) => v.invariant)).toContain(
        'discussion-counts-match',
      );
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });

    it('does not count a hidden reply, and counts an instructor reply', () => {
      hold([
        question({ replyCount: 1, instructorReplyCount: 1 }),
        reply({ authorIsInstructor: true }),
        reply({
          postId: v7(AT2, 5),
          state: 'hidden',
          authorIsInstructor: true,
        }),
      ]);
      expect(broken().invariants).toEqual([]);
    });

    it('reports a reply count of 501', () => {
      const replies = Array.from({ length: 501 }, (_, i) =>
        reply({ postId: v7(AT2, 100 + i) }),
      );
      hold([question({ unanswered: 'c1', replyCount: 501 }), ...replies]);
      const { messages } = broken();
      expect(messages).toContainEqual(expect.stringMatching(/more than 500/));
    });

    it('reports a post whose votes name another lesson', () => {
      table.discussionVotes = [vote({ lessonId: 'other' })];
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/voteCount is 1, but it has 0 votes/),
      );
    });
  });

  describe('40. discussion-accepted-valid', () => {
    const accepted = (over: Partial<Post> = {}) =>
      question({ acceptedPostId: RID, ...over });

    it('passes an accepted shown reply', () => {
      hold([accepted(), reply()]);
      expect(broken().invariants).toEqual([]);
    });

    it.each([
      [
        'a hidden reply',
        [accepted({ replyCount: 0 }), reply({ state: 'hidden' })],
        /is hidden/,
      ],
      [
        'a reply of another question',
        [
          accepted({ replyCount: 0, unanswered: undefined }),
          reply({ threadId: v7(AT1, 7) }),
          question({
            postId: v7(AT1, 7),
            threadId: v7(AT1, 7),
            unanswered: 'c1',
            replyCount: 1,
            voteCount: 0,
          }),
        ],
        /another question/,
      ],
      ['a missing reply', [accepted({ replyCount: 0 })], /does not exist/],
      [
        'a deleted question',
        [
          accepted({
            state: 'deleted',
            title: undefined,
            body: undefined,
            replyCount: 0,
          }),
        ],
        /deleted question still has an accepted/,
      ],
    ])('reports an acceptedPostId naming %s', (_, posts, message) => {
      hold(posts as Post[], []);
      const { violations } = broken();
      expect(violations.map((v) => v.invariant)).toContain(
        'discussion-accepted-valid',
      );
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });
  });

  describe('41. discussion-unanswered-matches', () => {
    it('reports `unanswered` on an answered question', () => {
      hold([
        question({ unanswered: 'c1', instructorReplyCount: 1 }),
        reply({ authorIsInstructor: true }),
      ]);
      expectOnly('discussion-unanswered-matches', /not unanswered/);
    });

    it('reports an unanswered question that is not marked', () => {
      hold([question()]);
      table.discussionPosts[0].replyCount = 0;
      table.discussionPosts = [question({ replyCount: 0 })];
      expectOnly('discussion-unanswered-matches', /is not marked/);
    });

    it('reports an `unanswered` flag that is not the courseId', () => {
      hold([question({ unanswered: 'other' }), reply()]);
      table.discussionPosts[1].state = 'hidden';
      table.discussionPosts[0].replyCount = 0;
      expectOnly('discussion-unanswered-matches', /not its courseId/);
    });

    it('reports `unanswered` on a hidden question', () => {
      hold([question({ state: 'hidden', unanswered: 'c1' }), reply()]);
      expectOnly('discussion-unanswered-matches', /not unanswered/);
    });

    it('reports `unanswered` on a reply', () => {
      hold([question({ unanswered: 'c1' }), reply({ unanswered: 'c1' })]);
      expect(broken().violations.map((v) => v.invariant)).toContain(
        'discussion-unanswered-matches',
      );
    });

    it('passes an accepted question and a hidden one without the mark', () => {
      hold([question({ acceptedPostId: RID }), reply()]);
      expect(broken().invariants).toEqual([]);
      hold([question({ state: 'hidden' }), reply()]);
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('42. discussion-votes-valid', () => {
    it('reports a vote for a missing post', () => {
      table.discussionVotes = [
        vote(),
        vote({ postId: v7(AT1, 8), userId: 'x' }),
      ];
      expect(broken().violations.map((v) => v.invariant)).toContain(
        'discussion-votes-valid',
      );
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/post does not exist/),
      );
    });

    it("reports a vote by the post's author", () => {
      table.discussionVotes = [vote({ userId: 'asker' })];
      expectOnly('discussion-votes-valid', /voter is the post's author/);
    });

    it('reports a vote whose ids differ from its post', () => {
      table.discussionVotes = [vote({ lessonId: 'other' })];
      const { violations } = broken();
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(/lessonId or threadId differs/),
      );
      table.discussionVotes = [vote({ threadId: v7(AT1, 6) })];
      expect(broken().messages).toContainEqual(
        expect.stringMatching(/lessonId or threadId differs/),
      );
    });
  });

  describe('43. discussion-reports-valid', () => {
    it('passes a reported post', () => {
      hold([
        question({
          unanswered: 'c1',
          reportedBy: ['u1'],
          reported: 'c1',
        }),
        reply(),
      ]);
      expect(broken().invariants).toEqual([]);
    });

    it('reports a `reported` flag that is not the courseId', () => {
      hold([
        question({
          unanswered: 'c1',
          reportedBy: ['u1'],
          reported: 'other',
        }),
        reply(),
      ]);
      expectOnly('discussion-reports-valid', /not its courseId/);
    });

    it('reports `reported` without reporters', () => {
      hold([question({ unanswered: 'c1', reported: 'c1' }), reply()]);
      expectOnly('discussion-reports-valid', /without reporters/);
    });

    it('reports reporters without the flag', () => {
      hold([question({ unanswered: 'c1', reportedBy: ['u1'] }), reply()]);
      expectOnly('discussion-reports-valid', /not marked reported/);
    });
  });
});

describe('violationId', () => {
  it('is the same for the same violation found twice, and differs otherwise', () => {
    table.courseInstructors = [];
    const [first] = checkTableInvariants(table);
    const [again] = checkTableInvariants(table);
    expect(violationId(first)).toBe(violationId(again));
    expect(violationId({ ...first, record: { courseId: 'c2' } })).not.toBe(
      violationId(first),
    );
  });
});
