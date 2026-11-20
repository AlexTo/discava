/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import {
  checkTableInvariants,
  consistentTable,
  ids,
  prefix,
  testHelpers,
} from './test-fixture.js';

const INVARIANTS_UNDER_TEST: InvariantName[] = [
  'activity-count-matches-students',
  'student-records-have-targets',
  'student-records-enrolled',
  'student-records-placed-with-item',
  'last-activity-at-current',
  'assignment-submission-shape',
];

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { item } = testHelpers(() => table);

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
      status: 'submitted',
      version: 1,
      reviewRevision: 0,
      submittedAt: SUBMITTED,
      waitingCourseId: 'c1',
      waitingSince: SUBMITTED,
    });
    return table.assignmentSubmissions[0];
  };
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  it.each(INVARIANTS_UNDER_TEST)('keeps %s for a proper submission', (name) => {
    submitted();
    expect(violationsOf(name)).toEqual([]);
  });

  it('reports a count that omits a submission-only student (activity-count-matches-students)', () => {
    submitted();
    table.itemCompletions.pop();
    item('video').studentActivityCount = 0;
    expect(violationsOf('activity-count-matches-students')).toHaveLength(1);
  });

  it('reports a submission whose item is gone (student-records-have-targets)', () => {
    submitted().contentItemId = 'gone';
    expect(violationsOf('student-records-have-targets')).toContainEqual(
      expect.objectContaining({
        message: 'submission for a content item that does not exist',
      }),
    );
  });

  it('reports a submission by a student who is not enrolled (student-records-enrolled)', () => {
    submitted().userId = 'stranger';
    expect(violationsOf('student-records-enrolled')).toContainEqual(
      expect.objectContaining({
        message: 'submission by a student not enrolled in the course',
      }),
    );
  });

  it('reports a submission filed under another lesson (student-records-placed-with-item)', () => {
    submitted().lessonId = 'other';
    expect(violationsOf('student-records-placed-with-item')).toHaveLength(1);
  });

  it('reports a resubmit that did not advance lastActivityAt (last-activity-at-current)', () => {
    submitted().submittedAt = '2026-01-03T00:00:00.000Z';
    expect(violationsOf('last-activity-at-current')).toHaveLength(1);
  });

  describe('assignment-submission-shape', () => {
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

    it('reports an unknown status', () => {
      (submitted() as { status: string }).status = 'graded';
      expect(violationsOf('assignment-submission-shape')[0]?.message).toMatch(
        /status graded is not/,
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
