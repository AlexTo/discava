/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  certificateHistory,
  listCertificates,
  restoreCertificate,
  revokeCertificate,
} from './certificate.js';

const {
  certificateQueryByCertificateId,
  certificateQueryByCourse,
  certificateEventQueryPrimary,
  courseInstructorGet,
  userGet,
  revokeStored,
  restoreStored,
  mockModule,
} = await vi.hoisted(async () => ({
  revokeStored: vi.fn(),
  restoreStored: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    certificate: ['query.byCertificateId', 'query.byCourse'],
    certificateEvent: ['query.primary'],
    courseInstructor: ['get'],
    user: ['get'],
  }),
}));

vi.mock('@discava/core-table', async (importActual) => {
  const actual = await importActual<typeof import('@discava/core-table')>();
  return mockModule(actual, {
    revokeCertificate: revokeStored,
    restoreCertificate: restoreStored,
  });
});

const router = t.router({
  list: listCertificates,
  history: certificateHistory,
  revoke: revokeCertificate,
  restore: restoreCertificate,
});

const callAs = (sub = 'ins-1', groups = ['instructor']) =>
  callerFor(router, { sub, groups });

const stored = (over: Record<string, unknown> = {}) => ({
  userId: 'student-1',
  courseId: 'c1',
  certificateId: '0123456789ABCDEF',
  learnerName: 'Erin Nguyen',
  courseTitle: 'Intro',
  completedAt: '2026-11-10T00:00:00.000Z',
  issuedAt: '2026-11-10T00:00:01.000Z',
  ...over,
});
const revoked = (over: Record<string, unknown> = {}) =>
  stored({
    revokedAt: '2026-11-12T00:00:00.000Z',
    revocationReason: 'issued-in-error',
    revokedByRole: 'instructor',
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  courseInstructorGet.mockImplementation(({ courseId, instructorId }) => ({
    go: async () => ({
      data: courseId === 'c1' && instructorId === 'ins-1' ? {} : null,
    }),
  }));
  certificateQueryByCertificateId.mockReturnValue({
    go: async () => ({ data: [stored()] }),
  });
  revokeStored.mockImplementation(async () => revoked());
  restoreStored.mockImplementation(async () => stored());
});

const calls = {
  list: (c = callAs()) => c.list({ courseId: 'c1' }),
  history: (c = callAs()) =>
    c.history({ courseId: 'c1', certificateId: '0123-4567-89AB-CDEF' }),
  revoke: (c = callAs()) =>
    c.revoke({
      courseId: 'c1',
      certificateId: '0123-4567-89AB-CDEF',
      reason: 'issued-in-error',
    }),
  restore: (c = callAs()) =>
    c.restore({ courseId: 'c1', certificateId: '0123-4567-89AB-CDEF' }),
};

describe('access', () => {
  it.each(['list', 'history', 'revoke', 'restore'] as const)(
    '%s is for the course’s instructors only',
    async (name) => {
      await expect(calls[name](callAs('ins-2'))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(calls[name](callAs('ins-1', []))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(revokeStored).not.toHaveBeenCalled();
      expect(restoreStored).not.toHaveBeenCalled();
    },
  );

  it.each(['history', 'revoke', 'restore'] as const)(
    '%s says NOT_FOUND for a certificate of another course, and for a bad ID',
    async (name) => {
      certificateQueryByCertificateId.mockReturnValue({
        go: async () => ({ data: [stored({ courseId: 'c2' })] }),
      });
      await expect(calls[name]()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Certificate not found',
      });
      certificateQueryByCertificateId.mockReturnValue({
        go: async () => ({ data: [] }),
      });
      await expect(calls[name]()).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(revokeStored).not.toHaveBeenCalled();
      expect(restoreStored).not.toHaveBeenCalled();
    },
  );
});

describe('certificate.list', () => {
  const go = vi.fn();
  beforeEach(() => {
    go.mockReset();
    certificateQueryByCourse.mockReturnValue({ go });
  });

  it('reads one byCourse page, newest first, 50 at most, with no student id or email', async () => {
    go.mockResolvedValue({
      data: [stored(), revoked({ certificateId: 'FEDCBA9876543210' })],
      cursor: 'next',
    });
    const result = await calls.list();
    expect(certificateQueryByCourse).toHaveBeenCalledWith({ courseId: 'c1' });
    expect(go).toHaveBeenCalledWith({
      order: 'desc',
      limit: 50,
      cursor: undefined,
    });
    expect(result.nextCursor).toBe('next');
    expect(result.items).toEqual([
      {
        certificateId: '0123-4567-89AB-CDEF',
        learnerName: 'Erin Nguyen',
        completedAt: '2026-11-10T00:00:00.000Z',
        issuedAt: '2026-11-10T00:00:01.000Z',
        status: 'valid',
        canRestore: false,
      },
      {
        certificateId: 'FEDC-BA98-7654-3210',
        learnerName: 'Erin Nguyen',
        completedAt: '2026-11-10T00:00:00.000Z',
        issuedAt: '2026-11-10T00:00:01.000Z',
        status: 'revoked',
        revokedAt: '2026-11-12T00:00:00.000Z',
        revocationReason: 'issued-in-error',
        revokedByRole: 'instructor',
        canRestore: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('student-1');
  });

  it('passes the cursor on, and omits nextCursor on the last page', async () => {
    go.mockResolvedValue({ data: [], cursor: null });
    const result = await callAs().list({ courseId: 'c1', cursor: 'abc' });
    expect(go).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'abc' }));
    expect(result).toEqual({ items: [] });
  });

  it('refuses a cursor the table rejects', async () => {
    go.mockRejectedValue(new Error('bad key'));
    await expect(
      callAs().list({ courseId: 'c1', cursor: 'nonsense' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('cannot restore an administrator’s revocation', async () => {
    go.mockResolvedValue({
      data: [revoked({ revokedByRole: 'admin', revocationReason: 'refunded' })],
    });
    expect((await calls.list()).items[0]).toMatchObject({
      status: 'revoked',
      canRestore: false,
    });
  });
});

describe('certificate.revoke', () => {
  it('revokes as an instructor and returns the item as revoked', async () => {
    const result = await calls.revoke();
    expect(revokeStored).toHaveBeenCalledWith(
      expect.objectContaining({
        certificate: stored(),
        actor: { id: 'ins-1', role: 'instructor' },
        reason: 'issued-in-error',
      }),
    );
    expect(result).toMatchObject({
      certificateId: '0123-4567-89AB-CDEF',
      status: 'revoked',
      canRestore: true,
    });
  });

  it('returns the same state when it is revoked already, writing no second event', async () => {
    certificateQueryByCertificateId.mockReturnValue({
      go: async () => ({ data: [revoked()] }),
    });
    const first = await calls.revoke();
    const second = await calls.revoke();
    expect(second).toEqual(first);
    // The helper decides there is nothing to write; see core-table's tests.
    expect(revokeStored).toHaveBeenCalledTimes(2);
  });

  it('refuses refunded as a validation error', async () => {
    await expect(
      callAs().revoke({
        courseId: 'c1',
        certificateId: '0123-4567-89AB-CDEF',
        reason: 'refunded' as never,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(revokeStored).not.toHaveBeenCalled();
  });

  it('refuses a note over 500 characters', async () => {
    await expect(
      callAs().revoke({
        courseId: 'c1',
        certificateId: '0123-4567-89AB-CDEF',
        reason: 'other',
        note: 'x'.repeat(501),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses other without a note', async () => {
    const { InvalidRequestError } = await import('@discava/core-table');
    revokeStored.mockRejectedValue(
      new InvalidRequestError('Say why in a note'),
    );
    await expect(
      callAs().revoke({
        courseId: 'c1',
        certificateId: '0123-4567-89AB-CDEF',
        reason: 'other',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Say why in a note',
    });
  });
});

describe('certificate.restore', () => {
  it('restores as an instructor and returns the item as valid', async () => {
    certificateQueryByCertificateId.mockReturnValue({
      go: async () => ({ data: [revoked()] }),
    });
    const result = await calls.restore();
    expect(restoreStored).toHaveBeenCalledWith(
      expect.objectContaining({
        certificate: revoked(),
        actor: { id: 'ins-1', role: 'instructor' },
      }),
    );
    expect(result).toMatchObject({ status: 'valid', canRestore: false });
  });

  it('is FORBIDDEN for an administrator’s revocation', async () => {
    const { RestoreForbiddenError } = await import('@discava/core-table');
    certificateQueryByCertificateId.mockReturnValue({
      go: async () => ({
        data: [
          revoked({ revokedByRole: 'admin', revocationReason: 'refunded' }),
        ],
      }),
    });
    restoreStored.mockRejectedValue(new RestoreForbiddenError());
    await expect(calls.restore()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'An administrator revoked this certificate',
    });
  });
});

describe('certificate.history', () => {
  it('lists events oldest first and hides which administrator acted', async () => {
    certificateEventQueryPrimary.mockReturnValue({
      go: async () => ({
        data: [
          {
            type: 'restored',
            occurredAt: '2026-11-14T00:00:00.000Z',
            actorRole: 'admin',
            actorId: 'admin-secret',
            note: 'Checked',
          },
          {
            type: 'revoked',
            occurredAt: '2026-11-12T00:00:00.000Z',
            reason: 'academic-integrity',
            actorRole: 'instructor',
            actorId: 'ins-1',
          },
        ],
      }),
    });
    userGet.mockReturnValue({
      go: async () => ({
        data: [{ userId: 'ins-1', givenName: 'Dan', familyName: 'Lee' }],
      }),
    });
    const result = await calls.history();
    expect(certificateEventQueryPrimary).toHaveBeenCalledWith({
      userId: 'student-1',
      courseId: 'c1',
    });
    expect(userGet).toHaveBeenCalledWith([{ userId: 'ins-1' }]);
    expect(result).toEqual([
      {
        type: 'revoked',
        occurredAt: '2026-11-12T00:00:00.000Z',
        reason: 'academic-integrity',
        actorRole: 'instructor',
        actorName: 'Dan Lee',
      },
      {
        type: 'restored',
        occurredAt: '2026-11-14T00:00:00.000Z',
        note: 'Checked',
        actorRole: 'admin',
        actorName: 'An administrator',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('admin-secret');
  });
});
