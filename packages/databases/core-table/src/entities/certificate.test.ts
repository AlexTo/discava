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
  process.env.LOCAL_DEV = 'true';
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
