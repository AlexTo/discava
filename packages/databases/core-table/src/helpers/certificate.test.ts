/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  formatCertificateId,
  generateCertificateId,
  issueCertificate,
  learnerName,
  normaliseCertificateId,
  recordLinkedInClick,
} from './certificate.js';
import { VersionConflictError } from './errors.js';
import { notificationId, publishNotification } from './notification.js';
import { createFakeNotificationTable } from './notification-fake.test.js';

describe('generateCertificateId', () => {
  it('makes 16 characters of the Crockford alphabet, never I L O U', () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateCertificateId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    }
  });

  it('does not collide in 10,000 IDs', () => {
    const ids = new Set(
      Array.from({ length: 10_000 }, () => generateCertificateId()),
    );
    expect(ids.size).toBe(10_000);
  });
});

describe('formatCertificateId and normaliseCertificateId', () => {
  const id = '0123456789ABCDEF';

  it('formats in groups of four', () => {
    expect(formatCertificateId(id)).toBe('0123-4567-89AB-CDEF');
  });

  it('round-trips', () => {
    const generated = generateCertificateId();
    expect(normaliseCertificateId(formatCertificateId(generated))).toBe(
      generated,
    );
  });

  it('accepts lowercase, dash-less and spaced input', () => {
    expect(normaliseCertificateId('0123456789abcdef')).toBe(id);
    expect(normaliseCertificateId(' 0123 4567 89ab cdef ')).toBe(id);
  });

  it('maps O to 0, and I and L to 1', () => {
    expect(normaliseCertificateId('OIL3456789ABCDEF')).toBe('0113456789ABCDEF');
  });

  it('rejects 15 and 17 characters and characters outside the alphabet', () => {
    expect(normaliseCertificateId('0123456789ABCDE')).toBeUndefined();
    expect(normaliseCertificateId('0123456789ABCDEFG')).toBeUndefined();
    expect(normaliseCertificateId('0123456789ABCDEU')).toBeUndefined();
    expect(normaliseCertificateId('0123456789ABCD!F')).toBeUndefined();
  });
});

describe('learnerName', () => {
  it('joins given and family names', () => {
    expect(learnerName({ givenName: 'Erin', familyName: 'Nguyen' })).toBe(
      'Erin Nguyen',
    );
  });

  it('uses whichever there is', () => {
    expect(learnerName({ givenName: 'Erin' })).toBe('Erin');
    expect(learnerName({ familyName: ' Nguyen ' })).toBe('Nguyen');
  });

  it('falls back with neither, whitespace only, or no user', () => {
    expect(learnerName({})).toBe('Discava learner');
    expect(learnerName({ givenName: ' ', familyName: '  ' })).toBe(
      'Discava learner',
    );
    expect(learnerName(null)).toBe('Discava learner');
  });

  it('never uses the email', () => {
    expect(learnerName({ email: 'erin@example.com' } as never)).toBe(
      'Discava learner',
    );
  });
});

const NOW = new Date('2026-11-15T00:00:00.000Z');
const enrolment = {
  userId: 'u1',
  courseId: 'c1',
  status: 'completed' as const,
  completedAt: '2026-11-10T00:00:00.000Z',
};
const course = { courseId: 'c1', title: 'Intro', certificatesEnabled: true };
const user = { givenName: 'Erin', familyName: 'Nguyen' };
const evaluation = {
  met: true,
  requirements: [],
  assessment: {
    criteriaVersion: 1,
    requireQuizPass: false,
    itemCount: 3,
    assessedItemCount: 0,
    assessedItems: [],
  },
};

// The fake table enforces the transaction's all-or-nothing writes and the
// certificate's conditional create.
const table = () => createFakeNotificationTable();

const issue = (
  coreTable: ReturnType<typeof table>['service'],
  overrides: Partial<Parameters<typeof issueCertificate>[0]> = {},
) =>
  issueCertificate({
    coreTable,
    enrolment,
    course,
    evaluation,
    user,
    now: NOW,
    ...overrides,
  });

describe('issueCertificate', () => {
  it('creates a certificate from the enrolment, course and user', async () => {
    const { service, rows } = table();
    const certificate = await issue(service);
    expect(rows.certificate!.size).toBe(1);
    expect(certificate).toMatchObject({
      userId: 'u1',
      courseId: 'c1',
      learnerName: 'Erin Nguyen',
      courseTitle: 'Intro',
      completedAt: enrolment.completedAt,
      issuedAt: NOW.toISOString(),
    });
    expect(certificate?.certificateId).toMatch(/^[0-9A-Z]{16}$/);
  });

  it('stores the assessment as given, with no courseHours without durationHours', async () => {
    const { service } = table();
    const certificate = await issue(service);
    expect(certificate?.assessment).toEqual(evaluation.assessment);
    expect(certificate?.assessment).not.toHaveProperty('courseHours');
  });

  it('stores courseHours when the course states durationHours', async () => {
    const { service } = table();
    const certificate = await issue(service, {
      course: { ...course, durationHours: 12 },
    });
    expect(certificate?.assessment).toEqual({
      ...evaluation.assessment,
      courseHours: 12,
    });
  });

  it('writes nothing, and looks up no ID, when the criteria are not met', async () => {
    const { service, rows, log } = table();
    const query = vi.spyOn(
      service.entities.certificate.query,
      'byCertificateId',
    );
    expect(
      await issue(service, { evaluation: { ...evaluation, met: false } }),
    ).toBeUndefined();
    expect(rows.certificate!.size).toBe(0);
    expect(rows.notification!.size).toBe(0);
    expect(log.transactions).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an existing certificate even when the evaluation is unmet', async () => {
    const { service, rows } = table();
    const first = await issue(service);
    const again = await issue(service, {
      evaluation: { ...evaluation, met: false },
    });
    expect(again?.certificateId).toBe(first?.certificateId);
    expect(rows.certificate!.size).toBe(1);
  });

  it('creates one certificate.issued notification with it, keyed by the stored ID and timed at issuedAt', async () => {
    const { service, rows } = table();
    const certificate = await issue(service);
    expect(rows.notification!.size).toBe(1);
    const [n] = [...rows.notification!.values()];
    expect(n).toMatchObject({
      userId: 'u1',
      type: 'certificate.issued',
      occurredAt: NOW.toISOString(),
      id: notificationId('certificate.issued', certificate!.certificateId),
      title: 'Your certificate for Intro is ready',
      link: {
        portal: 'student',
        path: `/certificates/${formatCertificateId(certificate!.certificateId)}`,
      },
      action: {
        label: 'Add to LinkedIn profile',
        path: `/certificates/${formatCertificateId(certificate!.certificateId)}/linkedin?source=issued-email`,
      },
    });
    expect(rows.notificationState!.get('u1')).toMatchObject({
      unreadCount: 1,
    });
  });

  it('adds one to the unread count of a learner who has other notifications', async () => {
    const { service, rows } = table();
    await publishNotification(service, {
      type: 'review.received',
      userId: 'u1',
      params: { courseId: 'c9', courseTitle: 'Other', rating: '5' },
      dedupeKey: 'r1',
      occurredAt: '2026-11-01T00:00:00.000Z',
    });
    await issue(service);
    expect(rows.notificationState!.get('u1')).toMatchObject({
      unreadCount: 2,
      version: 2,
    });
  });

  it.each([
    ['active', { status: 'active' as const }],
    ['dropped', { status: 'dropped' as const }],
    ['completed without completedAt', { completedAt: undefined }],
  ])('writes nothing for a %s enrolment', async (_, patch) => {
    const { service, rows, log } = table();
    expect(
      await issue(service, { enrolment: { ...enrolment, ...patch } }),
    ).toBeUndefined();
    expect(rows.certificate!.size).toBe(0);
    expect(rows.notification!.size).toBe(0);
    expect(log.transactions).toBe(0);
  });

  it('writes nothing when the course has certificates off', async () => {
    const { service, rows } = table();
    expect(
      await issue(service, {
        course: { ...course, certificatesEnabled: false },
      }),
    ).toBeUndefined();
    expect(rows.certificate!.size).toBe(0);
    expect(rows.notification!.size).toBe(0);
  });

  it('returns the first call’s certificate on a second call, leaving one certificate and one notification', async () => {
    const { service, rows, log } = table();
    const first = await issue(service);
    const second = await issue(service);
    expect(second?.certificateId).toBe(first?.certificateId);
    expect(rows.certificate!.size).toBe(1);
    expect(rows.notification!.size).toBe(1);
    expect(log.transactions).toBe(1);
  });

  it('leaves one certificate and one notification when two issue at once', async () => {
    const { service, rows } = table();
    const [a, b] = await Promise.all([issue(service), issue(service)]);
    expect(a?.certificateId).toBe(b?.certificateId);
    expect(rows.certificate!.size).toBe(1);
    expect(rows.notification!.size).toBe(1);
    expect(rows.notificationState!.get('u1')).toMatchObject({
      unreadCount: 1,
    });
  });

  it('returns the winner’s record, and writes no second notification, when the create loses its condition', async () => {
    const { service, rows, hooks } = table();
    const winner = {
      userId: 'u1',
      courseId: 'c1',
      certificateId: 'WINNER0000000000',
    };
    hooks.beforeTransaction = () => {
      rows.certificate!.set('u1|c1', winner);
    };
    const certificate = await issue(service);
    expect(certificate?.certificateId).toBe('WINNER0000000000');
    expect(rows.notification!.size).toBe(0);
  });

  it('retries a notification state that moved, and succeeds', async () => {
    const { service, rows, hooks, log } = table();
    await publishNotification(service, {
      type: 'review.received',
      userId: 'u1',
      params: { courseId: 'c9', courseTitle: 'Other', rating: '5' },
      dedupeKey: 'r1',
      occurredAt: '2026-11-01T00:00:00.000Z',
    });
    let moved = false;
    hooks.beforeTransaction = () => {
      if (!moved) {
        moved = true;
        rows.notificationState!.get('u1')!.version += 1;
      }
    };
    const certificate = await issue(service);
    expect(certificate).toBeDefined();
    expect(log.cancelled).toBe(1);
    expect(rows.certificate!.size).toBe(1);
    expect(rows.notification!.size).toBe(2);
  });

  it('throws VersionConflictError when the state keeps moving', async () => {
    const { service, rows, hooks } = table();
    await publishNotification(service, {
      type: 'review.received',
      userId: 'u1',
      params: { courseId: 'c9', courseTitle: 'Other', rating: '5' },
      dedupeKey: 'r1',
      occurredAt: '2026-11-01T00:00:00.000Z',
    });
    hooks.beforeTransaction = () => {
      rows.notificationState!.get('u1')!.version += 1;
    };
    await expect(issue(service)).rejects.toBeInstanceOf(VersionConflictError);
    expect(rows.certificate!.size).toBe(0);
  });

  it('regenerates an ID found on the index', async () => {
    const { service, rows } = table();
    const query = vi.spyOn(
      service.entities.certificate.query,
      'byCertificateId',
    );
    let taken = 2;
    query.mockImplementation((() => ({
      go: async () => ({ data: taken-- > 0 ? [{}] : [] }),
    })) as never);
    await issue(service);
    expect(query).toHaveBeenCalledTimes(3);
    expect(rows.certificate!.size).toBe(1);
  });

  it('throws after five collisions', async () => {
    const { service, rows } = table();
    const query = vi.spyOn(
      service.entities.certificate.query,
      'byCertificateId',
    );
    query.mockImplementation((() => ({
      go: async () => ({ data: [{}] }),
    })) as never);
    await expect(issue(service)).rejects.toThrow(/5 tries/);
    expect(query).toHaveBeenCalledTimes(5);
    expect(rows.certificate!.size).toBe(0);
  });

  it('uses the fallback name for a missing user', async () => {
    const { service } = table();
    const certificate = await issue(service, { user: null });
    expect(certificate?.learnerName).toBe('Discava learner');
  });
});

// An in-memory certificate entity with the patch's `notExists` condition.
const fakeForClick = () => {
  const store = new Map<string, Record<string, unknown>>([
    [
      'u1/c1',
      { userId: 'u1', courseId: 'c1', certificateId: '0123456789ABCDEF' },
    ],
  ]);
  const query = vi.fn(({ certificateId }: { certificateId: string }) => ({
    go: async () => ({
      data: [...store.values()].filter(
        (c) => c.certificateId === certificateId,
      ),
    }),
  }));
  const patch = vi.fn(({ userId, courseId }) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        go: async () => {
          const item = store.get(`${userId}/${courseId}`);
          if (!item || item.linkedInClickedAt) {
            throw new Error('conflict', {
              cause: Object.assign(new Error('x'), {
                name: 'ConditionalCheckFailedException',
              }),
            });
          }
          Object.assign(item, values);
          return { data: item };
        },
      }),
    }),
  }));
  return {
    coreTable: {
      entities: { certificate: { query: { byCertificateId: query }, patch } },
    } as never,
    store,
    query,
    patch,
  };
};

describe('recordLinkedInClick', () => {
  const click = (
    coreTable: never,
    source: Parameters<typeof recordLinkedInClick>[0]['source'] = 'my-learning',
    certificateId = '0123-4567-89ab-cdef',
    now = NOW,
  ) => recordLinkedInClick({ coreTable, certificateId, source, now });

  it('records the first use', async () => {
    const { coreTable, store } = fakeForClick();
    expect(await click(coreTable)).toBe('recorded');
    expect(store.get('u1/c1')).toMatchObject({
      linkedInClickedAt: NOW.toISOString(),
      linkedInClickSource: 'my-learning',
    });
  });

  it('keeps the first source and time on a second call', async () => {
    const { coreTable, store } = fakeForClick();
    await click(coreTable);
    expect(
      await click(
        coreTable,
        'reminder-email',
        undefined,
        new Date(NOW.getTime() + 1000),
      ),
    ).toBe('already-recorded');
    expect(store.get('u1/c1')).toMatchObject({
      linkedInClickedAt: NOW.toISOString(),
      linkedInClickSource: 'my-learning',
    });
  });

  it('stores one of two calls at once', async () => {
    const { coreTable, store } = fakeForClick();
    const results = await Promise.all([
      click(coreTable, 'my-learning'),
      click(coreTable, 'certificate-page'),
    ]);
    expect(results.sort()).toEqual(['already-recorded', 'recorded']);
    expect(store.get('u1/c1')?.linkedInClickSource).toBe('my-learning');
  });

  it('returns undefined for an unknown ID', async () => {
    const { coreTable, patch } = fakeForClick();
    expect(
      await click(coreTable, 'my-learning', 'ZZZZZZZZZZZZZZZZ'),
    ).toBeUndefined();
    expect(patch).not.toHaveBeenCalled();
  });

  it('returns undefined for a malformed ID without reading the table', async () => {
    const { coreTable, query } = fakeForClick();
    expect(await click(coreTable, 'my-learning', 'nope')).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('throws any other error', async () => {
    const { coreTable, patch } = fakeForClick();
    patch.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(click(coreTable)).rejects.toThrow('boom');
  });
});
