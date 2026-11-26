/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import { checkTableInvariants, consistentTable, T } from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});

describe('certificate-linkedin-click-shape', () => {
  const ISSUED = '2026-01-03T00:00:00.000Z';
  const setup = () => {
    table.enrolments[0].status = 'completed';
    table.enrolments[0].completedAt = ISSUED;
    table.certificates.push({
      userId: 'student',
      courseId: 'c1',
      certificateId: '0123456789ABCDEF',
      learnerName: 'Erin Nguyen',
      courseTitle: 'Intro',
      completedAt: ISSUED,
      issuedAt: ISSUED,
      assessment: {
        criteriaVersion: 1,
        requireQuizPass: false,
        itemCount: 4,
        assessedItemCount: 0,
        assessedItems: [],
      },
    });
    return table.certificates[0];
  };
  const violationsOf = () =>
    checkTableInvariants(table).filter(
      (v) => v.invariant === 'certificate-linkedin-click-shape',
    );

  it('accepts no use, and a use after issue', () => {
    const certificate = setup();
    expect(violationsOf()).toEqual([]);
    certificate.linkedInClickedAt = '2026-01-04T00:00:00.000Z';
    certificate.linkedInClickSource = 'my-learning';
    expect(violationsOf()).toEqual([]);
  });

  it('reports a time without a source', () => {
    setup().linkedInClickedAt = '2026-01-04T00:00:00.000Z';
    expect(violationsOf()[0]?.message).toMatch(/exactly when/);
  });

  it('reports a source without a time', () => {
    setup().linkedInClickSource = 'my-learning';
    expect(violationsOf()[0]?.message).toMatch(/exactly when/);
  });

  it('reports an unknown source', () => {
    const certificate = setup();
    certificate.linkedInClickedAt = '2026-01-04T00:00:00.000Z';
    certificate.linkedInClickSource = 'twitter' as never;
    expect(violationsOf()[0]?.message).toMatch(/unknown/);
  });

  it('reports a use before the certificate was issued', () => {
    const certificate = setup();
    certificate.linkedInClickedAt = '2026-01-02T00:00:00.000Z';
    certificate.linkedInClickSource = 'my-learning';
    expect(violationsOf()[0]?.message).toMatch(/before issuedAt/);
  });
});

describe('certificate-shape and certificate-has-completed-enrolment', () => {
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
      assessment: {
        criteriaVersion: 1,
        requireQuizPass: false,
        itemCount: 4,
        assessedItemCount: 0,
        assessedItems: [],
      },
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
      // A refunded student keeps their certificate while the enrolment holds
      // the same completedAt, so the dropped case has none.
      if (status === 'dropped') table.enrolments[0].completedAt = undefined;
      expect(
        violationsOf('certificate-has-completed-enrolment')[0]?.message,
      ).toMatch(new RegExp(`is ${status}`));
    },
  );

  it('accepts a dropped enrolment with the same completedAt (a refunded student)', () => {
    issued();
    table.enrolments[0].status = 'dropped';
    expect(violationsOf('certificate-has-completed-enrolment')).toEqual([]);
  });

  it('reports a dropped enrolment with a different completedAt', () => {
    issued();
    table.enrolments[0].status = 'dropped';
    table.enrolments[0].completedAt = '2026-01-04T00:00:00.000Z';
    expect(
      violationsOf('certificate-has-completed-enrolment')[0]?.message,
    ).toMatch(/is dropped|completedAt differs/);
  });

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
      createdAt: table.enrolments[0].createdAt,
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

describe('certificate-notifications-match', () => {
  const ISSUED = '2026-01-03T00:00:00.000Z';
  const NOW = '2026-01-03T00:00:00.000Z';
  const certificate = (userId: string, certificateId: string) => ({
    userId,
    courseId: 'c1',
    certificateId,
    learnerName: 'Erin Nguyen',
    courseTitle: 'Intro',
    completedAt: ISSUED,
    issuedAt: ISSUED,
    assessment: {
      criteriaVersion: 1,
      requireQuizPass: false,
      itemCount: 4,
      assessedItemCount: 0,
      assessedItems: [],
    },
  });
  const notification = (id: string, path: string, userId = 'student') => ({
    userId,
    occurredAt: NOW,
    id,
    type: 'certificate.issued',
    link: { portal: 'student' as const, path },
    email: { state: 'skipped' as const, reason: 'never' },
    createdAt: NOW,
  });
  const setup = () => {
    table.enrolments[0].status = 'completed';
    table.enrolments[0].completedAt = ISSUED;
    table.certificates.push(certificate('student', '0123456789ABCDEF'));
    table.notifications = [
      notification('a1b2c3d4e5f60718', '/certificates/0123-4567-89AB-CDEF'),
    ];
    table.notificationStates = [{ userId: 'student', unreadCount: 1 }];
  };
  const violationsOf = () =>
    checkTableInvariants(table).filter(
      (v) => v.invariant === 'certificate-notifications-match',
    );

  it('accepts a notification naming its own certificate', () => {
    setup();
    expect(violationsOf()).toEqual([]);
  });

  it('accepts a certificate with no notification', () => {
    setup();
    table.notifications = [];
    table.notificationStates = [];
    expect(violationsOf()).toEqual([]);
  });

  it('reports an unknown ID', () => {
    setup();
    table.notifications[0].link.path = '/certificates/ZZZZ-ZZZZ-ZZZZ-ZZZZ';
    expect(violationsOf()[0]?.message).toMatch(/does not name a certificate/);
  });

  it('reports a path that is not /certificates/<ID>', () => {
    setup();
    table.notifications[0].link.path = '/learn/c1';
    expect(violationsOf()).toHaveLength(1);
  });

  it('reports another user’s certificate', () => {
    setup();
    table.certificates[0].userId = 'someone-else';
    expect(violationsOf()[0]?.message).toMatch(/another user/);
  });

  it('reports two notifications on one certificate', () => {
    setup();
    table.notifications.push(
      notification('b1b2c3d4e5f60718', '/certificates/0123-4567-89AB-CDEF'),
    );
    expect(violationsOf()).toHaveLength(1);
    expect(violationsOf()[0]?.message).toMatch(/more than one/);
  });
});

describe('certificate assessment and criteria invariants', () => {
  const ISSUED = '2026-01-03T00:00:00.000Z';
  const issue = (
    assessment: Partial<
      NonNullable<TableSnapshot['certificates'][number]['assessment']>
    > = {},
  ) => {
    table.enrolments[0].status = 'completed';
    table.enrolments[0].completedAt = ISSUED;
    table.certificates.push({
      userId: 'student',
      courseId: 'c1',
      certificateId: '0123456789ABCDEF',
      learnerName: 'Erin Nguyen',
      courseTitle: 'Intro',
      completedAt: ISSUED,
      issuedAt: ISSUED,
      assessment: {
        criteriaVersion: 1,
        requireQuizPass: false,
        itemCount: 4,
        assessedItemCount: 0,
        assessedItems: [],
        ...assessment,
      },
    });
    return table.certificates[0];
  };
  const quizAssessment = {
    requireQuizPass: true,
    assessedItemCount: 1,
    assessedItems: [
      {
        contentItemId: 'quiz',
        kind: 'quiz' as const,
        scorePercent: 80,
        passMarkPercent: 70,
      },
    ],
    passMarkLowest: 70,
    passMarkHighest: 70,
    scoreBand: 80,
  };
  const of = (invariant: InvariantName) =>
    checkTableInvariants(table)
      .filter((v) => v.invariant === invariant)
      .map((v) => v.message);

  it('accepts both an empty and a quiz assessment', () => {
    issue();
    expect(of('certificate-shape')).toEqual([]);
    expect(of('certificate-met-criteria')).toEqual([]);
    table.certificates = [];
    issue(quizAssessment);
    expect(of('certificate-shape')).toEqual([]);
    expect(of('certificate-met-criteria')).toEqual([]);
  });

  it('reports a missing assessment', () => {
    delete (issue() as { assessment?: unknown }).assessment;
    expect(of('certificate-shape')).toContain('assessment is missing');
  });

  it.each([
    ['criteriaVersion below 1', { criteriaVersion: 0 }, /criteriaVersion/],
    ['itemCount below 1', { itemCount: 0 }, /itemCount/],
    ['a count that is not the length', { assessedItemCount: 2 }, /list length/],
    ['a band with nothing assessed', { scoreBand: 0 }, /nothing assessed/],
    [
      'no band with a quiz',
      { ...quizAssessment, scoreBand: undefined },
      /lacks/,
    ],
    [
      'a band not a multiple of 10',
      { ...quizAssessment, scoreBand: 85 },
      /not 0, 10/,
    ],
    [
      'a band that is not the mean’s',
      { ...quizAssessment, scoreBand: 70 },
      /mean/,
    ],
    [
      'lowest above highest',
      { ...quizAssessment, passMarkLowest: 90 },
      /passMarkLowest/,
    ],
  ])('reports %s', (_, assessment, message) => {
    issue(assessment);
    expect(of('certificate-shape').join('\n')).toMatch(message);
  });

  it('reports a listed quiz below its pass mark', () => {
    issue({
      ...quizAssessment,
      assessedItems: [{ ...quizAssessment.assessedItems[0], scorePercent: 60 }],
    });
    expect(of('certificate-met-criteria').join('\n')).toMatch(
      /below its pass mark/,
    );
  });

  it('reports a listed quiz with a pass mark of 0', () => {
    issue({
      ...quizAssessment,
      assessedItems: [
        { ...quizAssessment.assessedItems[0], passMarkPercent: 0 },
      ],
    });
    expect(of('certificate-met-criteria').join('\n')).toMatch(
      /below its pass mark/,
    );
  });

  it('reports a listed quiz with no summary, a late pass or a lower best score', () => {
    issue(quizAssessment);
    table.quizSummaries = [];
    expect(of('certificate-met-criteria')).toHaveLength(1);
    table.quizSummaries = consistentTable().quizSummaries;
    table.quizSummaries[0].passedAt = '2026-01-04T00:00:00.000Z';
    expect(of('certificate-met-criteria')).toHaveLength(1);
    table.quizSummaries[0].passedAt = T;
    table.quizSummaries[0].bestScore = 70;
    expect(of('certificate-met-criteria')).toHaveLength(1);
  });

  describe('with a minimum upload score', () => {
    const uploadAssessment = {
      minUploadScorePercent: 60,
      assessedItemCount: 1,
      assessedItems: [
        { contentItemId: 'work', kind: 'upload' as const, scorePercent: 70 },
      ],
      scoreBand: 70,
      passMarkLowest: undefined,
    };
    const submission = (status: 'returned' | 'submitted' = 'returned') =>
      ({
        ...consistentTable().assignmentSubmissions[0],
        userId: 'student',
        courseId: 'c1',
        contentItemId: 'work',
        status,
      }) as TableSnapshot['assignmentSubmissions'][number];
    const issueUpload = (extra = {}) => {
      const { passMarkLowest: _, ...assessment } = uploadAssessment;
      issue({ ...assessment, ...extra } as never);
    };

    it('accepts an upload scored at the threshold with a submission', () => {
      issueUpload();
      table.assignmentSubmissions = [submission()];
      expect(of('certificate-met-criteria')).toEqual([]);
      // No pass marks, as no quiz was assessed.
      expect(of('certificate-shape')).toEqual([]);
    });

    it('reports pass marks on a certificate that assessed no quiz', () => {
      issueUpload({ passMarkLowest: 70, passMarkHighest: 70 });
      expect(of('certificate-shape').join('\n')).toMatch(/lacks pass marks/);
    });

    it('accepts a submission reopened since issue', () => {
      issueUpload();
      table.assignmentSubmissions = [submission('submitted')];
      expect(of('certificate-met-criteria')).toEqual([]);
    });

    it('reports an upload below the threshold', () => {
      issueUpload({
        assessedItems: [
          { contentItemId: 'work', kind: 'upload', scorePercent: 59 },
        ],
      });
      table.assignmentSubmissions = [submission()];
      expect(of('certificate-met-criteria').join('\n')).toMatch(
        /below the required 60%/,
      );
    });

    it('reports an upload with no submission', () => {
      issueUpload();
      expect(of('certificate-met-criteria').join('\n')).toMatch(
        /no submission/,
      );
    });

    it('reports an upload listed without a minimum score', () => {
      issueUpload({ minUploadScorePercent: undefined });
      table.assignmentSubmissions = [submission()];
      expect(of('certificate-met-criteria').join('\n')).toMatch(
        /no score was required/,
      );
    });
  });

  it('reports a listed quiz when quiz pass was not required', () => {
    issue({ ...quizAssessment, requireQuizPass: false });
    expect(of('certificate-met-criteria').join('\n')).toMatch(
      /quiz pass was not required/,
    );
  });

  it('does not report a completed enrolment with no certificate', () => {
    table.enrolments[0].status = 'completed';
    table.enrolments[0].completedAt = ISSUED;
    expect(of('certificate-met-criteria')).toEqual([]);
    expect(of('certificate-shape')).toEqual([]);
  });

  it('does not report an assessment that differs from the course’s current criteria', () => {
    issue(quizAssessment);
    table.courses[0].certificateCriteria = {
      version: 5,
      requireQuizPass: false,
    };
    expect(of('certificate-met-criteria')).toEqual([]);
    expect(of('certificate-shape')).toEqual([]);
  });

  it('does not report a listed quiz since hidden or given a higher pass mark', () => {
    issue(quizAssessment);
    const quiz = table.contentItems.find((i) => i.contentItemId === 'quiz');
    if (quiz) {
      quiz.visibility = 'hidden';
      (quiz as { settings?: unknown }).settings = { passMarkPercent: 95 };
    }
    expect(of('certificate-met-criteria')).toEqual([]);
  });

  it('checks every course’s criteria', () => {
    expect(of('course-certificate-criteria-shape')).toEqual([]);
    for (const bad of [
      { version: 0, requireQuizPass: false },
      { version: 1.5, requireQuizPass: false },
      { version: 1, requireQuizPass: false, minUploadScorePercent: 0 },
      { version: 1, requireQuizPass: false, minUploadScorePercent: 101 },
    ]) {
      table.courses[0].certificateCriteria = bad;
      expect(of('course-certificate-criteria-shape')).toHaveLength(1);
    }
    table.courses[0].certificateCriteria = {
      version: 2,
      requireQuizPass: true,
      minUploadScorePercent: 100,
    };
    expect(of('course-certificate-criteria-shape')).toEqual([]);
    delete (table.courses[0] as { certificateCriteria?: unknown })
      .certificateCriteria;
    expect(of('course-certificate-criteria-shape')).toHaveLength(1);
  });
});

describe('certificate-reminder-not-after-click', () => {
  const ISSUED = '2026-01-03T00:00:00.000Z';
  const setup = () => {
    table.enrolments[0].status = 'completed';
    table.enrolments[0].completedAt = ISSUED;
    table.certificates.push({
      userId: 'student',
      courseId: 'c1',
      certificateId: '0123456789ABCDEF',
      learnerName: 'Erin Nguyen',
      courseTitle: 'Intro',
      completedAt: ISSUED,
      issuedAt: ISSUED,
      assessment: {
        criteriaVersion: 1,
        requireQuizPass: false,
        itemCount: 4,
        assessedItemCount: 0,
        assessedItems: [],
      },
    });
    return table.certificates[0];
  };
  const violationsOf = () =>
    checkTableInvariants(table).filter(
      (v) => v.invariant === 'certificate-reminder-not-after-click',
    );

  it('accepts a scheduled reminder that was not sent', () => {
    const certificate = setup();
    certificate.reminderScheduledAt = '2026-01-03T00:00:01.000Z';
    expect(violationsOf()).toEqual([]);
  });

  it('accepts a reminder before the click, and at the same time', () => {
    const certificate = setup();
    certificate.reminderSentAt = '2026-01-06T00:00:00.000Z';
    certificate.linkedInClickedAt = '2026-01-07T00:00:00.000Z';
    certificate.linkedInClickSource = 'reminder-email';
    expect(violationsOf()).toEqual([]);
    certificate.linkedInClickedAt = '2026-01-06T00:00:00.000Z';
    expect(violationsOf()).toEqual([]);
  });

  it('accepts a reminder stamped just after the click it won against', () => {
    const certificate = setup();
    certificate.linkedInClickedAt = '2026-01-06T00:00:00.000Z';
    certificate.linkedInClickSource = 'my-learning';
    certificate.reminderSentAt = '2026-01-06T00:00:05.000Z';
    expect(violationsOf()).toEqual([]);
    certificate.reminderSentAt = '2026-01-06T00:00:05.001Z';
    expect(violationsOf()[0]?.message).toMatch(/after linkedInClickedAt/);
  });

  it('reports a reminder after the click', () => {
    const certificate = setup();
    certificate.linkedInClickedAt = '2026-01-04T00:00:00.000Z';
    certificate.linkedInClickSource = 'my-learning';
    certificate.reminderSentAt = '2026-01-06T00:00:00.000Z';
    expect(violationsOf()[0]?.message).toMatch(/after linkedInClickedAt/);
  });

  it('reports a reminder before the certificate was issued', () => {
    const certificate = setup();
    certificate.reminderSentAt = '2026-01-02T00:00:00.000Z';
    expect(violationsOf()[0]?.message).toMatch(/before issuedAt/);
  });
});

describe('certificate-notifications-match for reminders', () => {
  const ISSUED = '2026-01-03T00:00:00.000Z';
  const SENT = '2026-01-06T00:00:00.000Z';
  const reminder = (id: string, userId = 'student', occurredAt = SENT) => ({
    userId,
    occurredAt,
    id,
    type: 'certificate.reminder',
    link: {
      portal: 'student' as const,
      path: '/certificates/0123-4567-89AB-CDEF',
    },
    email: { state: 'skipped' as const, reason: 'never' },
    createdAt: occurredAt,
  });
  const setup = () => {
    table.enrolments[0].status = 'completed';
    table.enrolments[0].completedAt = ISSUED;
    table.certificates.push({
      userId: 'student',
      courseId: 'c1',
      certificateId: '0123456789ABCDEF',
      learnerName: 'Erin Nguyen',
      courseTitle: 'Intro',
      completedAt: ISSUED,
      issuedAt: ISSUED,
      assessment: {
        criteriaVersion: 1,
        requireQuizPass: false,
        itemCount: 4,
        assessedItemCount: 0,
        assessedItems: [],
      },
      reminderSentAt: SENT,
    });
    table.notifications = [reminder('a1b2c3d4e5f60718')];
    table.notificationStates = [{ userId: 'student', unreadCount: 1 }];
  };
  const violationsOf = () =>
    checkTableInvariants(table).filter(
      (v) => v.invariant === 'certificate-notifications-match',
    );

  it('accepts a reminder matching its certificate’s reminderSentAt', () => {
    setup();
    expect(violationsOf()).toEqual([]);
  });

  it('accepts one issued and one reminder notification on a certificate', () => {
    setup();
    table.notifications.push({
      ...reminder('b1b2c3d4e5f60718', 'student', ISSUED),
      type: 'certificate.issued',
    });
    expect(violationsOf()).toEqual([]);
  });

  it('reports a reminder whose time differs from reminderSentAt', () => {
    setup();
    table.certificates[0].reminderSentAt = '2026-01-07T00:00:00.000Z';
    expect(violationsOf()[0]?.message).toMatch(/reminderSentAt/);
  });

  it('reports a reminder for a certificate with no reminderSentAt', () => {
    setup();
    table.certificates[0].reminderSentAt = undefined;
    expect(violationsOf()).toHaveLength(1);
  });

  it('reports another user’s certificate', () => {
    setup();
    table.certificates[0].userId = 'someone-else';
    expect(violationsOf()[0]?.message).toMatch(/another user/);
  });

  it('reports two reminders on one certificate', () => {
    setup();
    table.notifications.push(reminder('b1b2c3d4e5f60718'));
    expect(violationsOf()).toHaveLength(1);
    expect(violationsOf()[0]?.message).toMatch(/more than one/);
  });
});

describe('certificate revocation invariants', () => {
  const COMPLETED = '2026-01-03T00:00:00.000Z';
  const REVOKED = '2026-01-04T00:00:00.000Z';
  const RESTORED = '2026-01-05T00:00:00.000Z';
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
      assessment: {
        criteriaVersion: 1,
        requireQuizPass: false,
        itemCount: 4,
        assessedItemCount: 0,
        assessedItems: [],
      },
    });
    return table.certificates[0];
  };
  const event = (
    over: Partial<TableSnapshot['certificateEvents'][number]> = {},
  ): TableSnapshot['certificateEvents'][number] => ({
    userId: 'student',
    courseId: 'c1',
    occurredAt: REVOKED,
    certificateId: '0123456789ABCDEF',
    type: 'revoked',
    reason: 'issued-in-error',
    actorId: 'instructor',
    actorRole: 'instructor',
    ...over,
  });
  const revoked = () => {
    const certificate = issued();
    certificate.revokedAt = REVOKED;
    certificate.revocationReason = 'issued-in-error';
    certificate.revokedByRole = 'instructor';
    table.certificateEvents.push(event());
    return certificate;
  };
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  it('accepts a valid certificate, a revoked one and a restored one', () => {
    const certificate = issued();
    expect(violationsOf('certificate-status-matches-history')).toEqual([]);

    certificate.revokedAt = REVOKED;
    certificate.revocationReason = 'issued-in-error';
    certificate.revokedByRole = 'instructor';
    table.certificateEvents.push(event());
    expect(violationsOf('certificate-shape')).toEqual([]);
    expect(violationsOf('certificate-status-matches-history')).toEqual([]);

    table.certificateEvents.push(
      event({ type: 'restored', occurredAt: RESTORED, reason: undefined }),
    );
    delete certificate.revokedAt;
    delete certificate.revocationReason;
    delete certificate.revokedByRole;
    expect(violationsOf('certificate-status-matches-history')).toEqual([]);
  });

  it('shape: reports only some of the three attributes set', () => {
    delete revoked().revokedByRole;
    expect(violationsOf('certificate-shape')[0]?.message).toMatch(
      /all set or all absent/,
    );
  });

  it('shape: reports revokedAt before issuedAt', () => {
    revoked().revokedAt = '2026-01-02T00:00:00.000Z';
    expect(
      violationsOf('certificate-shape').some((v) =>
        /revokedAt is before issuedAt/.test(v.message),
      ),
    ).toBe(true);
  });

  it('history: reports a revoked certificate with no events', () => {
    revoked();
    table.certificateEvents.length = 0;
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/no events/);
  });

  it('history: reports a revoked certificate whose latest event is a restoration', () => {
    revoked();
    table.certificateEvents.push(
      event({ type: 'restored', occurredAt: RESTORED, reason: undefined }),
    );
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/latest event is a restoration/);
  });

  it('history: reports a valid certificate whose latest event is a revocation', () => {
    const certificate = revoked();
    delete certificate.revokedAt;
    delete certificate.revocationReason;
    delete certificate.revokedByRole;
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/differs from the latest event/);
  });

  it.each([
    ['time', { revokedAt: '2026-01-04T00:00:01.000Z' }],
    ['reason', { revocationReason: 'other' as const }],
    ['role', { revokedByRole: 'admin' as const }],
  ])('history: reports a different %s', (_name, change) => {
    Object.assign(revoked(), change);
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/differs from the latest event/);
  });

  it('history: reports an event for a missing certificate', () => {
    table.certificateEvents.push(event({ userId: 'nobody' }));
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/does not exist/);
  });

  it('history: reports an event naming another certificate ID', () => {
    revoked();
    table.certificateEvents[0].certificateId = 'FEDCBA9876543210';
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/names certificate/);
  });

  it('history: reports events that do not alternate from a revocation', () => {
    revoked();
    table.certificateEvents.push(event({ occurredAt: RESTORED }));
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/alternate/);
  });

  it('history: reports a first event that is a restoration', () => {
    issued();
    table.certificateEvents.push(
      event({ type: 'restored', reason: undefined }),
    );
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/alternate/);
  });

  it('history: reports an event without an actor', () => {
    revoked();
    table.certificateEvents[0].actorId = '';
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/no actor/);
  });

  it('history: reports refunded by an instructor', () => {
    const certificate = revoked();
    certificate.revocationReason = 'refunded';
    table.certificateEvents[0].reason = 'refunded';
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/refunded/);
  });

  it('history: accepts refunded by an administrator, and reports other without a note', () => {
    const certificate = revoked();
    certificate.revocationReason = 'refunded';
    certificate.revokedByRole = 'admin';
    Object.assign(table.certificateEvents[0], {
      reason: 'refunded',
      actorRole: 'admin',
    });
    expect(violationsOf('certificate-status-matches-history')).toEqual([]);

    certificate.revocationReason = 'other';
    table.certificateEvents[0].reason = 'other';
    expect(
      violationsOf('certificate-status-matches-history')[0]?.message,
    ).toMatch(/no note/);
    table.certificateEvents[0].note = 'Copied work';
    expect(violationsOf('certificate-status-matches-history')).toEqual([]);
  });

  describe('certificate-has-completed-enrolment is unchanged', () => {
    it('accepts a revoked certificate with a completed enrolment', () => {
      revoked();
      expect(violationsOf('certificate-has-completed-enrolment')).toEqual([]);
    });

    it('accepts a revoked certificate with a dropped enrolment keeping completedAt', () => {
      revoked();
      table.enrolments[0].status = 'dropped';
      expect(violationsOf('certificate-has-completed-enrolment')).toEqual([]);
    });

    it('reports a revoked certificate with an active enrolment', () => {
      revoked();
      table.enrolments[0].status = 'active';
      expect(
        violationsOf('certificate-has-completed-enrolment')[0]?.message,
      ).toMatch(/not completed/);
    });
  });
});
