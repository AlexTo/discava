/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// What each source record adds to a course's analytics aggregates (see
// specs/20261115-210425-instructor-dashboard/data-model.md). Everything that
// decides a figure is here, in one table of contributions, and used by three
// callers that must agree: the stream handler (a record's change), the
// rebuild (the sum over a course's records) and the
// `analytics-matches-records` invariant (the same sum, compared to what is
// stored). All pure.

/** An amount to add to one counter of one aggregate item. */
export interface Delta {
  kind: 'courseStats' | 'periodStats';
  courseId: string;
  /** The item's sort key part: `SUMMARY`, `DAY#<yyyy-mm-dd>` or `WEEK#...`. */
  sk: string;
  attribute: string;
  amount: number;
}

/**
 * A learner active in a day or week. Counted once however many records they
 * leave in it, and never taken back, so activity is historical.
 */
export interface Member {
  courseId: string;
  /** `DAY#<yyyy-mm-dd>` or `WEEK#<yyyy>-W<ww>`. */
  period: string;
  userId: string;
}

export interface Contributions {
  counts: Delta[];
  members: Member[];
}

type Image = Record<string, unknown> | undefined;

const NONE: Contributions = { counts: [], members: [] };

/** `yyyy-mm-dd` of an instant, in UTC; undefined when it isn't one. */
const utcDay = (instant: unknown): string | undefined => {
  if (typeof instant !== 'string') {
    return undefined;
  }
  const time = new Date(instant);
  return Number.isNaN(time.getTime())
    ? undefined
    : time.toISOString().slice(0, 10);
};

/** `DAY#<yyyy-mm-dd>` of an instant (UTC); undefined when it isn't one. */
export const dayKey = (instant: string): string | undefined => {
  const day = utcDay(instant);
  return day && `DAY#${day}`;
};

/**
 * `WEEK#<yyyy>-W<ww>` of an instant: its ISO 8601 week, Monday to Sunday in
 * UTC, numbered by the year that holds the week's Thursday.
 */
export const weekKey = (instant: string): string | undefined => {
  const day = utcDay(instant);
  if (!day) {
    return undefined;
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  // Move to the Thursday of this week (Monday is 1, Sunday is 7).
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `WEEK#${year}-W${String(week).padStart(2, '0')}`;
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const memberContributions = (
  courseId: unknown,
  userId: unknown,
  instant: unknown,
): Contributions => {
  const course = text(courseId);
  const user = text(userId);
  const at = text(instant);
  const periods = at && [dayKey(at), weekKey(at)];
  if (!course || !user || !periods) {
    return NONE;
  }
  return {
    counts: [],
    members: periods
      .filter((period): period is string => period !== undefined)
      .map((period) => ({ courseId: course, period, userId: user })),
  };
};

/**
 * What one record, in the state `image` shows, contributes. A record of an
 * entity with no contribution, or with no image (it didn't exist), gives
 * nothing.
 */
export const contributions = (entity: string, image: Image): Contributions => {
  if (!image) {
    return NONE;
  }
  switch (entity) {
    case 'enrolment': {
      const courseId = text(image.courseId);
      if (!courseId) {
        return NONE;
      }
      const at = text(image.createdAt);
      const day = at && dayKey(at);
      const delta = (sk: string, attribute: string): Delta => ({
        kind: sk === 'SUMMARY' ? 'courseStats' : 'periodStats',
        courseId,
        sk,
        attribute,
        amount: 1,
      });
      return {
        counts: [
          delta('SUMMARY', 'enrolments'),
          ...(image.status === 'completed'
            ? [delta('SUMMARY', 'completed')]
            : []),
          ...(image.status === 'dropped' ? [delta('SUMMARY', 'dropped')] : []),
          ...(day ? [delta(day, 'enrolments')] : []),
        ],
        members: [],
      };
    }
    case 'itemCompletion':
      return memberContributions(
        image.courseId,
        image.userId,
        image.completedAt,
      );
    case 'quizAttempt':
      return memberContributions(
        image.courseId,
        image.userId,
        image.submittedAt,
      );
    default:
      return NONE;
  }
};

const countKey = ({ kind, courseId, sk, attribute }: Delta) =>
  `${kind} ${courseId} ${sk} ${attribute}`;

/** The deltas with equal targets added together, and those that net to 0 dropped. */
export const mergeCounts = (counts: Delta[]): Delta[] => {
  const merged = new Map<string, Delta>();
  for (const delta of counts) {
    const key = countKey(delta);
    const existing = merged.get(key);
    merged.set(key, {
      ...delta,
      amount: (existing?.amount ?? 0) + delta.amount,
    });
  }
  return [...merged.values()].filter(({ amount }) => amount !== 0);
};

const memberKey = ({ courseId, period, userId }: Member) =>
  `${courseId} ${period} ${userId}`;

/** The members with duplicates dropped. */
const distinctMembers = (members: Member[]): Member[] => [
  ...new Map(members.map((member) => [memberKey(member), member])).values(),
];

/**
 * What a change of a record adds to the aggregates: the new state's
 * contributions less the old state's. A status change moves a count from one
 * attribute to another, and a removal (no new image) takes the old
 * contributions back. A member is only ever added, never taken back.
 */
export const diffContributions = (
  before: Contributions,
  after: Contributions,
): Contributions => ({
  counts: mergeCounts([
    ...after.counts,
    ...before.counts.map((delta) => ({ ...delta, amount: -delta.amount })),
  ]),
  members: distinctMembers(after.members),
});

/** The contributions of a stream record's change, from its images. */
export const contributionsOfChange = (
  entity: string,
  before: Image,
  after: Image,
): Contributions =>
  diffContributions(
    contributions(entity, before),
    contributions(entity, after),
  );

/** The contributions of several records, summed. */
export const sumContributions = (all: Contributions[]): Contributions => ({
  counts: mergeCounts(all.flatMap(({ counts }) => counts)),
  members: distinctMembers(all.flatMap(({ members }) => members)),
});

/** One aggregate item: its key and its counters. */
export interface ExpectedAggregate {
  kind: 'courseStats' | 'periodStats';
  courseId: string;
  sk: string;
  counters: Record<string, number>;
}

/**
 * The aggregate items a set of contributions amounts to: each count on its
 * item, and each distinct member as one active learner on its period's item.
 */
export const aggregatesOf = ({
  counts,
  members,
}: Contributions): ExpectedAggregate[] => {
  const items = new Map<string, ExpectedAggregate>();
  const add = (
    kind: ExpectedAggregate['kind'],
    courseId: string,
    sk: string,
    attribute: string,
    amount: number,
  ) => {
    const key = `${kind} ${courseId} ${sk}`;
    const item = items.get(key) ?? { kind, courseId, sk, counters: {} };
    item.counters[attribute] = (item.counters[attribute] ?? 0) + amount;
    items.set(key, item);
  };
  for (const { kind, courseId, sk, attribute, amount } of counts) {
    add(kind, courseId, sk, attribute, amount);
  }
  for (const { courseId, period } of distinctMembers(members)) {
    add('periodStats', courseId, period, 'activeLearners', 1);
  }
  return [...items.values()];
};
