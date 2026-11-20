/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  amendAssignmentGrade,
  assignmentSubmissionFileUrl,
  getAssignmentSubmission,
  listAssignmentSubmissions,
  requestAssignmentResubmission,
  returnAssignmentSubmission,
} from './assignment-submission.js';

const {
  amendGradeWrites,
  requestResubmissionWrites,
  returnSubmissionWrites,
  signedUrl,
  transactionGo,
  contentItemQueryPrimary,
  lessonGet,
  courseGet,
  courseInstructorGet,
  enrolmentGet,
  enrolmentQueryPrimary,
  assignmentSubmissionGet,
  assignmentSubmissionQueryPrimary,
  submissionFeedbackQueryPrimary,
  userGet,
  transactionWrite,
  mockModule,
} = await vi.hoisted(async () => ({
  amendGradeWrites: vi.fn(),
  requestResubmissionWrites: vi.fn(),
  returnSubmissionWrites: vi.fn(),
  signedUrl: vi.fn(),
  transactionGo: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    contentItem: ['query.primary'],
    lesson: ['get'],
    course: ['get'],
    courseInstructor: ['get'],
    enrolment: ['get', 'query.primary'],
    assignmentSubmission: ['get', 'query.primary'],
    submissionFeedback: ['query.primary'],
    user: ['get'],
    transaction: ['write'],
  }),
}));

vi.mock('@discava/core-table', async (importActual) =>
  mockModule(await importActual(), {
    amendGradeWrites,
    requestResubmissionWrites,
    returnSubmissionWrites,
  }),
);

vi.mock(
  '@discava/common-server-utils/lesson-media',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@discava/common-server-utils/lesson-media')
    >()),
    getSignedCloudFrontFileUrl: signedUrl,
  }),
);

const router = t.router({
  list: listAssignmentSubmissions,
  get: getAssignmentSubmission,
  fileUrl: assignmentSubmissionFileUrl,
  return: returnAssignmentSubmission,
  requestResubmission: requestAssignmentResubmission,
  amendGrade: amendAssignmentGrade,
});

const INSTRUCTOR = 'instructor-1';
const callAs = (sub = INSTRUCTOR, groups: string[] = ['instructor']) =>
  callerFor(router, { sub, groups });

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const ref = { courseId: 'course-1', contentItemId: 'item-1' };
const student = { ...ref, userId: 'student-1' };
const grading = { ...student, version: 2, reviewRevision: 3 };

const assignmentItem = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
  type: 'assignment',
  maxPoints: 10,
  dueAt: '2026-11-30T00:00:00.000Z',
};
const file = {
  key: 'courses/course-1/x/Essay.pdf',
  fileName: 'Essay.pdf',
  fileSize: 100,
  mimeType: 'application/pdf',
};
const submitted = {
  ...ref,
  userId: 'student-1',
  status: 'submitted',
  version: 2,
  reviewRevision: 3,
  submittedAt: '2026-11-10T00:00:00.000Z',
  late: false,
  file,
};
const returned = {
  ...submitted,
  status: 'returned',
  reviewRevision: 4,
  points: 8,
  pointsOutOf: 10,
  returnedAt: '2026-11-12T00:00:00.000Z',
  gradedAt: '2026-11-12T00:00:00.000Z',
};

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

beforeEach(() => {
  vi.resetAllMocks();
  courseInstructorGet.mockReturnValue(
    resolves({ courseId: 'course-1', instructorId: INSTRUCTOR }),
  );
  contentItemQueryPrimary.mockReturnValue(resolves([assignmentItem]));
  lessonGet.mockReturnValue(resolves({ title: 'Essay' }));
  courseGet.mockReturnValue(resolves({ title: 'Writing' }));
  enrolmentGet.mockReturnValue(
    resolves({ courseId: 'course-1', userId: 'student-1', status: 'active' }),
  );
  enrolmentQueryPrimary.mockReturnValue(resolves([]));
  assignmentSubmissionGet.mockReturnValue(resolves(submitted));
  assignmentSubmissionQueryPrimary.mockReturnValue(resolves([]));
  submissionFeedbackQueryPrimary.mockReturnValue(resolves([]));
  userGet.mockReturnValue(
    resolves([
      { userId: 'student-1', givenName: 'Sam', familyName: 'Student' },
      { userId: INSTRUCTOR, givenName: 'Ida', familyName: 'Teacher' },
    ]),
  );
  transactionWrite.mockReturnValue({ go: transactionGo });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  const items = ['patch', 'round', 'notification', 'state'];
  returnSubmissionWrites.mockResolvedValue(items);
  requestResubmissionWrites.mockResolvedValue(items);
  amendGradeWrites.mockResolvedValue(items);
  signedUrl.mockResolvedValue('https://cdn.example/signed');
});

const cancelledCondition = {
  canceled: true,
  data: [{ code: 'ConditionalCheckFailed' }],
};

describe('authorization and the item', () => {
  const calls: [string, () => Promise<unknown>][] = [
    ['list', () => callAs().list(ref)],
    ['get', () => callAs().get(student)],
    ['fileUrl', () => callAs().fileUrl(student)],
    ['return', () => callAs().return({ ...grading, points: 5 })],
    [
      'requestResubmission',
      () => callAs().requestResubmission({ ...grading, feedback: doc('x') }),
    ],
    ['amendGrade', () => callAs().amendGrade({ ...grading, points: 5 })],
  ];

  it.each(calls)('%s refuses another course’s instructor', async (_, call) => {
    courseInstructorGet.mockReturnValue(resolves(undefined));
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(contentItemQueryPrimary).not.toHaveBeenCalled();
  });

  it('refuses a student', async () => {
    const asStudent = callerFor(router, {
      sub: 'student-1',
      groups: ['student'],
    });
    await expect(asStudent.list(ref)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      asStudent.return({ ...grading, points: 5 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(calls)('%s: a quiz item is NOT_FOUND', async (_, call) => {
    contentItemQueryPrimary.mockReturnValue(
      resolves([{ ...assignmentItem, type: 'quiz' }]),
    );
    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('allows a hidden or archived item', async () => {
    contentItemQueryPrimary.mockReturnValue(
      resolves([{ ...assignmentItem, visibility: 'hidden', archivedAt: 'x' }]),
    );
    await expect(callAs().list(ref)).resolves.toBeDefined();
  });
});

describe('list', () => {
  it('orders waiting work first, with counts and names', async () => {
    enrolmentQueryPrimary.mockReturnValue(
      resolves([
        { userId: 'student-1', status: 'active' },
        { userId: 'student-2', status: 'active' },
        { userId: 'student-3', status: 'dropped' },
      ]),
    );
    assignmentSubmissionQueryPrimary.mockReturnValue(
      resolves([
        { ...submitted, userId: 'student-2', status: 'returned' },
        { ...submitted, userId: 'student-3' },
        { ...submitted, userId: 'student-1' },
      ]),
    );

    const result = await callAs().list(ref);

    expect(result.assignment).toEqual({
      title: 'Essay',
      maxPoints: 10,
      dueAt: '2026-11-30T00:00:00.000Z',
    });
    expect(result.rows.map((r) => [r.userId, r.state, r.enrolled])).toEqual([
      ['student-1', 'submitted', true],
      ['student-2', 'returned', true],
      ['student-3', 'submitted', false],
    ]);
    expect(result.rows[0]!.displayName).toBe('Sam Student');
    expect(result.counts).toEqual({
      waiting: 1,
      resubmissionRequested: 0,
      returned: 1,
      notSubmitted: 0,
    });
  });
});

describe('get', () => {
  it('returns the submission, its revision and the history newest first', async () => {
    submissionFeedbackQueryPrimary.mockReturnValue(
      resolves([
        {
          feedbackId: 'f2',
          kind: 'returned',
          points: 8,
          pointsOutOf: 10,
          version: 2,
          givenAt: '2026-11-12T00:00:00.000Z',
          givenBy: INSTRUCTOR,
        },
        {
          feedbackId: 'f1',
          kind: 'resubmission_requested',
          feedback: doc('Again'),
          version: 1,
          givenAt: '2026-11-11T00:00:00.000Z',
          givenBy: INSTRUCTOR,
        },
      ]),
    );

    const result = await callAs().get(student);

    expect(result.submission).toMatchObject({
      state: 'submitted',
      version: 2,
      reviewRevision: 3,
      file: { fileName: 'Essay.pdf', previewable: 'pdf' },
    });
    expect(result.submission?.file).not.toHaveProperty('key');
    expect(result.feedback.map((r) => r.feedbackId)).toEqual(['f2', 'f1']);
    expect(result.feedback[0]!.givenBy).toEqual({
      userId: INSTRUCTOR,
      displayName: 'Ida Teacher',
    });
    expect(
      submissionFeedbackQueryPrimary.mock.results[0]!.value.go,
    ).toHaveBeenCalledWith({ order: 'desc', pages: 'all' });
  });

  it.each([
    ['image/png', 'image'],
    ['image/webp', 'image'],
    ['application/zip', null],
  ])('says %s previews as %s', async (mimeType, previewable) => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...submitted, file: { ...file, mimeType } }),
    );
    const result = await callAs().get(student);
    expect(result.submission?.file.previewable).toBe(previewable);
  });

  it('shows a student who left as not enrolled', async () => {
    enrolmentGet.mockReturnValue(resolves({ status: 'dropped' }));
    expect((await callAs().get(student)).student.enrolled).toBe(false);
  });

  it('is NOT_FOUND for someone with no enrolment and no submission', async () => {
    enrolmentGet.mockReturnValue(resolves(undefined));
    assignmentSubmissionGet.mockReturnValue(resolves(undefined));
    await expect(callAs().get(student)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('fileUrl', () => {
  it('signs the stored key', async () => {
    await expect(callAs().fileUrl(student)).resolves.toEqual({
      url: 'https://cdn.example/signed',
    });
    expect(signedUrl).toHaveBeenCalledWith(file.key);
  });

  it('is NOT_FOUND without a submission', async () => {
    assignmentSubmissionGet.mockReturnValue(resolves(undefined));
    await expect(callAs().fileUrl(student)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('return', () => {
  const returnIt = (extra: Record<string, unknown> = {}) =>
    callAs().return({
      ...grading,
      points: 8.5,
      feedback: doc('Good'),
      ...extra,
    });

  it('writes one transaction of the return writes', async () => {
    await expect(returnIt()).resolves.toEqual({ reviewRevision: 4 });

    expect(returnSubmissionWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ...student,
        version: 2,
        reviewRevision: 3,
        points: 8.5,
        pointsOutOf: 10,
        givenBy: INSTRUCTOR,
        lessonId: 'lesson-1',
        assignmentTitle: 'Essay',
        courseTitle: 'Writing',
        feedback: doc('Good'),
      }),
    );
    expect(transactionWrite).toHaveBeenCalledTimes(1);
    const items = transactionWrite.mock.calls[0]![0]();
    expect(items).toHaveLength(4);
  });

  it('can return a requested resubmission as final', async () => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...submitted, status: 'resubmission_requested' }),
    );
    await expect(returnIt()).resolves.toBeDefined();
  });

  it('gives each round its own id', async () => {
    await returnIt();
    await returnIt();
    const [first, second] = returnSubmissionWrites.mock.calls.map(
      (call) => call[1].feedbackId,
    );
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('refuses a student who left', async () => {
    enrolmentGet.mockReturnValue(resolves({ status: 'dropped' }));
    await expect(returnIt()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message:
        'This student has left the course. Their work can be read but not graded.',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses points over the maximum', async () => {
    await expect(returnIt({ points: 10.5 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Points must be between 0 and 10',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('accepts exactly the maximum and zero', async () => {
    await expect(returnIt({ points: 10 })).resolves.toBeDefined();
    await expect(returnIt({ points: 0 })).resolves.toBeDefined();
  });

  it('refuses an already returned submission read at its current revision', async () => {
    assignmentSubmissionGet.mockReturnValue(resolves(returned));
    await expect(returnIt({ reviewRevision: 4 })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('is CONFLICT for a stale version', async () => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...submitted, version: 3 }),
    );
    await expect(returnIt()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'The student submitted a newer version',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('is CONFLICT for a stale review revision', async () => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...submitted, reviewRevision: 4 }),
    );
    await expect(returnIt()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Another instructor already returned this',
    });
  });

  it('is CONFLICT when the transaction loses a race, naming what changed', async () => {
    transactionGo.mockResolvedValue(cancelledCondition);
    assignmentSubmissionGet
      .mockReturnValueOnce(resolves(submitted))
      .mockReturnValue(resolves(returned));

    await expect(returnIt()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Another instructor already returned this',
    });
  });

  it('lets one of two returns from one revision through', async () => {
    transactionGo
      .mockResolvedValueOnce({ canceled: false, data: [] })
      .mockResolvedValueOnce(cancelledCondition);
    assignmentSubmissionGet
      .mockReturnValueOnce(resolves(submitted))
      .mockReturnValueOnce(resolves(submitted))
      .mockReturnValue(resolves(returned));

    const results = await Promise.allSettled([returnIt(), returnIt()]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
  });

  // The replay of a committed return: same version and revision as the first
  // call, which now reads a returned submission at the next revision.
  it('refuses a replay of a return that committed, writing nothing', async () => {
    assignmentSubmissionGet.mockReturnValue(resolves(returned));

    await expect(returnIt()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(returnSubmissionWrites).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('is a server error when the transaction fails for another reason', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'ValidationError' }],
    });
    await expect(returnIt()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('requestResubmission', () => {
  const request = (extra: Record<string, unknown> = {}) =>
    callAs().requestResubmission({
      ...grading,
      feedback: doc('Redo'),
      ...extra,
    });

  it('writes the request for a submitted submission', async () => {
    await expect(request()).resolves.toEqual({ reviewRevision: 4 });
    expect(requestResubmissionWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ...student, feedback: doc('Redo') }),
    );
  });

  it('refuses a submission that already has a request', async () => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...submitted, status: 'resubmission_requested' }),
    );
    await expect(request()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('refuses a returned submission', async () => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...returned, reviewRevision: 3 }),
    );
    await expect(request()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('refuses empty feedback before anything is read', async () => {
    await expect(request({ feedback: doc('') })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(assignmentSubmissionGet).not.toHaveBeenCalled();
  });

  it('is CONFLICT for a stale version', async () => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...submitted, version: 5 }),
    );
    await expect(request()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a student who left', async () => {
    enrolmentGet.mockReturnValue(resolves({ status: 'dropped' }));
    await expect(request()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});

describe('amendGrade', () => {
  const amend = (extra: Record<string, unknown> = {}) =>
    callAs().amendGrade({
      ...student,
      reviewRevision: 4,
      points: 9,
      ...extra,
    });

  beforeEach(() => {
    assignmentSubmissionGet.mockReturnValue(resolves(returned));
  });

  it('amends a returned submission and leaves its return alone', async () => {
    await expect(amend()).resolves.toEqual({ reviewRevision: 5 });

    expect(amendGradeWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ points: 9, pointsOutOf: 10, version: 2 }),
    );
    expect(amendGradeWrites.mock.calls[0]![1]).not.toHaveProperty('returnedAt');
  });

  it('refuses a submission that is not returned', async () => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...submitted, reviewRevision: 4 }),
    );
    await expect(amend()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('is CONFLICT when someone amended first', async () => {
    assignmentSubmissionGet.mockReturnValue(
      resolves({ ...returned, reviewRevision: 5 }),
    );
    await expect(amend()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'The grade was changed by someone else',
    });
  });

  it('refuses points over the maximum', async () => {
    await expect(amend({ points: 11 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('refuses a student who left', async () => {
    enrolmentGet.mockReturnValue(resolves({ status: 'dropped' }));
    await expect(amend()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});
