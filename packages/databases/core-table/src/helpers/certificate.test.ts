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

// An in-memory certificate entity that enforces the conditional create.
const fake = (options: { takenIds?: number; raceWinner?: boolean } = {}) => {
  const store = new Map<string, Record<string, unknown>>();
  let taken = options.takenIds ?? 0;
  const create = vi.fn((item: Record<string, unknown>) => ({
    go: async () => {
      const key = `${item.userId}/${item.courseId}`;
      if (options.raceWinner && !store.has(key)) {
        store.set(key, { ...item, certificateId: 'WINNER0000000000' });
      }
      if (store.has(key)) {
        throw new Error('conflict', {
          cause: Object.assign(new Error('x'), {
            name: 'ConditionalCheckFailedException',
          }),
        });
      }
      store.set(key, item);
      return { data: item };
    },
  }));
  const query = vi.fn(() => ({
    go: async () => ({ data: taken-- > 0 ? [{}] : [] }),
  }));
  const entity = {
    get: vi.fn(({ userId, courseId }) => ({
      go: async () => ({ data: store.get(`${userId}/${courseId}`) ?? null }),
    })),
    create,
    query: { byCertificateId: query },
  };
  return {
    coreTable: { entities: { certificate: entity } } as never,
    entity,
    store,
  };
};

const issue = (
  coreTable: never,
  overrides: Partial<Parameters<typeof issueCertificate>[0]> = {},
) =>
  issueCertificate({
    coreTable,
    enrolment,
    course,
    user,
    now: NOW,
    ...overrides,
  });

describe('issueCertificate', () => {
  it('creates a certificate from the enrolment, course and user', async () => {
    const { coreTable, entity } = fake();
    const certificate = await issue(coreTable);
    expect(entity.create).toHaveBeenCalledTimes(1);
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

  it.each([
    ['active', { status: 'active' as const }],
    ['dropped', { status: 'dropped' as const }],
    ['completed without completedAt', { completedAt: undefined }],
  ])('writes nothing for a %s enrolment', async (_, patch) => {
    const { coreTable, entity } = fake();
    expect(
      await issue(coreTable, { enrolment: { ...enrolment, ...patch } }),
    ).toBeUndefined();
    expect(entity.create).not.toHaveBeenCalled();
    expect(entity.get).not.toHaveBeenCalled();
  });

  it('writes nothing when the course has certificates off', async () => {
    const { coreTable, entity } = fake();
    expect(
      await issue(coreTable, {
        course: { ...course, certificatesEnabled: false },
      }),
    ).toBeUndefined();
    expect(entity.create).not.toHaveBeenCalled();
  });

  it('returns the first call’s certificate on a second call without a second create', async () => {
    const { coreTable, entity } = fake();
    const first = await issue(coreTable);
    const second = await issue(coreTable);
    expect(second?.certificateId).toBe(first?.certificateId);
    expect(entity.create).toHaveBeenCalledTimes(1);
  });

  it('returns the winner’s record when the create loses its condition', async () => {
    const { coreTable } = fake({ raceWinner: true });
    const certificate = await issue(coreTable);
    expect(certificate?.certificateId).toBe('WINNER0000000000');
  });

  it('rethrows other create errors', async () => {
    const { coreTable, entity } = fake();
    entity.create.mockReturnValueOnce({
      go: async () => {
        throw new Error('boom');
      },
    });
    await expect(issue(coreTable)).rejects.toThrow('boom');
  });

  it('regenerates an ID found on the index', async () => {
    const { coreTable, entity } = fake({ takenIds: 2 });
    await issue(coreTable);
    expect(entity.query.byCertificateId).toHaveBeenCalledTimes(3);
    expect(entity.create).toHaveBeenCalledTimes(1);
  });

  it('throws after five collisions', async () => {
    const { coreTable, entity } = fake({ takenIds: 5 });
    await expect(issue(coreTable)).rejects.toThrow(/5 tries/);
    expect(entity.query.byCertificateId).toHaveBeenCalledTimes(5);
    expect(entity.create).not.toHaveBeenCalled();
  });

  it('uses the fallback name for a missing user', async () => {
    const { coreTable } = fake();
    const certificate = await issue(coreTable, { user: null });
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
