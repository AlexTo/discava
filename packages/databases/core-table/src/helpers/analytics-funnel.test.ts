/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { moveLessonFunnel, moveStudentFunnels } from './analytics-writes.js';

// The lesson funnel against a small in-memory table: current `progress` and
// enrolment records, the funnel markers and the lesson counters. Transactions
// honour the marker's condition, as DynamoDB does.

interface State {
  progress: Record<string, string | undefined>; // lessonId -> status
  enrolment?: string; // status, or undefined for none
  markers: Map<string, string>; // markerId -> counted status
  counts: Map<string, { inProgress: number; completed: number }>;
}

const fakeTable = (
  state: State,
  { beforeWrite }: { beforeWrite?: () => void } = {},
) => {
  const writes: unknown[][] = [];
  const entities = {
    progress: {
      get: ({ lessonId }: { lessonId: string }) => ({
        go: async () => ({
          data: state.progress[lessonId]
            ? { lessonId, status: state.progress[lessonId] }
            : null,
        }),
      }),
      query: {
        primary: () => ({
          begins: () => ({
            go: async () => ({
              data: Object.keys(state.progress).map((lessonId) => ({
                lessonId,
              })),
            }),
          }),
        }),
      },
    },
    enrolment: {
      get: () => ({
        go: async () => ({
          data: state.enrolment ? { status: state.enrolment } : null,
        }),
      }),
    },
    analyticsMarker: {
      get: ({ markerId }: { markerId: string }) => ({
        go: async () => ({
          data: state.markers.has(markerId)
            ? { markerId, status: state.markers.get(markerId) }
            : null,
        }),
      }),
    },
  };

  // What a transaction's entities build: descriptions applied on commit.
  type Op = (state: State) => boolean;
  const builder = () => {
    const where = (
      key: { markerId: string },
      change: (state: State) => void,
    ) => {
      let condition: (status: string | undefined) => boolean = () => true;
      const op: {
        set: (v: { status: string }) => typeof op;
        where: (fn: (a: never, b: never) => boolean) => typeof op;
        commit: () => Op;
      } = {
        set: (v) => {
          change = (s) => s.markers.set(key.markerId, v.status);
          return op;
        },
        where: (fn) => {
          condition = (status) =>
            (fn as unknown as (a: unknown, b: unknown) => boolean)(
              { status },
              { eq: (a: unknown, b: unknown) => a === b },
            );
          return op;
        },
        commit: () => (s) => {
          if (!condition(s.markers.get(key.markerId))) {
            return false;
          }
          change(s);
          return true;
        },
      };
      return op;
    };
    return {
      analyticsMarker: {
        create: (v: { markerId: string; status: string }) => ({
          commit: (): Op => (s) => {
            if (s.markers.has(v.markerId)) {
              return false;
            }
            s.markers.set(v.markerId, v.status);
            return true;
          },
        }),
        patch: (key: { markerId: string }) => where(key, () => {}),
        delete: (key: { markerId: string }) =>
          where(key, (s) => s.markers.delete(key.markerId)),
      },
      lessonStats: {
        update: ({ lessonId }: { lessonId: string }) => ({
          add: (owed: Record<string, number>) => ({
            commit: (): Op => (s) => {
              const item = s.counts.get(lessonId) ?? {
                inProgress: 0,
                completed: 0,
              };
              for (const [k, v] of Object.entries(owed)) {
                item[k as 'inProgress'] += v;
              }
              s.counts.set(lessonId, item);
              return true;
            },
          }),
        }),
      },
      courseStats: {
        update: () => ({
          set: () => ({ commit: (): Op => () => true }),
        }),
      },
    };
  };

  const coreTable = {
    entities,
    transaction: {
      write: (callback: (e: ReturnType<typeof builder>) => Op[]) => ({
        go: async () => {
          beforeWrite?.();
          const ops = callback(builder());
          writes.push(ops);
          // Marker first, as in DynamoDB's reasons list; all or nothing.
          const trial: State = {
            ...state,
            markers: new Map(state.markers),
            counts: new Map([...state.counts].map(([k, v]) => [k, { ...v }])),
          };
          const reasons = ops.map((op) =>
            op(trial) ? { code: 'None' } : { code: 'ConditionalCheckFailed' },
          );
          if (reasons.some(({ code }) => code !== 'None')) {
            return { canceled: true, data: reasons };
          }
          state.markers = trial.markers;
          state.counts = trial.counts;
          return { canceled: false, data: [] };
        },
      }),
    },
  };
  return { coreTable: coreTable as never, writes };
};

const blank = (): State => ({
  progress: {},
  enrolment: 'active',
  markers: new Map(),
  counts: new Map(),
});
const move = (state: State, lessonId = 'l1') =>
  moveLessonFunnel(fakeTable(state).coreTable, {
    courseId: 'c1',
    userId: 'u1',
    lessonId,
  });
const counted = (state: State, lessonId = 'l1') =>
  state.counts.get(lessonId) ?? { inProgress: 0, completed: 0 };

describe('moveLessonFunnel', () => {
  it('counts a started lesson as in progress, and holds it in the marker', async () => {
    const state = { ...blank(), progress: { l1: 'in_progress' } };
    expect(await move(state)).toBe('moved');
    expect(counted(state)).toEqual({ inProgress: 1, completed: 0 });
    expect(state.markers.get('FUNNEL#u1#l1')).toBe('inProgress');
  });

  it('contributes nothing for not_started', async () => {
    const state = { ...blank(), progress: { l1: 'not_started' } };
    expect(await move(state)).toBe('unchanged');
    expect(counted(state)).toEqual({ inProgress: 0, completed: 0 });
    expect(state.markers.size).toBe(0);
  });

  it('moves the count when the status changes', async () => {
    const state = { ...blank(), progress: { l1: 'in_progress' } };
    await move(state);
    state.progress.l1 = 'completed';
    expect(await move(state)).toBe('moved');
    expect(counted(state)).toEqual({ inProgress: 0, completed: 1 });
    expect(state.markers.get('FUNNEL#u1#l1')).toBe('completed');
  });

  it('counts nothing more when the same change is delivered again', async () => {
    const state = { ...blank(), progress: { l1: 'completed' } };
    await move(state);
    expect(await move(state)).toBe('unchanged');
    expect(await move(state)).toBe('unchanged');
    expect(counted(state)).toEqual({ inProgress: 0, completed: 1 });
  });

  it('leaves a dropped student’s lessons uncounted', async () => {
    const state = {
      ...blank(),
      enrolment: 'dropped',
      progress: { l1: 'in_progress' },
    };
    expect(await move(state)).toBe('unchanged');
    expect(counted(state)).toEqual({ inProgress: 0, completed: 0 });
  });

  it('still counts the same record for an active enrolment', async () => {
    const state = { ...blank(), progress: { l1: 'in_progress' } };
    await move(state);
    expect(counted(state).inProgress).toBe(1);
  });

  it('moves each of a student’s lessons to none when they drop, once', async () => {
    const state = {
      ...blank(),
      progress: { l1: 'completed', l2: 'in_progress', l3: 'not_started' },
    };
    const { coreTable } = fakeTable(state);
    const task = { courseId: 'c1', userId: 'u1' };
    await moveStudentFunnels(coreTable, task);
    expect(counted(state, 'l1').completed).toBe(1);

    state.enrolment = 'dropped';
    expect(await moveStudentFunnels(coreTable, task)).toBe(2);
    expect(await moveStudentFunnels(coreTable, task)).toBe(0);
    for (const lessonId of ['l1', 'l2', 'l3']) {
      expect(counted(state, lessonId)).toEqual({ inProgress: 0, completed: 0 });
    }
    expect(state.markers.size).toBe(0);
  });

  it('retries when a concurrent move changed the marker', async () => {
    const state = { ...blank(), progress: { l1: 'in_progress' } };
    let raced = false;
    const { coreTable, writes } = fakeTable(state, {
      beforeWrite: () => {
        if (!raced) {
          raced = true;
          // Someone else counted it between our read and our write.
          state.markers.set('FUNNEL#u1#l1', 'inProgress');
          state.counts.set('l1', { inProgress: 1, completed: 0 });
        }
      },
    });
    const result = await moveLessonFunnel(coreTable, {
      courseId: 'c1',
      userId: 'u1',
      lessonId: 'l1',
    });
    expect(result).toBe('unchanged');
    expect(writes).toHaveLength(1);
    expect(counted(state)).toEqual({ inProgress: 1, completed: 0 });
  });
});

describe('reordering: progress d1, progress d2 and the drop', () => {
  // The records change in this order; each change's event is handled once, in
  // any order, but only after its own change happened (and with the records
  // as they are at that moment).
  const changes: ((state: State) => void)[] = [
    (s) => {
      s.progress.l1 = 'in_progress';
    },
    (s) => {
      s.progress.l1 = 'completed';
    },
    (s) => {
      s.enrolment = 'dropped';
    },
  ];
  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, i) =>
          permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(
            (rest) => [item, ...rest],
          ),
        );

  for (const order of permutations([0, 1, 2])) {
    for (const eager of [true, false]) {
      it(`ends at no count for ${order.join(',')} (${eager ? 'records settled first' : 'records changing as handled'})`, async () => {
        const state = blank();
        const { coreTable } = fakeTable(state);
        let applied = 0;
        const applyUpTo = (n: number) => {
          while (applied <= n) {
            changes[applied++](state);
          }
        };
        if (eager) {
          applyUpTo(2);
        }
        for (const event of order) {
          applyUpTo(event);
          await moveStudentFunnels(coreTable, { courseId: 'c1', userId: 'u1' });
        }
        expect(counted(state)).toEqual({ inProgress: 0, completed: 0 });
        expect(state.markers.size).toBe(0);
      });
    }
  }
});
