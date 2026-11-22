/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCertificateEntity } from './certificate.js';
import { createCertificateEventEntity } from './certificate-event.js';

let event: Awaited<ReturnType<typeof createCertificateEventEntity>>;
let certificate: Awaited<ReturnType<typeof createCertificateEntity>>;
beforeAll(async () => {
  event = await createCertificateEventEntity();
  certificate = await createCertificateEntity();
});

const full = {
  userId: 'user-1',
  courseId: 'course-1',
  occurredAt: '2026-11-02T00:00:00.000Z',
  certificateId: '0123456789ABCDEF',
  type: 'revoked',
  actorId: 'actor-1',
  actorRole: 'instructor',
} as const;

type Query = { ExpressionAttributeValues: Record<string, string> };

describe('certificateEvent', () => {
  it('accepts a record with only its required attributes', () => {
    expect(() => event.create(full).params()).not.toThrow();
  });

  it('accepts a reason and a note', () => {
    expect(() =>
      event.create({ ...full, reason: 'other', note: 'Copied work' }).params(),
    ).not.toThrow();
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => event.create(record as never).params()).toThrow();
  });

  it('refuses a type, role or reason outside the sets', () => {
    expect(() =>
      event.create({ ...full, type: 'deleted' } as never).params(),
    ).toThrow();
    expect(() =>
      event.create({ ...full, actorRole: 'student' } as never).params(),
    ).toThrow();
    expect(() =>
      event.create({ ...full, reason: 'spite' } as never).params(),
    ).toThrow();
  });

  it('keys by student, course and time', () => {
    const { Item } = event.create(full).params() as {
      Item: Record<string, string>;
    };
    expect(Item.pk).toContain('user-1');
    expect(Item.sk).toContain('course-1');
    expect(Item.sk).toContain(full.occurredAt.toLowerCase());
  });

  it('reads one certificate’s history by its own course, never another’s', () => {
    const query = event.query
      .primary({ userId: 'user-1', courseId: 'course-1' })
      .params() as Query;
    const values = Object.values(query.ExpressionAttributeValues);
    expect(values.some((v) => v.includes('course-1'))).toBe(true);
    expect(values.some((v) => v.includes('course-2'))).toBe(false);
    expect(values.some((v) => v.includes('certificateevent'))).toBe(true);
  });
});

describe('certificate revocation attributes', () => {
  const issued = {
    userId: 'user-1',
    courseId: 'course-1',
    certificateId: '0123456789ABCDEF',
    learnerName: 'Erin Nguyen',
    courseTitle: 'Intro',
    completedAt: '2026-11-01T00:00:00.000Z',
    issuedAt: '2026-11-01T00:00:01.000Z',
    assessment: {
      criteriaVersion: 1,
      requireQuizPass: false,
      itemCount: 3,
      assessedItemCount: 0,
      assessedItems: [],
    },
  };

  it('accepts the three attributes, all optional', () => {
    expect(() => certificate.create(issued).params()).not.toThrow();
    expect(() =>
      certificate
        .create({
          ...issued,
          revokedAt: '2026-11-02T00:00:00.000Z',
          revocationReason: 'refunded',
          revokedByRole: 'admin',
        })
        .params(),
    ).not.toThrow();
  });

  it('can set and remove them on an existing certificate', () => {
    const key = { userId: 'user-1', courseId: 'course-1' };
    expect(() =>
      certificate
        .patch(key)
        .set({
          revokedAt: '2026-11-02T00:00:00.000Z',
          revocationReason: 'issued-in-error',
          revokedByRole: 'instructor',
        })
        .params(),
    ).not.toThrow();
    expect(() =>
      certificate
        .patch(key)
        .remove(['revokedAt', 'revocationReason', 'revokedByRole'])
        .params(),
    ).not.toThrow();
  });

  it('refuses a reason or role outside the sets', () => {
    expect(() =>
      certificate
        .create({ ...issued, revocationReason: 'spite' as never })
        .params(),
    ).toThrow();
    expect(() =>
      certificate
        .create({ ...issued, revokedByRole: 'student' as never })
        .params(),
    ).toThrow();
  });
});
