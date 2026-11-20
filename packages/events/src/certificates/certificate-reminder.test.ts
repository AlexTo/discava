/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { certificateReminder } from './certificate-reminder.js';

const { isEmailEnabled, claimCertificateReminder, publishNotification } =
  vi.hoisted(() => ({
    isEmailEnabled: vi.fn(),
    claimCertificateReminder: vi.fn(),
    publishNotification: vi.fn(),
  }));

vi.mock('@discava/core-table', () => ({
  createCoreTableService: async () => ({ entities: {} }),
  formatCertificateId: (id: string) => `${id.slice(0, 4)}-${id.slice(4)}`,
  isEmailEnabled,
  claimCertificateReminder,
  publishNotification,
}));

const event = { userId: 'user-1', courseId: 'course-1' };
const SENT_AT = '2026-11-23T00:00:00.000Z';
const claim = {
  certificate: { certificateId: 'ABCDEFGH23', courseTitle: 'Rust 101' },
  reminderSentAt: SENT_AT,
};

beforeEach(() => {
  vi.clearAllMocks();
  isEmailEnabled.mockResolvedValue(true);
  claimCertificateReminder.mockResolvedValue(claim);
  publishNotification.mockResolvedValue('created');
});

describe('certificateReminder', () => {
  it('publishes one reminder with the claimed time', async () => {
    await certificateReminder(event);

    expect(isEmailEnabled).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'certificate.reminder',
    );
    expect(claimCertificateReminder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', courseId: 'course-1' }),
    );
    expect(publishNotification).toHaveBeenCalledTimes(1);
    expect(publishNotification).toHaveBeenCalledWith(expect.anything(), {
      type: 'certificate.reminder',
      userId: 'user-1',
      params: { certificateId: 'ABCD-EFGH23', courseTitle: 'Rust 101' },
      dedupeKey: 'ABCDEFGH23',
      occurredAt: SENT_AT,
    });
  });

  it('does nothing, and claims nothing, when certificate emails are off', async () => {
    isEmailEnabled.mockResolvedValue(false);

    await certificateReminder(event);

    expect(claimCertificateReminder).not.toHaveBeenCalled();
    expect(publishNotification).not.toHaveBeenCalled();
  });

  it('publishes nothing when there is no certificate or a click won', async () => {
    claimCertificateReminder.mockResolvedValue(undefined);

    await certificateReminder(event);

    expect(publishNotification).not.toHaveBeenCalled();
  });

  it('publishes again with the stored time on a retry, which is a duplicate', async () => {
    publishNotification.mockResolvedValue('duplicate');

    await expect(certificateReminder(event)).resolves.toBeUndefined();

    expect(publishNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ occurredAt: SENT_AT }),
    );
  });

  it('lets a publishing failure propagate so the invocation is retried', async () => {
    publishNotification.mockRejectedValue(new Error('throttled'));

    await expect(certificateReminder(event)).rejects.toThrow('throttled');
  });

  it.each([
    ['no fields', {}],
    ['no course', { userId: 'user-1' }],
    ['an empty user', { userId: '', courseId: 'course-1' }],
    ['a string', 'nope'],
    ['nothing', undefined],
  ])('drops a malformed event (%s) without a write', async (_name, bad) => {
    await expect(certificateReminder(bad)).resolves.toBeUndefined();

    expect(isEmailEnabled).not.toHaveBeenCalled();
    expect(claimCertificateReminder).not.toHaveBeenCalled();
    expect(publishNotification).not.toHaveBeenCalled();
  });
});
