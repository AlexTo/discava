/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  getCertificate,
  restoreCertificate,
  revokeCertificate,
} from './certificate.js';

const {
  certificateQueryByCertificateId,
  certificateEventQueryPrimary,
  userGet,
  revokeStored,
  restoreStored,
  mockModule,
} = await vi.hoisted(async () => ({
  revokeStored: vi.fn(),
  restoreStored: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    certificate: ['query.byCertificateId'],
    certificateEvent: ['query.primary'],
    user: ['get'],
  }),
}));

vi.mock('@discava/core-table', async (importActual) =>
  mockModule(await importActual(), {
    revokeCertificate: revokeStored,
    restoreCertificate: restoreStored,
  }),
);

const router = t.router({
  get: getCertificate,
  revoke: revokeCertificate,
  restore: restoreCertificate,
});

const callAs = (groups: string[] | null = ['admin']) =>
  callerFor(router, groups ? { sub: 'admin-1', groups } : {});

const stored = (over: Record<string, unknown> = {}) => ({
  userId: 'student-1',
  courseId: 'c1',
  certificateId: '0123456789ABCDEF',
  learnerName: 'Erin Nguyen',
  courseTitle: 'Intro',
  completedAt: '2026-11-10T00:00:00.000Z',
  issuedAt: '2026-11-10T00:00:01.000Z',
  assessment: {
    criteriaVersion: 1,
    requireQuizPass: false,
    itemCount: 3,
    assessedItemCount: 0,
    assessedItems: [],
  },
  ...over,
});
const revoked = (over: Record<string, unknown> = {}) =>
  stored({
    revokedAt: '2026-11-12T00:00:00.000Z',
    revocationReason: 'issued-in-error',
    revokedByRole: 'instructor',
    ...over,
  });

const ID = '0123-4567-89AB-CDEF';

beforeEach(() => {
  vi.clearAllMocks();
  certificateQueryByCertificateId.mockReturnValue({
    go: async () => ({ data: [stored()] }),
  });
  certificateEventQueryPrimary.mockReturnValue({
    go: async () => ({ data: [] }),
  });
  userGet.mockReturnValue({ go: async () => ({ data: [] }) });
  revokeStored.mockImplementation(async () => revoked());
  restoreStored.mockImplementation(async () => stored());
});

describe('access', () => {
  it.each([
    ['get', { certificateId: ID }],
    ['revoke', { certificateId: ID, reason: 'refunded' }],
    ['restore', { certificateId: ID }],
  ] as const)('%s refuses a non-administrator', async (name, input) => {
    for (const caller of [callAs(['instructor']), callAs(null)]) {
      await expect((caller as any)[name](input)).rejects.toMatchObject({
        code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/),
      });
    }
    expect(revokeStored).not.toHaveBeenCalled();
    expect(restoreStored).not.toHaveBeenCalled();
  });
});

describe('malformed and unknown IDs', () => {
  it.each(['nope', 'FFFFFFFFFFFFFFFF'])('are NOT_FOUND (%s)', async (id) => {
    certificateQueryByCertificateId.mockReturnValue({
      go: async () => ({ data: [] }),
    });
    const c = callAs();
    for (const call of [
      () => c.get({ certificateId: id }),
      () => c.revoke({ certificateId: id, reason: 'refunded' }),
      () => c.restore({ certificateId: id }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Certificate not found',
      });
    }
    expect(revokeStored).not.toHaveBeenCalled();
  });
});

describe('certificate.get', () => {
  it('returns the printed details, the statement and the history with notes', async () => {
    certificateQueryByCertificateId.mockReturnValue({
      go: async () => ({ data: [revoked()] }),
    });
    certificateEventQueryPrimary.mockReturnValue({
      go: async () => ({
        data: [
          {
            type: 'revoked',
            occurredAt: '2026-11-12T00:00:00.000Z',
            reason: 'issued-in-error',
            note: 'Wrong course',
            actorId: 'ins-1',
            actorRole: 'instructor',
          },
        ],
      }),
    });
    userGet.mockReturnValue({
      go: async () => ({
        data: [{ userId: 'ins-1', givenName: 'Dan', familyName: 'Lee' }],
      }),
    });
    const result = await callAs().get({ certificateId: '0123456789abcdef' });
    expect(certificateQueryByCertificateId).toHaveBeenCalledWith({
      certificateId: '0123456789ABCDEF',
    });
    expect(result).toEqual({
      certificateId: ID,
      learnerName: 'Erin Nguyen',
      courseId: 'c1',
      courseTitle: 'Intro',
      completedAt: '2026-11-10T00:00:00.000Z',
      issuedAt: '2026-11-10T00:00:01.000Z',
      statement: [
        'Completed all 3 items of the course.',
        'No graded assessment was required for this certificate.',
      ],
      status: 'revoked',
      revokedAt: '2026-11-12T00:00:00.000Z',
      revocationReason: 'issued-in-error',
      revokedByRole: 'instructor',
      history: [
        {
          type: 'revoked',
          occurredAt: '2026-11-12T00:00:00.000Z',
          reason: 'issued-in-error',
          note: 'Wrong course',
          actorRole: 'instructor',
          actorName: 'Dan Lee',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('student-1');
  });

  it('shows a valid certificate with an empty history', async () => {
    const result = await callAs().get({ certificateId: ID });
    expect(result.status).toBe('valid');
    expect(result.history).toEqual([]);
    expect(result).not.toHaveProperty('revokedAt');
    expect(userGet).not.toHaveBeenCalled();
  });
});

describe('certificate.revoke', () => {
  it('accepts refunded and records the role admin', async () => {
    await callAs().revoke({ certificateId: ID, reason: 'refunded' });
    expect(revokeStored).toHaveBeenCalledWith(
      expect.objectContaining({
        certificate: stored(),
        actor: { id: 'admin-1', role: 'admin' },
        reason: 'refunded',
      }),
    );
  });

  it('refuses other without a note', async () => {
    const { InvalidRequestError } = await import('@discava/core-table');
    revokeStored.mockRejectedValue(
      new InvalidRequestError('Say why in a note'),
    );
    await expect(
      callAs().revoke({ certificateId: ID, reason: 'other' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('certificate.restore', () => {
  it('restores an instructor’s revocation as an administrator', async () => {
    certificateQueryByCertificateId.mockReturnValue({
      go: async () => ({ data: [revoked()] }),
    });
    const result = await callAs().restore({ certificateId: ID, note: 'ok' });
    expect(restoreStored).toHaveBeenCalledWith(
      expect.objectContaining({
        certificate: revoked(),
        actor: { id: 'admin-1', role: 'admin' },
        note: 'ok',
      }),
    );
    expect(result.certificateId).toBe(ID);
  });
});
