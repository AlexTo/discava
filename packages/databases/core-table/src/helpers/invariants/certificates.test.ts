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
      expect(
        violationsOf('certificate-has-completed-enrolment')[0]?.message,
      ).toMatch(new RegExp(`is ${status}`));
    },
  );

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
