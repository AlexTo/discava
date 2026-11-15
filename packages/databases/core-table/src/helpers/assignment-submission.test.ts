/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCoreTableService } from '../service.js';
import {
  type AssignmentSubmissionWrite,
  assignmentSubmissionWrites,
  isLateSubmission,
} from './assignment-submission.js';

// The requests ElectroDB would send, checked without a table.

let coreTable: Awaited<ReturnType<typeof createCoreTableService>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  coreTable = await createCoreTableService();
});

const AT = '2026-11-14T10:00:00.000Z';
const write: AssignmentSubmissionWrite = {
  userId: 'student-1',
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
  at: AT,
  file: {
    key: 'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/submissions/student-1/a-1/w.pdf',
    fileName: 'w.pdf',
    fileSize: 10,
    mimeType: 'application/pdf',
  },
  hasCompletion: false,
};

interface Conditional {
  ConditionExpression?: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}

interface TransactItem {
  ConditionCheck?: Conditional;
  Update?: Conditional & { UpdateExpression: string };
  Put?: Conditional & { Item: Record<string, unknown> };
}

const requestFor = (input: AssignmentSubmissionWrite): TransactItem[] =>
  coreTable.transaction
    .write((entities) => assignmentSubmissionWrites(entities, input))
    .params().TransactItems;

const conditionOf = (item: TransactItem) => {
  const request = (item.ConditionCheck ??
    item.Update ??
    item.Put) as Conditional;
  return (request.ConditionExpression ?? '').replace(
    /#\w+|:\w+/g,
    (token) =>
      `${request.ExpressionAttributeNames[token] ?? request.ExpressionAttributeValues[token] ?? token}`,
  );
};

const ACTIVITY = 5;

describe('a first submission', () => {
  it('checks and moves what a student activity does, counting the student', () => {
    const items = requestFor(write);

    expect(items).toHaveLength(ACTIVITY + 2);
    expect(conditionOf(items[0]!)).toContain('status = published');
    expect(items[3]!.Update?.UpdateExpression).toMatch(
      /ADD .*studentActivityCount/,
    );
    expect(items[4]!.Update?.UpdateExpression).toMatch(/SET .*lastActivityAt/);
    expect(
      Object.values(items[4]!.Update!.ExpressionAttributeValues),
    ).toContain(AT);
  });

  it('creates the submission and the completion once', () => {
    const [, , , , , submission, completion] = requestFor(write);

    expect(submission!.Put?.Item).toMatchObject({
      status: 'submitted',
      version: 1,
      submittedAt: AT,
      late: false,
      file: write.file,
    });
    expect(conditionOf(submission!)).toContain('attribute_not_exists');
    expect(completion!.Put?.Item).toMatchObject({
      userId: 'student-1',
      completedAt: AT,
    });
    expect(conditionOf(completion!)).toContain('attribute_not_exists');
  });

  // Invariant: studentActivityCount counts each student once.
  it('does not count a student a completion already counted, and checks that completion', () => {
    const items = requestFor({ ...write, hasCompletion: true });

    expect(items[3]!.Update).toBeUndefined();
    expect(items[3]!.ConditionCheck).toBeDefined();
    expect(items[6]!.Put).toBeUndefined();
    expect(conditionOf(items[6]!)).toContain('attribute_exists(userId)');
    expect(items[5]!.Put?.Item).toMatchObject({ version: 1 });
  });

  it('sets the submission’s time to the activity’s, which moves lastActivityAt', () => {
    const later = '2026-11-14T10:00:07.000Z';
    const items = requestFor({ ...write, at: later });

    expect(items[5]!.Put?.Item).toMatchObject({ submittedAt: later });
    expect(
      Object.values(items[4]!.Update!.ExpressionAttributeValues),
    ).toContain(later);
  });
});

describe('late', () => {
  const due = '2026-11-14T09:00:00.000Z';

  it('is false at exactly the due date, true after, false with none', () => {
    expect(isLateSubmission(due, due)).toBe(false);
    expect(isLateSubmission('2026-11-14T09:00:00.001Z', due)).toBe(true);
    expect(isLateSubmission(AT, undefined)).toBe(false);
  });

  it('is stored from the submission time, not the clock', () => {
    const lateAt = '2026-11-14T09:00:01.000Z';
    // lastActivityAt ahead of the clock puts `at` past the due date.
    const [, , , , , late] = requestFor({ ...write, at: lateAt, dueAt: due });
    const [, , , , , onTime] = requestFor({ ...write, at: due, dueAt: due });

    expect(late!.Put?.Item).toMatchObject({ late: true });
    expect(onTime!.Put?.Item).toMatchObject({ late: false });
  });
});

describe('a resubmission', () => {
  const resubmit = { ...write, existing: { version: 2 }, hasCompletion: true };

  it('replaces the version it read, while it is still submitted', () => {
    const items = requestFor(resubmit);

    expect(items).toHaveLength(ACTIVITY + 1);
    const patch = items[5]!;
    expect(patch.Update?.UpdateExpression).toMatch(/SET/);
    expect(Object.values(patch.Update!.ExpressionAttributeValues)).toContain(3);
    const condition = conditionOf(patch);
    expect(condition).toContain('version = 2');
    expect(condition).toContain('status = submitted');
  });

  it('counts nobody again and writes no completion', () => {
    const items = requestFor(resubmit);

    expect(items[3]!.Update).toBeUndefined();
    expect(items[3]!.ConditionCheck).toBeDefined();
    expect(items.some((item) => item.Put)).toBe(false);
  });
});

describe('the activity checks', () => {
  it('cancel the transaction for an archived course or a hidden item', () => {
    const conditions = requestFor(write)
      .slice(0, ACTIVITY)
      .map((item) => conditionOf(item));

    expect(conditions[0]).toContain('status = published');
    expect(conditions[1]).toContain('attribute_not_exists(archivedAt)');
    expect(conditions[2]).toContain('attribute_not_exists(archivedAt)');
    expect(conditions[3]).toContain('visibility = visible');
    expect(conditions[3]).toContain('attribute_not_exists(archivedAt)');
  });
});
