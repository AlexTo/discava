/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCoreTableService } from '../service.js';
import {
  type StudentActivity,
  studentActivityAt,
  studentActivityWrites,
} from './student-activity.js';

// The requests ElectroDB would send, checked without a table.

let coreTable: Awaited<ReturnType<typeof createCoreTableService>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  coreTable = await createCoreTableService();
});

const AT = '2026-10-28T10:00:00.000Z';
const activity: StudentActivity = {
  userId: 'student-1',
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
  at: AT,
  firstRecord: true,
};

interface Conditional {
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}

interface TransactItem {
  ConditionCheck?: Conditional;
  Update?: Conditional & { UpdateExpression: string };
}

const requestFor = (activity: StudentActivity): TransactItem[] =>
  coreTable.transaction
    .write((entities) => studentActivityWrites(entities, activity))
    .params().TransactItems;

// Each item's condition with its placeholders filled in, so it reads as the
// rule it enforces.
const conditionsOf = (items: TransactItem[]) =>
  items.map((item) => {
    const request = (item.ConditionCheck ?? item.Update) as Conditional;
    return request.ConditionExpression.replace(
      /#\w+|:\w+/g,
      (token) =>
        `${request.ExpressionAttributeNames[token] ?? request.ExpressionAttributeValues[token] ?? token}`,
    );
  });

describe('studentActivityAt', () => {
  it('is now for a first activity', () => {
    expect(studentActivityAt({}, new Date(AT))).toBe(AT);
  });

  it('is now when the last activity is earlier', () => {
    expect(
      studentActivityAt(
        { lastActivityAt: '2026-10-28T09:00:00.000Z' },
        new Date(AT),
      ),
    ).toBe(AT);
  });

  // Invariant: a student's activity times never go backwards, even when
  // another Lambda's clock is ahead.
  it('is the last activity when that is later', () => {
    const later = '2026-10-28T10:00:05.000Z';
    expect(studentActivityAt({ lastActivityAt: later }, new Date(AT))).toBe(
      later,
    );
  });
});

describe('studentActivityWrites', () => {
  it('checks the course, ancestors, item and enrolment in one request', () => {
    const conditions = conditionsOf(requestFor(activity));

    expect(conditions).toHaveLength(5);
    expect(conditions[0]).toContain('status = published');
    for (const shown of conditions.slice(1, 4)) {
      expect(shown).toContain('visibility = visible');
      expect(shown).toContain('attribute_not_exists(archivedAt)');
    }
    // Enrolled, not dropped, and no later activity landed since `at`.
    expect(conditions[4]).toContain('attribute_exists(userId)');
    expect(conditions[4]).toContain('status <> dropped');
    expect(conditions[4]).toContain(
      `(attribute_not_exists(lastActivityAt) OR lastActivityAt <= ${AT})`,
    );
  });

  // Invariant: studentActivityCount counts each student once.
  it('counts the student on their first record of the item', () => {
    const [, , , item, enrolment] = requestFor(activity);

    expect(item.Update?.UpdateExpression).toMatch(/ADD .*studentActivityCount/);
    expect(enrolment.Update?.UpdateExpression).toMatch(/SET .*lastActivityAt/);
  });

  it('only checks the item after that', () => {
    const [, , , item] = requestFor({ ...activity, firstRecord: false });

    expect(item.ConditionCheck).toBeDefined();
    expect(item.Update).toBeUndefined();
  });

  it('holds a quiz to the version it was judged by', () => {
    const conditions = conditionsOf(
      requestFor({ ...activity, firstRecord: false, quizVersion: 4 }),
    );

    expect(conditions[3]).toContain('quizVersion = 4');
  });
});
