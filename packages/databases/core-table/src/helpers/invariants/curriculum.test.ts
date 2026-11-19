/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TableSnapshot } from './snapshot.js';
import {
  AT,
  consistentTable,
  ids,
  shown,
  T,
  testHelpers,
} from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { item, broken, expectOnly } = testHelpers(() => table);

describe('course-has-instructor', () => {
  it('reports a course nobody teaches', () => {
    table.courseInstructors = [];
    expectOnly('course-has-instructor');
  });
});

describe('instructor-course-updated-at', () => {
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

  // course.setPrice writes priceAmount and priceCurrency, which move the
  // course's updatedAt; an instructor row left behind is a violation.
  it('reports a price change that did not move courseUpdatedAt', () => {
    const course = table.courses[0];
    course.priceAmount = 1999;
    course.pricedAt = '2030-01-01T00:00:00.000Z';
    course.updatedAt = '2030-01-01T00:00:00.000Z';
    expectOnly('instructor-course-updated-at');
  });

  it('accepts a price change that moved courseUpdatedAt', () => {
    const course = table.courses[0];
    course.priceAmount = 1999;
    course.pricedAt = '2030-01-01T00:00:00.000Z';
    course.updatedAt = '2030-01-01T00:00:00.000Z';
    for (const row of table.courseInstructors) {
      row.courseUpdatedAt = course.updatedAt;
    }
    expect(broken().invariants).toEqual([]);
  });

  it('accepts a landing write that synced courseUpdatedAt', () => {
    const course = table.courses[0];
    course.learningOutcomes = ['Build a thing'];
    course.updatedAt = '2026-02-01T00:00:00.000Z';
    for (const row of table.courseInstructors) {
      row.courseUpdatedAt = course.updatedAt;
    }
    expect(broken().invariants).toEqual([]);
  });

  it('reports a landing write that left the sync out', () => {
    const course = table.courses[0];
    course.requirements = ['A laptop'];
    course.updatedAt = '2026-02-01T00:00:00.000Z';
    expectOnly('instructor-course-updated-at');
  });
});

describe('published-at-set', () => {
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

describe('curriculum-has-parents', () => {
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
    expect([...invariants].sort()).toEqual([
      'curriculum-has-parents',
      'progress-matches-completions',
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

describe('instructor-has-user', () => {
  it('reports an instructor with no user record', () => {
    table.users = [{ userId: 'student' }];
    expectOnly('instructor-has-user');
  });
});

describe('sibling-order-unique', () => {
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

describe('draft-course-nothing-archived', () => {
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

describe('child-order-claimed', () => {
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

describe('assignment-lesson-shape', () => {
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
