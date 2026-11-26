/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CERTIFICATE_REMINDER_DELAY_DAYS,
  type Certificate,
  certificateReminderDueAt,
  claimCertificateReminder,
  formatCertificateId,
  generateCertificateId,
  issueCertificate,
  learnerName,
  markCertificateReminderScheduled,
  normaliseCertificateId,
  RestoreForbiddenError,
  recordLinkedInClick,
  restoreCertificate,
  revocationReasonLabel,
  revokeCertificate,
} from './certificate.js';
import { InvalidRequestError, VersionConflictError } from './errors.js';
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

  it('refuses a revoked certificate without recording a click', async () => {
    const { coreTable, store, patch } = fakeForClick();
    store.get('u1/c1')!.revokedAt = NOW.toISOString();
    expect(await click(coreTable)).toBeUndefined();
    expect(patch).not.toHaveBeenCalled();
    expect(store.get('u1/c1')?.linkedInClickedAt).toBeUndefined();
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

// An in-memory certificate entity that evaluates the `where` conditions the
// reminder helpers and recordLinkedInClick use (`notExists`, joined by AND).
const fakeForReminder = (initial: Record<string, unknown> = {}) => {
  const item: Record<string, unknown> = {
    userId: 'u1',
    courseId: 'c1',
    certificateId: '0123456789ABCDEF',
    issuedAt: '2026-11-10T00:00:00.000Z',
    ...initial,
  };
  const conditionFailed = () =>
    new Error('conflict', {
      cause: Object.assign(new Error('x'), {
        name: 'ConditionalCheckFailedException',
      }),
    });
  const patch = vi.fn(() => ({
    set: (values: Record<string, unknown>) => ({
      where: (cb: (attr: Record<string, string>, op: unknown) => string) => ({
        go: async () => {
          const attr = new Proxy({}, { get: (_t, name) => String(name) });
          const op = { notExists: (name: string) => `notExists:${name}` };
          const holds = cb(attr as Record<string, string>, op)
            .split(' AND ')
            .every((c) => item[c.replace('notExists:', '')] === undefined);
          if (!holds) {
            throw conditionFailed();
          }
          Object.assign(item, values);
          return { data: item };
        },
      }),
    }),
  }));
  const get = vi.fn(() => ({
    go: async () => ({ data: { ...item } }),
  }));
  return {
    coreTable: { entities: { certificate: { get, patch } } } as never,
    item,
    patch,
    get,
  };
};

describe('certificateReminderDueAt', () => {
  it('is issuedAt plus three days', () => {
    expect(CERTIFICATE_REMINDER_DELAY_DAYS).toBe(3);
    expect(
      certificateReminderDueAt({ issuedAt: '2026-11-10T12:30:00.000Z' }),
    ).toBe('2026-11-13T12:30:00.000Z');
  });
});

describe('markCertificateReminderScheduled', () => {
  const mark = (coreTable: never, now = NOW) =>
    markCertificateReminderScheduled({
      coreTable,
      userId: 'u1',
      courseId: 'c1',
      now,
    });

  it('sets reminderScheduledAt once', async () => {
    const { coreTable, item } = fakeForReminder();
    await mark(coreTable);
    await mark(coreTable, new Date(NOW.getTime() + 1000));
    expect(item.reminderScheduledAt).toBe(NOW.toISOString());
  });

  it('throws any other error', async () => {
    const { coreTable, patch } = fakeForReminder();
    patch.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(mark(coreTable)).rejects.toThrow('boom');
  });
});

describe('claimCertificateReminder', () => {
  const claim = (coreTable: never, now = NOW) =>
    claimCertificateReminder({ coreTable, userId: 'u1', courseId: 'c1', now });
  const click = (coreTable: never) =>
    recordLinkedInClick({
      coreTable,
      certificateId: '0123456789ABCDEF',
      source: 'certificate-page',
      now: NOW,
    });

  it('returns undefined when there is no certificate', async () => {
    const { coreTable, get } = fakeForReminder();
    get.mockReturnValueOnce({ go: async () => ({ data: null }) } as never);
    expect(await claim(coreTable)).toBeUndefined();
  });

  it('skips a revoked certificate', async () => {
    const { coreTable, item, patch } = fakeForReminder({
      revokedAt: NOW.toISOString(),
    });
    expect(await claim(coreTable)).toBeUndefined();
    expect(patch).not.toHaveBeenCalled();
    expect(item.reminderSentAt).toBeUndefined();
  });

  it('sets reminderSentAt and returns it', async () => {
    const { coreTable, item } = fakeForReminder();
    const claimed = await claim(coreTable);
    expect(claimed?.reminderSentAt).toBe(NOW.toISOString());
    expect(claimed?.certificate.certificateId).toBe('0123456789ABCDEF');
    expect(item.reminderSentAt).toBe(NOW.toISOString());
  });

  it('returns the first time on a second claim', async () => {
    const { coreTable, item, patch } = fakeForReminder();
    await claim(coreTable);
    const later = new Date(NOW.getTime() + 60_000);
    expect((await claim(coreTable, later))?.reminderSentAt).toBe(
      NOW.toISOString(),
    );
    expect(item.reminderSentAt).toBe(NOW.toISOString());
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('returns undefined and stores nothing after a click', async () => {
    const { coreTable, item } = fakeForReminder({
      linkedInClickedAt: '2026-11-11T00:00:00.000Z',
      linkedInClickSource: 'my-learning',
    });
    expect(await claim(coreTable)).toBeUndefined();
    expect(item.reminderSentAt).toBeUndefined();
  });

  it('still records a click after a claim', async () => {
    const { coreTable, item } = fakeForReminder();
    await claim(coreTable);
    const { coreTable: withQuery } = (() => {
      const query = {
        byCertificateId: () => ({ go: async () => ({ data: [item] }) }),
      };
      const entities = (coreTable as { entities: { certificate: object } })
        .entities;
      return {
        coreTable: {
          entities: { certificate: { ...entities.certificate, query } },
        } as never,
      };
    })();
    expect(await click(withQuery)).toBe('recorded');
    expect(item.reminderSentAt).toBeDefined();
    expect(item.linkedInClickedAt).toBe(NOW.toISOString());
  });

  it('reads the other run’s claim back when its own condition fails', async () => {
    const { coreTable, item, get } = fakeForReminder();
    // The first read sees no claim; the other run's lands before our patch.
    get.mockImplementationOnce(() => {
      const snapshot = { ...item };
      item.reminderSentAt = '2026-11-14T00:00:00.000Z';
      return { go: async () => ({ data: snapshot }) } as never;
    });
    const claimed = await claim(coreTable);
    expect(claimed?.reminderSentAt).toBe('2026-11-14T00:00:00.000Z');
    expect(item.reminderSentAt).toBe('2026-11-14T00:00:00.000Z');
  });

  it('returns undefined when a click lands between the read and the claim', async () => {
    const { coreTable, item, get } = fakeForReminder();
    get.mockImplementationOnce(() => {
      const snapshot = { ...item };
      item.linkedInClickedAt = '2026-11-11T00:00:00.000Z';
      return { go: async () => ({ data: snapshot }) } as never;
    });
    expect(await claim(coreTable)).toBeUndefined();
    expect(item.reminderSentAt).toBeUndefined();
  });

  it('ends in one of the two allowed states when a claim and a click race', async () => {
    const { coreTable, item } = fakeForReminder();
    const query = {
      byCertificateId: () => ({ go: async () => ({ data: [item] }) }),
    };
    const both = {
      entities: {
        certificate: {
          ...(coreTable as { entities: { certificate: object } }).entities
            .certificate,
          query,
        },
      },
    } as never;
    const [claimed, clicked] = await Promise.all([claim(both), click(both)]);
    if (claimed) {
      expect(item.reminderSentAt).toBeDefined();
    } else {
      expect(item.reminderSentAt).toBeUndefined();
    }
    expect(clicked).toBe('recorded');
    expect(item.linkedInClickedAt).toBeDefined();
  });

  it('throws any other error', async () => {
    const { coreTable, patch } = fakeForReminder();
    patch.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(claim(coreTable)).rejects.toThrow('boom');
  });
});

describe('revocationReasonLabel', () => {
  it('names each reason for a learner', () => {
    expect(revocationReasonLabel('academic-integrity')).toBe(
      'Academic integrity',
    );
    expect(revocationReasonLabel('issued-in-error')).toBe('Issued in error');
    expect(revocationReasonLabel('refunded')).toBe('Order refunded');
    expect(revocationReasonLabel('other')).toBe('Other');
  });
});

describe('revokeCertificate and restoreCertificate', () => {
  const instructor = { id: 'ins-1', role: 'instructor' } as const;
  const admin = { id: 'adm-1', role: 'admin' } as const;
  const T1 = new Date('2026-11-16T00:00:00.000Z');
  const T2 = new Date('2026-11-17T00:00:00.000Z');
  const T3 = new Date('2026-11-18T00:00:00.000Z');

  const issued = async () => {
    const fake = table();
    const certificate = (await issue(fake.service))!;
    return { ...fake, certificate };
  };
  const stored = (rows: ReturnType<typeof table>['rows']) =>
    [...rows.certificate!.values()][0]! as unknown as Certificate;
  const events = (rows: ReturnType<typeof table>['rows']) =>
    [...rows.certificateEvent!.values()].sort((a, b) =>
      a.occurredAt < b.occurredAt ? -1 : 1,
    );
  const notifications = (rows: ReturnType<typeof table>['rows']) => [
    ...rows.notification!.values(),
  ];

  describe('refusals write nothing', () => {
    it.each([
      ['refunded from an instructor', 'refunded', instructor, undefined],
      [
        'a note over 500 characters',
        'issued-in-error',
        instructor,
        'x'.repeat(501),
      ],
      ['other without a note', 'other', instructor, undefined],
      ['other with a blank note', 'other', admin, '   '],
    ] as const)('%s', async (_name, reason, actor, note) => {
      const { service, rows, certificate } = await issued();
      await expect(
        revokeCertificate({
          coreTable: service,
          certificate,
          actor,
          reason,
          note,
          now: T1,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);
      expect(stored(rows).revokedAt).toBeUndefined();
      expect(rows.certificateEvent!.size).toBe(0);
      expect(rows.notification!.size).toBe(1);
    });
  });

  it('sets the three attributes and one event with the same time', async () => {
    const { service, rows, certificate } = await issued();
    const revoked = await revokeCertificate({
      coreTable: service,
      certificate,
      actor: instructor,
      reason: 'issued-in-error',
      now: T1,
    });
    expect(revoked).toMatchObject({
      revokedAt: T1.toISOString(),
      revocationReason: 'issued-in-error',
      revokedByRole: 'instructor',
    });
    expect(events(rows)).toMatchObject([
      {
        userId: 'u1',
        courseId: 'c1',
        occurredAt: T1.toISOString(),
        certificateId: certificate.certificateId,
        type: 'revoked',
        reason: 'issued-in-error',
        actorId: 'ins-1',
        actorRole: 'instructor',
      },
    ]);
  });

  it('keeps a trimmed note on the event, and lets an administrator refund', async () => {
    const { service, rows, certificate } = await issued();
    await revokeCertificate({
      coreTable: service,
      certificate,
      actor: admin,
      reason: 'refunded',
      note: ' Chargeback ',
      now: T1,
    });
    expect(stored(rows)).toMatchObject({
      revocationReason: 'refunded',
      revokedByRole: 'admin',
    });
    expect(events(rows)[0]).toMatchObject({
      reason: 'refunded',
      note: 'Chargeback',
      actorRole: 'admin',
    });
  });

  it('leaves one event when two revokes run at once', async () => {
    const { service, rows, certificate } = await issued();
    const revoke = (actor: typeof instructor | typeof admin, now: Date) =>
      revokeCertificate({
        coreTable: service,
        certificate,
        actor,
        reason: 'issued-in-error',
        now,
      });
    const [a, b] = await Promise.all([
      revoke(instructor, T1),
      revoke(admin, T2),
    ]);
    expect(rows.certificateEvent!.size).toBe(1);
    expect(a.revokedAt).toBe(b.revokedAt);
    expect(
      notifications(rows).filter((n) => n.type === 'certificate.revoked'),
    ).toHaveLength(1);
  });

  it('returns the stored certificate, with no event, when already revoked', async () => {
    const { service, rows, certificate } = await issued();
    await revokeCertificate({
      coreTable: service,
      certificate,
      actor: instructor,
      reason: 'issued-in-error',
      now: T1,
    });
    const again = await revokeCertificate({
      coreTable: service,
      certificate,
      actor: admin,
      reason: 'academic-integrity',
      now: T2,
    });
    expect(again).toMatchObject({
      revokedAt: T1.toISOString(),
      revocationReason: 'issued-in-error',
      revokedByRole: 'instructor',
    });
    expect(rows.certificateEvent!.size).toBe(1);
  });

  it('leaves three events in order after revoke, restore, revoke', async () => {
    const { service, rows, certificate } = await issued();
    const revoked = await revokeCertificate({
      coreTable: service,
      certificate,
      actor: instructor,
      reason: 'issued-in-error',
      now: T1,
    });
    const restored = await restoreCertificate({
      coreTable: service,
      certificate: revoked,
      actor: instructor,
      now: T2,
    });
    expect(restored.revokedAt).toBeUndefined();
    expect(restored.revocationReason).toBeUndefined();
    expect(restored.revokedByRole).toBeUndefined();
    await revokeCertificate({
      coreTable: service,
      certificate: restored,
      actor: admin,
      reason: 'academic-integrity',
      now: T3,
    });
    expect(events(rows).map((e) => [e.type, e.occurredAt])).toEqual([
      ['revoked', T1.toISOString()],
      ['restored', T2.toISOString()],
      ['revoked', T3.toISOString()],
    ]);
    expect(stored(rows).revokedAt).toBe(T3.toISOString());
  });

  it('puts a restore after the revocation it undoes, whatever the clock says', async () => {
    const { service, rows, certificate } = await issued();
    const revoked = await revokeCertificate({
      coreTable: service,
      certificate,
      actor: admin,
      reason: 'issued-in-error',
      now: T2,
    });
    await restoreCertificate({
      coreTable: service,
      certificate: revoked,
      actor: admin,
      now: T1,
    });
    const [first, second] = events(rows);
    expect(second!.occurredAt > first!.occurredAt).toBe(true);
  });

  it('lets an administrator restore an instructor’s revocation, but not the reverse', async () => {
    const { service, rows, certificate } = await issued();
    const byInstructor = await revokeCertificate({
      coreTable: service,
      certificate,
      actor: instructor,
      reason: 'issued-in-error',
      now: T1,
    });
    await restoreCertificate({
      coreTable: service,
      certificate: byInstructor,
      actor: admin,
      note: 'Checked',
      now: T2,
    });
    expect(stored(rows).revokedAt).toBeUndefined();
    expect(events(rows)[1]).toMatchObject({
      type: 'restored',
      note: 'Checked',
      actorRole: 'admin',
    });

    const byAdmin = await revokeCertificate({
      coreTable: service,
      certificate: stored(rows),
      actor: admin,
      reason: 'refunded',
      now: T3,
    });
    await expect(
      restoreCertificate({
        coreTable: service,
        certificate: byAdmin,
        actor: instructor,
        now: new Date('2026-11-19T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(RestoreForbiddenError);
    expect(stored(rows).revokedByRole).toBe('admin');
    expect(rows.certificateEvent!.size).toBe(3);
  });

  it('writes nothing and returns the certificate when restoring a valid one', async () => {
    const { service, rows, certificate } = await issued();
    const result = await restoreCertificate({
      coreTable: service,
      certificate,
      actor: admin,
      now: T1,
    });
    expect(result).toEqual(certificate);
    expect(rows.certificateEvent!.size).toBe(0);
    expect(rows.notification!.size).toBe(1);
  });

  it('writes nothing when the restore’s read of revokedAt is stale', async () => {
    const { service, rows, certificate } = await issued();
    const revoked = await revokeCertificate({
      coreTable: service,
      certificate,
      actor: admin,
      reason: 'issued-in-error',
      now: T1,
    });
    await restoreCertificate({
      coreTable: service,
      certificate: revoked,
      actor: admin,
      now: T2,
    });
    // A second restore from the same stale read.
    const again = await restoreCertificate({
      coreTable: service,
      certificate: revoked,
      actor: admin,
      now: T3,
    });
    expect(again.revokedAt).toBeUndefined();
    expect(rows.certificateEvent!.size).toBe(2);
  });

  it('sends one notification per event, none for a no-op, and never the note', async () => {
    const { service, rows, certificate } = await issued();
    const revoked = await revokeCertificate({
      coreTable: service,
      certificate,
      actor: instructor,
      reason: 'other',
      note: 'secret detail',
      now: T1,
    });
    await revokeCertificate({
      coreTable: service,
      certificate,
      actor: instructor,
      reason: 'other',
      note: 'secret detail',
      now: T2,
    });
    await restoreCertificate({
      coreTable: service,
      certificate: revoked,
      actor: instructor,
      note: 'private',
      now: T3,
    });
    const sent = notifications(rows).filter((n) =>
      n.type.startsWith('certificate.re'),
    );
    expect(sent.map((n) => n.type).sort()).toEqual([
      'certificate.restored',
      'certificate.revoked',
    ]);
    expect(JSON.stringify(sent)).not.toContain('secret detail');
    expect(JSON.stringify(sent)).not.toContain('private');
    const revokedNote = sent.find((n) => n.type === 'certificate.revoked')!;
    expect(revokedNote.userId).toBe('u1');
    expect(revokedNote.body).toContain('Other');
  });

  it('is still returned as existing by issueCertificate, writing nothing', async () => {
    const { service, rows, log, certificate } = await issued();
    await revokeCertificate({
      coreTable: service,
      certificate,
      actor: instructor,
      reason: 'issued-in-error',
      now: T1,
    });
    const before = log.transactions;
    const again = await issue(service);
    expect(again?.revokedAt).toBe(T1.toISOString());
    expect(again?.certificateId).toBe(certificate.certificateId);
    expect(log.transactions).toBe(before);
    expect(rows.certificate!.size).toBe(1);
  });
});
