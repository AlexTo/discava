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
  process.env.LOCAL_DEV = 'true';
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
