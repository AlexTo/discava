/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Curriculum } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recalculateStudent } from './recalculate.js';

// The table, as the recalculation reads and writes it.
const db = {
  enrolment: null as Record<string, unknown> | null,
  completions: [] as { contentItemId: string }[],
  progress: [] as { lessonId: string; status: string }[],
  course: null as Record<string, unknown> | null,
  quizSummaries: [] as Record<string, unknown>[],
  user: null as Record<string, unknown> | null,
  // Certificates by `userId#courseId`.
  certificates: new Map<string, Record<string, unknown>>(),
  // Notifications by `userId#id`, and states by user.
  notifications: new Map<string, Record<string, unknown>>(),
  notificationStates: new Map<string, Record<string, any>>(),
};

// Reads other than the enrolment, completions and progress, for the tests of
// when the course and user are (not) read.
const reads = { course: vi.fn(), user: vi.fn(), quizSummaries: vi.fn() };
// What the next certificate create does, if it isn't the default: throws
// ConditionalCheckFailedException as a lost race does, or any other error.
let createCertificate: (item: Record<string, unknown>) => Promise<void> =
  async () => {};

// Every write, as entity, key or item, the attributes set, and the condition
// rendered as a string.
const writes: {
  entity: string;
  op: 'upsert' | 'patch';
  item: Record<string, unknown>;
  set?: Record<string, unknown>;
  condition?: string;
}[] = [];

// The condition each conditional write meets, or not: a failed one throws
// as ElectroDB does.
let failCondition: (condition: string) => boolean = () => false;

const attr = new Proxy({}, { get: (_, name) => name });
const ops = {
  eq: (name: string, value: unknown) => `${name} = ${value}`,
  ne: (name: string, value: unknown) => `${name} <> ${value}`,
  notExists: (name: string) => `notExists(${name})`,
};

const lostCondition = () =>
  Object.assign(new Error('conditional request failed'), {
    cause: Object.assign(new Error(), {
      name: 'ConditionalCheckFailedException',
    }),
  });

const writer = (
  entity: string,
  op: 'upsert' | 'patch',
  item: Record<string, unknown>,
) => {
  const write: (typeof writes)[number] = { entity, op, item };
  const chain = {
    set: (set: Record<string, unknown>) => {
      write.set = set;
      return chain;
    },
    where: (build: (a: unknown, o: typeof ops) => string) => {
      write.condition = build(attr, ops);
      return chain;
    },
    go: async () => {
      if (write.condition && failCondition(write.condition)) {
        throw lostCondition();
      }
      writes.push(write);
      return {};
    },
  };
  return chain;
};

const coreTable = {
  entities: {
    enrolment: {
      get: vi.fn(() => ({ go: async () => ({ data: db.enrolment }) })),
      patch: (key: Record<string, unknown>) =>
        writer('enrolment', 'patch', key),
    },
    itemCompletion: {
      query: {
        primary: vi.fn(() => ({ go: async () => ({ data: db.completions }) })),
      },
    },
    certificate: {
      get: vi.fn((key: { userId: string; courseId: string }) => ({
        go: async () => ({
          data: db.certificates.get(`${key.userId}#${key.courseId}`) ?? null,
        }),
      })),
      query: {
        byCertificateId: vi.fn(() => ({ go: async () => ({ data: [] }) })),
      },
      // Issued in a transaction with its notification (see `transaction`).
      create: vi.fn((item: Record<string, any>) => ({
        commit: () => ({ entity: 'certificate', kind: 'create', item }),
      })),
    },
    notification: {
      create: (item: Record<string, any>) => ({
        commit: () => ({ entity: 'notification', kind: 'create', item }),
      }),
    },
    notificationState: {
      get: (key: { userId: string }) => ({
        go: async () => ({ data: db.notificationStates.get(key.userId) }),
      }),
      create: (item: Record<string, any>) => ({
        commit: () => ({ entity: 'notificationState', kind: 'create', item }),
      }),
      patch: (key: { userId: string }) => {
        const chain = {
          add: () => chain,
          where: () => chain,
          commit: () => ({ entity: 'notificationState', kind: 'patch', key }),
        };
        return chain;
      },
    },
    quizSummary: {
      query: {
        primary: vi.fn(() => ({
          go: async () => {
            reads.quizSummaries();
            return { data: db.quizSummaries };
          },
        })),
      },
    },
    course: {
      get: vi.fn(() => ({
        go: async () => {
          reads.course();
          return { data: db.course };
        },
      })),
    },
    user: {
      get: vi.fn(() => ({
        go: async () => {
          reads.user();
          return { data: db.user };
        },
      })),
    },
    progress: {
      query: {
        primary: vi.fn(() => ({ go: async () => ({ data: db.progress }) })),
      },
      upsert: (item: Record<string, unknown>) =>
        writer('progress', 'upsert', item),
    },
  },
} as any;

// The certificate's transaction: all or nothing, with the certificate's
// create conditioned on the key not existing.
coreTable.transaction = {
  write: (build: () => Record<string, any>[]) => ({
    go: async () => {
      const items = build();
      const [certificate] = items;
      await createCertificate(certificate.item);
      const key = `${certificate.item.userId}#${certificate.item.courseId}`;
      if (db.certificates.has(key)) {
        return {
          canceled: true,
          data: items.map((_, i) => ({
            code: i === 0 ? 'ConditionalCheckFailed' : 'None',
          })),
        };
      }
      for (const { entity, kind, item } of items) {
        if (entity === 'certificate') {
          db.certificates.set(key, item);
        } else if (entity === 'notification') {
          db.notifications.set(`${item.userId}#${item.id}`, item);
        } else if (kind === 'create') {
          db.notificationStates.set(item.userId, { ...item });
        }
      }
      return { canceled: false, data: items.map(() => ({ code: 'None' })) };
    },
  }),
};

const visible = { visibility: 'visible' as const };
// m1: l1 (a, b), l2 (c).
const curriculum: Curriculum = {
  modules: [{ moduleId: 'm1', ...visible }],
  lessons: [
    { moduleId: 'm1', lessonId: 'l1', ...visible },
    { moduleId: 'm1', lessonId: 'l2', ...visible },
  ],
  contentItems: [
    { moduleId: 'm1', lessonId: 'l1', contentItemId: 'a', ...visible },
    { moduleId: 'm1', lessonId: 'l1', contentItemId: 'b', ...visible },
    { moduleId: 'm1', lessonId: 'l2', contentItemId: 'c', ...visible },
  ],
};

const NOW = '2024-02-01T00:00:00.000Z';
const recalculate = () =>
  recalculateStudent(coreTable, 'course-1', curriculum, 'student-1', NOW);

const completed = (...ids: string[]) => {
  db.completions = ids.map((contentItemId) => ({ contentItemId }));
};

const completedEnrolment = (completedAt = '2024-01-01T00:00:00.000Z') => {
  db.enrolment = {
    ...db.enrolment,
    status: 'completed',
    progressPercent: 100,
    completedAt,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  failCondition = () => false;
  db.enrolment = {
    courseId: 'course-1',
    userId: 'student-1',
    status: 'active',
    progressPercent: 0,
  };
  db.completions = [];
  db.progress = [];
  db.course = {
    courseId: 'course-1',
    title: 'Intro to Discava',
    certificatesEnabled: true,
    certificateCriteria: { version: 1, requireQuizPass: false },
  };
  db.quizSummaries = [];
  db.user = { userId: 'student-1', givenName: 'Ada', familyName: 'Lovelace' };
  db.certificates = new Map();
  db.notifications = new Map();
  db.notificationStates = new Map();
  createCertificate = async () => {};
});

describe('recalculateStudent', () => {
  it('reads the student’s enrolment, completions and lesson progress in the course', async () => {
    await recalculate();

    expect(coreTable.entities.enrolment.get).toHaveBeenCalledWith({
      courseId: 'course-1',
      userId: 'student-1',
    });
    for (const query of [
      coreTable.entities.itemCompletion.query.primary,
      coreTable.entities.progress.query.primary,
    ]) {
      expect(query).toHaveBeenCalledWith({
        userId: 'student-1',
        courseId: 'course-1',
      });
    }
  });

  it('writes each lesson’s progress and the course percentage', async () => {
    completed('a', 'c');

    await recalculate();

    expect(writes).toEqual([
      expect.objectContaining({
        entity: 'progress',
        item: {
          userId: 'student-1',
          courseId: 'course-1',
          lessonId: 'l1',
          status: 'in_progress',
        },
        condition: 'notExists(status) OR status <> completed',
      }),
      expect.objectContaining({
        entity: 'progress',
        item: expect.objectContaining({
          lessonId: 'l2',
          status: 'completed',
          completedAt: NOW,
        }),
      }),
      expect.objectContaining({
        entity: 'enrolment',
        item: { courseId: 'course-1', userId: 'student-1' },
        set: { progressPercent: 66 },
        condition: 'status <> dropped',
      }),
    ]);
  });

  it('completes the course at 100%, only from active', async () => {
    completed('a', 'b', 'c');

    await recalculate();

    expect(writes.at(-1)).toMatchObject({
      entity: 'enrolment',
      set: { status: 'completed', completedAt: NOW },
      condition: 'status = active',
    });
  });

  // Idempotency: a duplicate event or a no-op edit writes nothing.
  it('writes nothing when nothing changed', async () => {
    completed('a');
    db.progress = [
      { lessonId: 'l1', status: 'in_progress' },
      { lessonId: 'l2', status: 'not_started' },
    ];
    db.enrolment = { ...db.enrolment, progressPercent: 33 };

    await recalculate();

    expect(writes).toEqual([]);
  });

  // Invariant: lesson completion is never cleared.
  it('never writes a completed lesson back to anything else', async () => {
    // b was hidden, then shown again: l1 is no longer all done.
    completed('a');
    db.progress = [{ lessonId: 'l1', status: 'completed' }];

    await recalculate();

    expect(writes.some((write) => write.item.lessonId === 'l1')).toBe(false);
  });

  // Invariant: adding content never un-completes a course.
  it('doesn’t write progress for a lesson the student hasn’t started', async () => {
    completed('a');

    await recalculate();

    expect(writes.filter(({ entity }) => entity === 'progress')).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({
          lessonId: 'l1',
          status: 'in_progress',
        }),
      }),
    ]);
  });

  it('writes a lesson back to not started when its only completed item stops counting', async () => {
    db.progress = [{ lessonId: 'l2', status: 'in_progress' }];
    db.enrolment = { ...db.enrolment, progressPercent: 33 };

    await recalculate();

    expect(writes).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({
          lessonId: 'l2',
          status: 'not_started',
        }),
      }),
      expect.objectContaining({
        entity: 'enrolment',
        set: { progressPercent: 0 },
      }),
    ]);
  });

  it('lowers the percentage of a completed course but keeps it completed', async () => {
    completed('a', 'b');
    db.enrolment = {
      ...db.enrolment,
      status: 'completed',
      progressPercent: 100,
    };

    await recalculate();

    expect(writes).toEqual([
      expect.objectContaining({ entity: 'progress' }),
      expect.objectContaining({
        entity: 'enrolment',
        set: { progressPercent: 66 },
      }),
    ]);
  });

  it('leaves a student who isn’t enrolled, or has dropped out, alone', async () => {
    completed('a', 'b', 'c');
    db.enrolment = null;
    await recalculate();
    db.enrolment = {
      courseId: 'course-1',
      userId: 'student-1',
      status: 'dropped',
    };
    await recalculate();

    expect(writes).toEqual([]);
  });

  it('lets a completion recorded by a racing run stand', async () => {
    completed('a', 'b', 'c');
    failCondition = (condition) =>
      condition.includes('status <> completed') ||
      condition === 'status = active';

    await expect(recalculate()).resolves.toBeUndefined();
  });

  it('fails on anything other than a lost condition, so the batch is retried', async () => {
    completed('a');
    coreTable.entities.progress.upsert = () => ({
      where: () => ({
        go: async () => {
          throw new Error('throttled');
        },
      }),
    });

    await expect(recalculate()).rejects.toThrow('throttled');
    coreTable.entities.progress.upsert = (item: Record<string, unknown>) =>
      writer('progress', 'upsert', item);
  });

  describe('certificates', () => {
    it('issues one certificate dated with the completion when the course is completed', async () => {
      completed('a', 'b', 'c');

      await recalculate();

      expect([...db.certificates.values()]).toEqual([
        expect.objectContaining({
          userId: 'student-1',
          courseId: 'course-1',
          learnerName: 'Ada Lovelace',
          courseTitle: 'Intro to Discava',
          completedAt: NOW,
          issuedAt: NOW,
        }),
      ]);
    });

    it('stores what was assessed: the item count and no assessed items under the default criteria, with no quiz summary read', async () => {
      completed('a', 'b', 'c');

      await recalculate();

      expect([...db.certificates.values()][0]).toMatchObject({
        assessment: {
          criteriaVersion: 1,
          requireQuizPass: false,
          itemCount: 3,
          assessedItemCount: 0,
          assessedItems: [],
        },
      });
      expect(reads.quizSummaries).not.toHaveBeenCalled();
    });

    describe('when quiz pass is required', () => {
      beforeEach(() => {
        db.course = {
          ...db.course,
          certificateCriteria: { version: 2, requireQuizPass: true },
        };
      });
      const withQuiz = {
        ...curriculum,
        contentItems: [
          ...curriculum.contentItems,
          {
            moduleId: 'm1',
            lessonId: 'l2',
            contentItemId: 'q',
            type: 'quiz',
            settings: { passMarkPercent: 70, attemptsAllowed: null },
            ...visible,
          },
        ],
      } as Curriculum;
      const run = () =>
        recalculateStudent(coreTable, 'course-1', withQuiz, 'student-1', NOW);

      it('completes the student but issues nothing while an assessed quiz is failed', async () => {
        completed('a', 'b', 'c', 'q');
        db.quizSummaries = [
          { contentItemId: 'q', attemptsUsed: 1, bestScore: 40 },
        ];

        await run();

        expect(writes).toContainEqual(
          expect.objectContaining({
            entity: 'enrolment',
            set: expect.objectContaining({
              status: 'completed',
              completedAt: NOW,
            }),
          }),
        );
        expect(db.certificates.size).toBe(0);
        expect(db.notifications.size).toBe(0);
      });

      it('issues one listing the quiz once it is passed', async () => {
        completed('a', 'b', 'c', 'q');
        db.quizSummaries = [
          {
            contentItemId: 'q',
            attemptsUsed: 2,
            bestScore: 85,
            passedAt: '2024-01-31T00:00:00.000Z',
          },
        ];

        await run();

        expect([...db.certificates.values()][0]).toMatchObject({
          assessment: {
            criteriaVersion: 2,
            requireQuizPass: true,
            itemCount: 4,
            assessedItemCount: 1,
            assessedItems: [
              {
                contentItemId: 'q',
                kind: 'quiz',
                scorePercent: 85,
                passMarkPercent: 70,
              },
            ],
            scoreBand: 80,
          },
        });
        expect(
          coreTable.entities.quizSummary.query.primary,
        ).toHaveBeenCalledWith({ userId: 'student-1', courseId: 'course-1' });
      });

      it('reads no quiz summary for a student who already has a certificate', async () => {
        completed('a', 'b', 'c', 'q');
        completedEnrolment();
        db.certificates.set('student-1#course-1', { certificateId: 'X' });

        await run();

        expect(reads.course).not.toHaveBeenCalled();
        expect(reads.user).not.toHaveBeenCalled();
        expect(reads.quizSummaries).not.toHaveBeenCalled();
      });

      it('reads no quiz summary when certificates are off', async () => {
        completed('a', 'b', 'c', 'q');
        db.course = { ...db.course, certificatesEnabled: false };

        await run();

        expect(reads.quizSummaries).not.toHaveBeenCalled();
        expect(db.certificates.size).toBe(0);
      });
    });

    it('issues one certificate.issued notification with the certificate', async () => {
      completed('a', 'b', 'c');

      await recalculate();

      const [certificate] = [...db.certificates.values()];
      expect([...db.notifications.values()]).toEqual([
        expect.objectContaining({
          userId: 'student-1',
          type: 'certificate.issued',
          occurredAt: NOW,
          title: 'Your certificate for Intro to Discava is ready',
        }),
      ]);
      expect(certificate).toBeDefined();
    });

    it('issues none, and reads neither the course nor the user, for a student who isn’t complete', async () => {
      completed('a');

      await recalculate();

      expect(db.certificates.size).toBe(0);
      expect(db.notifications.size).toBe(0);
      expect(coreTable.entities.certificate.get).not.toHaveBeenCalled();
      expect(reads.course).not.toHaveBeenCalled();
      expect(reads.user).not.toHaveBeenCalled();
    });

    it('issues none when the course has certificates off', async () => {
      completed('a', 'b', 'c');
      db.course = { ...db.course, certificatesEnabled: false };

      await recalculate();

      expect(db.certificates.size).toBe(0);
    });

    it('issues none to a student who has dropped out', async () => {
      completed('a', 'b', 'c');
      db.enrolment = { ...db.enrolment, status: 'dropped' };

      await recalculate();

      expect(db.certificates.size).toBe(0);
      expect(reads.course).not.toHaveBeenCalled();
    });

    it('issues one to a student already completed without a certificate, with the stored completion date', async () => {
      completed('a', 'b', 'c');
      completedEnrolment('2024-01-01T00:00:00.000Z');

      await recalculate();

      expect([...db.certificates.values()]).toEqual([
        expect.objectContaining({ completedAt: '2024-01-01T00:00:00.000Z' }),
      ]);
    });

    it('reads neither the course nor the user, and writes nothing, for a student who already has one', async () => {
      completed('a', 'b', 'c');
      completedEnrolment();
      db.progress = [
        { lessonId: 'l1', status: 'completed' },
        { lessonId: 'l2', status: 'completed' },
      ];
      db.certificates.set('student-1#course-1', { certificateId: 'EXISTING' });

      await recalculate();

      expect(reads.course).not.toHaveBeenCalled();
      expect(reads.user).not.toHaveBeenCalled();
      expect(coreTable.entities.certificate.create).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    });

    it('fails the recalculation when issuing fails, so the batch is retried', async () => {
      completed('a', 'b', 'c');
      createCertificate = async () => {
        throw new Error('throttled');
      };

      await expect(recalculate()).rejects.toThrow('throttled');
    });

    it('issues the certificate on a retry after the issue step failed once', async () => {
      completed('a', 'b', 'c');
      createCertificate = async () => {
        throw new Error('throttled');
      };
      await expect(recalculate()).rejects.toThrow('throttled');

      // The enrolment was completed by the first pass.
      completedEnrolment(NOW);
      createCertificate = async () => {};
      await recalculate();

      expect(db.certificates.size).toBe(1);
    });
  });

  // Two runs for the same completing student at the same moment.
  describe('concurrent runs for the same completing student', () => {
    const both = () => Promise.all([recalculate(), recalculate()]);

    // Both runs read the enrolment as active before either writes.
    it('leave exactly one certificate', async () => {
      completed('a', 'b', 'c');

      await both();

      expect(db.certificates.size).toBe(1);
      expect(db.notifications.size).toBe(1);
      expect(coreTable.entities.certificate.create).toHaveBeenCalled();
    });

    it('leave one certificate when the loser lost the enrolment patch’s active condition', async () => {
      completed('a', 'b', 'c');
      let patches = 0;
      failCondition = (condition) =>
        condition === 'status = active' && ++patches === 2;
      // The winner's patch lands in the table the loser re-reads.
      const get = coreTable.entities.enrolment.get;
      coreTable.entities.enrolment.get = vi.fn(() => ({
        go: async () => ({
          data:
            patches > 0
              ? { ...db.enrolment, status: 'completed', completedAt: NOW }
              : db.enrolment,
        }),
      }));

      await both();
      coreTable.entities.enrolment.get = get;

      expect(db.certificates.size).toBe(1);
      expect([...db.certificates.values()][0]).toMatchObject({
        completedAt: NOW,
      });
    });

    it('leave one certificate with one ID when the loser’s create loses its condition', async () => {
      completed('a', 'b', 'c');
      const created: string[] = [];
      createCertificate = async (item) => {
        created.push(item.certificateId as string);
        // Let the other run's create land first.
        await Promise.resolve();
      };

      await both();

      expect(db.certificates.size).toBe(1);
      expect(created).toHaveLength(2);
      expect(
        [...db.certificates.values()].map(({ certificateId }) => certificateId),
      ).toEqual([created[0]]);
    });

    it('issue it on the retry when the winner’s issue step failed once', async () => {
      completed('a', 'b', 'c');
      let attempts = 0;
      createCertificate = async () => {
        if (++attempts === 1) {
          throw new Error('throttled');
        }
      };

      const results = await Promise.allSettled([recalculate(), recalculate()]);
      expect(
        results.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);

      // The batch is retried against the completed enrolment.
      completedEnrolment(NOW);
      await recalculate();

      expect(db.certificates.size).toBe(1);
    });
  });
});
