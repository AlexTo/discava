/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import { checkTableInvariants, consistentTable } from './test-fixture.js';

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
