/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useCoreTable } from '../test-support/core-table.js';
import {
  type AmendGradeWrite,
  amendGradeWrites,
  FEEDBACK_MAX_LENGTH,
  isValidPoints,
  MAX_SUBMISSION_NOTICE_INSTRUCTORS,
  type RequestResubmissionWrite,
  type ReturnSubmissionWrite,
  requestResubmissionWrites,
  returnSubmissionWrites,
  submissionsReceivedNotificationWrites,
  waitingKeys,
} from './assignment-grading.js';

// The requests ElectroDB would send, checked without a table.

const coreTable = useCoreTable();

// No notification state yet for any user, so no table is read.
beforeAll(() => {
  vi.spyOn(coreTable.entities.notificationState, 'get').mockReturnValue({
    go: async () => ({ data: undefined }),
  } as never);
});

const AT = '2026-11-20T10:00:00.000Z';
const base = {
  courseId: 'course-1',
  contentItemId: 'item-1',
  userId: 'student-1',
  feedbackId: '01JFEEDBACK0000000000000A',
  givenBy: 'instructor-1',
  givenAt: AT,
  lessonId: 'lesson-1',
  assignmentTitle: 'Essay',
  courseTitle: 'Writing',
  version: 2,
  reviewRevision: 3,
};
const returned: ReturnSubmissionWrite = {
  ...base,
  points: 8.5,
  pointsOutOf: 10,
  feedback: '{"type":"doc"}',
};
const request: RequestResubmissionWrite = {
  ...base,
  feedback: '{"type":"doc","content":[]}',
};
const amend: AmendGradeWrite = { ...base, points: 9, pointsOutOf: 10 };

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

const requestFor = (items: unknown[]): TransactItem[] =>
  coreTable.transaction.write(() => items as never).params().TransactItems;

const conditionOf = (item: TransactItem) => {
  const call = (item.ConditionCheck ?? item.Update ?? item.Put) as Conditional;
  return (call.ConditionExpression ?? '').replace(
    /#\w+|:\w+/g,
    (token) =>
      `${call.ExpressionAttributeNames[token] ?? call.ExpressionAttributeValues[token] ?? token}`,
  );
};

const setValues = (item: TransactItem) =>
  Object.values(item.Update!.ExpressionAttributeValues);

describe('isValidPoints', () => {
  it.each([0, 1, 7.5, 8.25, 10])('accepts %s of 10', (points) => {
    expect(isValidPoints(points, 10)).toBe(true);
  });

  it.each([-1, -0.01, 10.01, 1.005, Number.NaN, Infinity, '5', undefined])(
    'refuses %s of 10',
    (points) => {
      expect(isValidPoints(points, 10)).toBe(false);
    },
  );
});

describe('waitingKeys', () => {
  it('is both attributes while submitted', () => {
    expect(waitingKeys('submitted', 'c1', AT)).toEqual({
      waitingCourseId: 'c1',
      waitingSince: AT,
    });
  });

  it.each(['resubmission_requested', 'returned'] as const)(
    'is the two names to remove for %s',
    (status) => {
      expect(waitingKeys(status, 'c1', AT)).toEqual({
        remove: ['waitingCourseId', 'waitingSince'],
      });
    },
  );
});

describe('returnSubmissionWrites', () => {
  it('writes the submission, the round and the notification: 4 items', async () => {
    const items = requestFor(await returnSubmissionWrites(coreTable, returned));

    expect(items).toHaveLength(4);
    expect(items[0]!.Update).toBeDefined();
    expect(items[1]!.Put?.Item).toMatchObject({
      kind: 'returned',
      feedback: returned.feedback,
      points: 8.5,
      pointsOutOf: 10,
      version: 2,
      givenAt: AT,
      givenBy: 'instructor-1',
    });
    expect(items[2]!.Put?.Item).toMatchObject({
      type: 'assignment.returned',
      userId: 'student-1',
    });
  });

  it('returns the submission from the version, revision and state it read', async () => {
    const [patch] = requestFor(
      await returnSubmissionWrites(coreTable, returned),
    );

    const condition = conditionOf(patch!);
    expect(condition).toContain('version = 2');
    expect(condition).toContain('reviewRevision = 3');
    expect(condition).toContain('status = submitted');
    expect(condition).toContain('status = resubmission_requested');
    expect(condition).not.toContain('returned');
    expect(setValues(patch!)).toEqual(
      expect.arrayContaining(['returned', 8.5, 10, AT, 'instructor-1', 4]),
    );
    expect(patch!.Update!.UpdateExpression).toMatch(/REMOVE.*#waitingCourseId/);
    expect(patch!.Update!.UpdateExpression).toMatch(/#waitingSince/);
  });

  it('keys the notification by the round', async () => {
    const items = requestFor(await returnSubmissionWrites(coreTable, returned));

    expect(items[2]!.Put?.Item.id).toEqual(
      requestFor(
        await returnSubmissionWrites(coreTable, { ...returned, version: 9 }),
      )[2]!.Put?.Item.id,
    );
  });

  it('may have no feedback', async () => {
    const { feedback: _, ...bare } = returned;
    const items = requestFor(await returnSubmissionWrites(coreTable, bare));

    expect(items[1]!.Put?.Item).not.toHaveProperty('feedback');
  });

  it('refuses feedback over the limit', async () => {
    await expect(
      returnSubmissionWrites(coreTable, {
        ...returned,
        feedback: 'x'.repeat(FEEDBACK_MAX_LENGTH + 1),
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('requestResubmissionWrites', () => {
  it('writes the submission, a round with no points and the notification: 4 items', async () => {
    const items = requestFor(
      await requestResubmissionWrites(coreTable, request),
    );

    expect(items).toHaveLength(4);
    expect(items[1]!.Put?.Item).toMatchObject({
      kind: 'resubmission_requested',
      feedback: request.feedback,
    });
    expect(items[1]!.Put?.Item).not.toHaveProperty('points');
    expect(items[1]!.Put?.Item).not.toHaveProperty('pointsOutOf');
    expect(items[2]!.Put?.Item).toMatchObject({
      type: 'assignment.resubmission_requested',
    });
  });

  it('only asks of a submitted submission at the version and revision read', async () => {
    const [patch] = requestFor(
      await requestResubmissionWrites(coreTable, request),
    );

    const condition = conditionOf(patch!);
    expect(condition).toContain('version = 2');
    expect(condition).toContain('reviewRevision = 3');
    expect(condition).toContain('status = submitted');
    expect(condition).not.toContain('resubmission_requested');
    expect(setValues(patch!)).toEqual(
      expect.arrayContaining(['resubmission_requested', 4]),
    );
    expect(patch!.Update!.UpdateExpression).toMatch(/REMOVE.*#waitingCourseId/);
  });

  it.each(['', '   ', undefined])('refuses feedback %j', async (feedback) => {
    await expect(
      requestResubmissionWrites(coreTable, {
        ...request,
        feedback: feedback as string,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('amendGradeWrites', () => {
  it('writes the submission, an amended round and the notification: 4 items', async () => {
    const items = requestFor(await amendGradeWrites(coreTable, amend));

    expect(items).toHaveLength(4);
    expect(items[1]!.Put?.Item).toMatchObject({
      kind: 'amended',
      points: 9,
      pointsOutOf: 10,
    });
    expect(items[2]!.Put?.Item).toMatchObject({
      type: 'assignment.grade_updated',
    });
  });

  it('only amends a returned submission at the revision read', async () => {
    const [patch] = requestFor(await amendGradeWrites(coreTable, amend));

    const condition = conditionOf(patch!);
    expect(condition).toContain('status = returned');
    expect(condition).toContain('reviewRevision = 3');
    expect(setValues(patch!)).toEqual(expect.arrayContaining([9, 10, AT, 4]));
  });

  it('leaves returnedAt, returnedBy and the status as they are', async () => {
    const [patch] = requestFor(await amendGradeWrites(coreTable, amend));
    const expression = patch!.Update!.UpdateExpression;

    expect(expression).not.toMatch(/returnedAt|returnedBy|#status|waiting/);
    expect(expression).toMatch(/gradedAt/);
  });
});

// FR-013: grading is not student activity.
describe('grading writes', () => {
  it('touch no completion, enrolment or activity count', async () => {
    const all = [
      ...(await returnSubmissionWrites(coreTable, returned)),
      ...(await requestResubmissionWrites(coreTable, request)),
      ...(await amendGradeWrites(coreTable, amend)),
    ];
    const items = requestFor(all);

    expect(JSON.stringify(items)).not.toMatch(
      /studentActivityCount|lastActivityAt|itemcompletion|enrolment/i,
    );
  });
});

describe('submissionsReceivedNotificationWrites', () => {
  const notice = {
    courseId: 'course-1',
    contentItemId: 'item-1',
    day: '2026-11-20',
    occurredAt: AT,
    assignmentTitle: 'Essay',
    courseTitle: 'Writing',
  };

  it('creates the marker only if absent, expiring two days after the day', async () => {
    const items = requestFor(
      await submissionsReceivedNotificationWrites(coreTable, {
        ...notice,
        instructorIds: ['i1'],
      }),
    );

    expect(conditionOf(items[0]!)).toContain('attribute_not_exists');
    expect(items[0]!.Put?.Item).toMatchObject({
      day: '2026-11-20',
      ttl: Date.parse('2026-11-22T00:00:00.000Z') / 1000,
    });
  });

  it('notifies each instructor once, with a key naming the assignment and day', async () => {
    const items = requestFor(
      await submissionsReceivedNotificationWrites(coreTable, {
        ...notice,
        instructorIds: ['i1', 'i2', 'i1'],
      }),
    );

    expect(items).toHaveLength(1 + 2 * 2);
    const created = items.filter(
      (item) => item.Put?.Item.type === 'assignment.submissions_received',
    );
    expect(created.map((item) => item.Put?.Item.userId)).toEqual(['i1', 'i2']);
    expect(created[0]!.Put?.Item.id).toBe(created[1]!.Put?.Item.id);
  });

  it('caps the instructors so a submission stays within a transaction', async () => {
    const instructorIds = Array.from({ length: 80 }, (_, i) => `i${i}`);
    const items = await submissionsReceivedNotificationWrites(coreTable, {
      ...notice,
      instructorIds,
    });

    expect(MAX_SUBMISSION_NOTICE_INSTRUCTORS).toBe(46);
    expect(items).toHaveLength(1 + 2 * MAX_SUBMISSION_NOTICE_INSTRUCTORS);
  });
});
