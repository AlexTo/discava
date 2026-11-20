/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createAssignmentSubmissionEntity } from './assignment-submission.js';

// The requests ElectroDB would send, checked without a table.

let submission: Awaited<ReturnType<typeof createAssignmentSubmissionEntity>>;
beforeAll(async () => {
  submission = await createAssignmentSubmissionEntity();
});

const file = {
  key: 'courses/c/modules/m/lessons/l/content-items/i/submissions/u/a/w.pdf',
  fileName: 'w.pdf',
  fileSize: 10,
  mimeType: 'application/pdf',
};
const record = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
  userId: 'user-1',
  submittedAt: '2026-11-14T00:00:00.000Z',
  version: 1,
  // A first submission is waiting; ElectroDB needs every composite of the
  // byWaiting index on a create.
  waitingCourseId: 'course-1',
  waitingSince: '2026-11-14T00:00:00.000Z',
};

describe('assignmentSubmission.file', () => {
  it('is stored as one map', () => {
    const { Item } = submission.create({ ...record, file }).params();

    expect(Item).toMatchObject({ file });
    expect(Item).not.toHaveProperty('files');
  });

  it('is required', () => {
    expect(() => submission.create(record as never).params()).toThrow();
  });

  it.each(['key', 'fileName', 'fileSize', 'mimeType'])(
    'is refused without its %s',
    (field) => {
      const { [field as keyof typeof file]: _, ...rest } = file;
      expect(() =>
        submission.create({ ...record, file: rest } as never).params(),
      ).toThrow();
    },
  );
});

type Params = {
  Item: Record<string, unknown>;
  IndexName?: string;
  UpdateExpression: string;
  ExpressionAttributeValues: Record<string, unknown>;
};

describe('assignmentSubmission status and grade', () => {
  it.each(['submitted', 'resubmission_requested', 'returned'])(
    'accepts the %s status',
    (status) => {
      expect(() =>
        submission.create({ ...record, file, status } as never).params(),
      ).not.toThrow();
    },
  );

  it('refuses another status', () => {
    expect(() =>
      submission
        .create({ ...record, file, status: 'graded' } as never)
        .params(),
    ).toThrow();
  });

  it('starts at review revision 0 with no grade', () => {
    const { Item } = submission.create({ ...record, file }).params() as Params;

    expect(Item).toMatchObject({ status: 'submitted', reviewRevision: 0 });
    for (const name of [
      'points',
      'pointsOutOf',
      'returnedAt',
      'returnedBy',
      'gradedAt',
    ]) {
      expect(Item).not.toHaveProperty(name);
    }
  });
});

describe('assignmentSubmission.byWaiting', () => {
  const waiting = {
    waitingCourseId: record.courseId,
    waitingSince: record.submittedAt,
  };
  const { waitingCourseId, waitingSince, ...notWaiting } = record;
  const key = {
    courseId: record.courseId,
    contentItemId: record.contentItemId,
    userId: record.userId,
  };
  const expression = (params: unknown) => (params as Params).UpdateExpression;

  it('indexes a submitted item with both waiting attributes', () => {
    const { Item } = submission.create({ ...record, file }).params() as Params;

    expect(Item.gsi1pk).toContain('assignmentsubmission_waiting');
    expect(Item.gsi1sk).toContain(record.submittedAt.toLowerCase());
  });

  it('refuses a create with only some of the index attributes', () => {
    // A create must say whether the item waits: ElectroDB keeps an index with
    // a condition consistent with its attributes.
    expect(() => submission.create({ ...notWaiting, file }).params()).toThrow();
  });

  it('queries on gsi1 with a key no other entity can equal', () => {
    const params = submission.query
      .byWaiting({ waitingCourseId: 'course-1' })
      .params() as Params;

    expect(params.IndexName).toBe('gsi1pk-gsi1sk-index');
    const [value] = Object.values(params.ExpressionAttributeValues);
    expect(value).toContain('assignmentsubmission_waiting');
  });

  it('clears the keys when a patch removes both attributes', () => {
    const update = expression(
      submission
        .patch(key)
        .set({ status: 'returned' })
        .remove(['waitingCourseId', 'waitingSince'])
        .params(),
    );

    expect(update).toMatch(/REMOVE.*#gsi1pk/);
  });

  it('sets the keys when a patch sets both attributes', () => {
    const update = expression(
      submission
        .patch(key)
        .set({ status: 'submitted', ...waiting })
        .params(),
    );

    expect(update).toMatch(/#gsi1pk/);
  });

  it('leaves the keys alone for a patch of anything else', () => {
    const update = expression(
      submission.patch(key).set({ points: 5, reviewRevision: 1 }).params(),
    );

    expect(update).not.toMatch(/#gsi1/);
  });
});
