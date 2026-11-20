/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCertificateEntity } from './certificate.js';
import { createEnrolmentEntity } from './enrolment.js';

let certificate: Awaited<ReturnType<typeof createCertificateEntity>>;
let enrolment: Awaited<ReturnType<typeof createEnrolmentEntity>>;
beforeAll(async () => {
  certificate = await createCertificateEntity();
  enrolment = await createEnrolmentEntity();
});

const full = {
  userId: 'user-1',
  courseId: 'course-1',
  certificateId: '0123456789ABCDEF',
  learnerName: 'Erin Nguyen',
  courseTitle: 'Intro',
  completedAt: '2026-11-01T00:00:00.000Z',
  issuedAt: '2026-11-01T00:00:01.000Z',
};

describe('certificate', () => {
  it('accepts a complete record', () => {
    expect(() => certificate.create(full).params()).not.toThrow();
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => certificate.create(record as never).params()).toThrow();
  });

  it('takes the LinkedIn use attributes, both optional', () => {
    expect(() => certificate.create(full).params()).not.toThrow();
    expect(() =>
      certificate
        .create({
          ...full,
          linkedInClickedAt: '2026-11-02T00:00:00.000Z',
          linkedInClickSource: 'my-learning',
        })
        .params(),
    ).not.toThrow();
  });

  it('accepts the reminder’s schedule and send times', () => {
    expect(() =>
      certificate
        .create({
          ...full,
          reminderScheduledAt: '2026-11-02T00:00:00.000Z',
          reminderSentAt: '2026-11-05T00:00:00.000Z',
        })
        .params(),
    ).not.toThrow();
  });

  it('refuses a LinkedIn source outside the four', () => {
    expect(() =>
      certificate
        .create({ ...full, linkedInClickSource: 'twitter' as never })
        .params(),
    ).toThrow();
  });

  it('keeps the printed attributes read-only', () => {
    for (const field of [
      'learnerName',
      'courseTitle',
      'completedAt',
      'issuedAt',
    ]) {
      expect(() =>
        certificate
          .patch({ userId: 'user-1', courseId: 'course-1' })
          .set({ [field]: 'x' } as never)
          .params(),
      ).toThrow();
    }
  });

  it('keys by student and course', () => {
    const { Item } = certificate.create(full).params() as {
      Item: Record<string, string>;
    };
    expect(Item.pk).toContain('user-1');
    expect(Item.sk).toContain('course-1');
  });

  it('queries byCertificateId on gsi1 with a key no enrolment key can equal', () => {
    const params = certificate.query
      .byCertificateId({ certificateId: full.certificateId })
      .params() as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(params.IndexName).toBe('gsi1pk-gsi1sk-index');
    const [queryKey] = Object.values(params.ExpressionAttributeValues);

    const { Item } = enrolment
      .create({ courseId: 'course-1', userId: 'user-1' })
      .params() as { Item: Record<string, string> };
    expect(queryKey).toContain('certificate');
    expect(Item.gsi1pk).not.toBe(queryKey);
    expect(Item.gsi1pk).not.toContain(full.certificateId);
  });
});
