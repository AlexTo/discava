/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { PDF } from '@libpdf/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawCertificatePdf } from '../helpers/certificate-pdf.js';
import { t } from '../init.js';
import {
  certificatePdf,
  myCertificates,
  verifyCertificate,
} from './certificate.js';

const { db, calls } = vi.hoisted(() => ({
  db: { certificates: [] as any[] },
  calls: {
    byCertificateId: [] as any[],
    primary: [] as any[],
    get: [] as any[],
    course: 0,
  },
}));

vi.mock('../helpers/certificate-pdf.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../helpers/certificate-pdf.js')>();
  return { drawCertificatePdf: vi.fn(actual.drawCertificatePdf) };
});

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      certificate: {
        query: {
          byCertificateId: (key: any) => ({
            go: async () => {
              calls.byCertificateId.push(key);
              return {
                data: db.certificates.filter(
                  (c) => c.certificateId === key.certificateId,
                ),
              };
            },
          }),
          primary: (key: any) => ({
            go: async () => {
              calls.primary.push(key);
              return {
                data: db.certificates.filter((c) => c.userId === key.userId),
              };
            },
          }),
        },
        get: (key: any) => ({
          go: async () => {
            calls.get.push(key);
            return {
              data:
                db.certificates.find(
                  (c) => c.userId === key.userId && c.courseId === key.courseId,
                ) ?? null,
            };
          },
        }),
      },
      course: {
        get: () => {
          calls.course++;
          throw new Error('the course must not be read');
        },
      },
    },
  })),
}));

const record = (overrides: Record<string, unknown> = {}) => ({
  userId: 'u1',
  courseId: 'c1',
  certificateId: '0123456789ABCDEF',
  learnerName: 'Erin Nguyen',
  courseTitle: 'Intro',
  completedAt: '2026-11-10T00:00:00.000Z',
  issuedAt: '2026-11-10T00:00:01.000Z',
  ...overrides,
});

const caller = (
  procedure: any,
  { sub, origin }: { sub?: string; origin?: string } = {},
) =>
  (
    callerFor(t.router({ p: procedure }), {
      sub,
      headers: origin ? { origin } : {},
    }) as any
  ).p;

beforeEach(() => {
  db.certificates = [];
  calls.byCertificateId = [];
  calls.primary = [];
  calls.get = [];
  calls.course = 0;
  delete process.env.ALLOWED_ORIGINS;
});

describe('certificate.verify', () => {
  it('finds a certificate and shows its ID in display form', async () => {
    db.certificates = [record()];
    expect(
      await caller(verifyCertificate)({ certificateId: '0123-4567-89AB-CDEF' }),
    ).toEqual({
      certificateId: '0123-4567-89AB-CDEF',
      learnerName: 'Erin Nguyen',
      courseTitle: 'Intro',
      completedAt: '2026-11-10T00:00:00.000Z',
    });
  });

  it('finds a lowercase, dash-less ID', async () => {
    db.certificates = [record()];
    const result = await caller(verifyCertificate)({
      certificateId: '0123456789abcdef',
    });
    expect(result.certificateId).toBe('0123-4567-89AB-CDEF');
    expect(calls.byCertificateId).toEqual([
      { certificateId: '0123456789ABCDEF' },
    ]);
  });

  it('refuses a malformed ID without reading the table', async () => {
    await expect(
      caller(verifyCertificate)({ certificateId: 'nope' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Certificate not found',
    });
    expect(calls.byCertificateId).toEqual([]);
  });

  it('refuses an unknown ID with the same error as a malformed one', async () => {
    const errors = await Promise.all(
      ['FFFFFFFFFFFFFFFF', 'nope'].map((certificateId) =>
        caller(verifyCertificate)({ certificateId }).catch((e: any) => e),
      ),
    );
    expect(calls.byCertificateId).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Certificate not found',
    });
    expect(errors[1].code).toBe(errors[0].code);
    expect(errors[1].message).toBe(errors[0].message);
  });

  it('returns exactly four keys even when the record holds more', async () => {
    db.certificates = [record()];
    const result = await caller(verifyCertificate)({
      certificateId: '0123456789ABCDEF',
    });
    expect(Object.keys(result).sort()).toEqual([
      'certificateId',
      'completedAt',
      'courseTitle',
      'learnerName',
    ]);
  });
});

describe('certificate.myCertificates', () => {
  it("lists only the caller's certificates, most recent first", async () => {
    db.certificates = [
      record({ courseId: 'c1', completedAt: '2026-01-01T00:00:00.000Z' }),
      record({
        courseId: 'c2',
        certificateId: '2222222222222222',
        completedAt: '2026-06-01T00:00:00.000Z',
      }),
      record({
        userId: 'u2',
        courseId: 'c3',
        certificateId: '3333333333333333',
      }),
    ];
    const result = await caller(myCertificates, { sub: 'u1' })();
    expect(result.map((c: any) => c.courseId)).toEqual(['c2', 'c1']);
    expect(result[0]).toEqual({
      certificateId: '2222-2222-2222-2222',
      courseId: 'c2',
      courseTitle: 'Intro',
      learnerName: 'Erin Nguyen',
      completedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(calls.primary).toEqual([{ userId: 'u1' }]);
  });

  it('refuses an anonymous caller', async () => {
    await expect(caller(myCertificates)()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('certificate.pdf', () => {
  it('draws the caller’s certificate with the verification URL', async () => {
    process.env.ALLOWED_ORIGINS = 'https://portal.example.com';
    db.certificates = [record()];
    const result = await caller(certificatePdf, {
      sub: 'u1',
      origin: 'https://portal.example.com',
    })({ courseId: 'c1' });
    expect(result.fileName).toBe('certificate-0123-4567-89AB-CDEF.pdf');
    const bytes = Buffer.from(result.contentBase64, 'base64');
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect((await PDF.load(Uint8Array.from(bytes))).getPageCount()).toBe(1);
    expect(drawCertificatePdf).toHaveBeenLastCalledWith(
      expect.objectContaining({
        verifyUrl:
          'https://portal.example.com/certificates/0123-4567-89AB-CDEF',
      }),
    );
    expect(calls.get).toEqual([{ userId: 'u1', courseId: 'c1' }]);
  });

  it("is NOT_FOUND for another student's course, querying with the caller's sub", async () => {
    db.certificates = [record({ userId: 'u2' })];
    await expect(
      caller(certificatePdf, { sub: 'u1' })({
        courseId: 'c1',
        userId: 'u2',
      } as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls.get).toEqual([{ userId: 'u1', courseId: 'c1' }]);
  });

  it('works without reading the course record', async () => {
    db.certificates = [record()];
    await caller(certificatePdf, { sub: 'u1' })({ courseId: 'c1' });
    expect(calls.course).toBe(0);
  });

  it('refuses an anonymous caller', async () => {
    await expect(
      caller(certificatePdf)({ courseId: 'c1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
