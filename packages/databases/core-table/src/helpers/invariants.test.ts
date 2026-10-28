/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkTableInvariants,
  type InvariantName,
  type TableSnapshot,
  violationId,
} from './invariants.js';

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
  lessons: [{ ...ids, ...shown, order: 1, lastChildOrder: 4 }],
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
      scorePercent: 40,
      passed: false,
      submittedAt: AT.a1,
    },
    {
      ...ids,
      userId: 'student',
      contentItemId: 'quiz',
      attemptId: 'a2',
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
  users: [{ userId: 'teacher' }, { userId: 'student' }],
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

// The invariants broken, each once, with the messages.
const broken = () => {
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
        users: [],
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
      table.lessons.push({ ...ids, ...shown, lessonId: 'l2', order: 1 });
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
