/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { dayKey, SCORE_BANDS, weekKey } from './analytics-contributions.js';
import { filterEffectivelyVisible } from './curriculum.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// DynamoDB's limit on the keys of one batch get.
const BATCH_SIZE = 100;
const BATCH_ATTEMPTS = 3;

export interface CourseSummary {
  courseId: string;
  enrolments: number;
  completed: number;
  dropped: number;
  /** Learners active in the current UTC calendar week. */
  activeLearners: number;
  /** When the course's analytics last changed; null when they never have. */
  updatedAt: string | null;
}

// A late or reordered event can leave a counter below zero for a moment; it
// is never shown.
const counter = (value: number | undefined) => Math.max(0, value ?? 0);

// Batch gets `keys` in groups of BATCH_SIZE, asking again for what DynamoDB
// left unprocessed, and failing rather than showing zeros for it.
const batchGet = async <Key, Item>(
  keys: Key[],
  get: (keys: Key[]) => Promise<{ data: Item[]; unprocessed: Key[] }>,
): Promise<Item[]> => {
  const items: Item[] = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    let pending = keys.slice(i, i + BATCH_SIZE);
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt === BATCH_ATTEMPTS) {
        throw new Error('Analytics could not be read: throttled');
      }
      const { data, unprocessed } = await get(pending);
      items.push(...data);
      pending = unprocessed;
    }
  }
  return items;
};

/**
 * The figures behind the dashboard's cards, for each course, in the order
 * given: one batch get of the summaries and one of this week's items, however
 * many students the courses have. A course with no items gets zeros.
 */
export const readCourseSummaries = async (
  coreTable: CoreTable,
  courseIds: string[],
  now = new Date(),
): Promise<CourseSummary[]> => {
  if (courseIds.length === 0) {
    return [];
  }
  const { courseStats, periodStats } = coreTable.entities;
  const periodKey = weekKey(now.toISOString()) as string;

  const [summaries, weeks] = await Promise.all([
    batchGet(
      courseIds.map((courseId) => ({ courseId })),
      async (keys) => {
        const { data, unprocessed } = await courseStats.get(keys).go();
        return { data, unprocessed };
      },
    ),
    batchGet(
      courseIds.map((courseId) => ({ courseId, periodKey })),
      async (keys) => {
        const { data, unprocessed } = await periodStats.get(keys).go();
        return { data, unprocessed };
      },
    ),
  ]);

  const summaryOf = new Map(summaries.map((item) => [item.courseId, item]));
  const weekOf = new Map(weeks.map((item) => [item.courseId, item]));
  return courseIds.map((courseId) => {
    const summary = summaryOf.get(courseId);
    return {
      courseId,
      enrolments: counter(summary?.enrolments),
      completed: counter(summary?.completed),
      dropped: counter(summary?.dropped),
      activeLearners: counter(weekOf.get(courseId)?.activeLearners),
      updatedAt: summary?.updatedAt ?? null,
    };
  });
};

export interface CourseDay {
  /** The UTC day, `yyyy-mm-dd`. */
  date: string;
  enrolments: number;
  activeLearners: number;
}

export interface CourseAnalytics extends CourseSummary {
  /** Enrolled and neither completed nor dropped; never below 0. */
  active: number;
  /** Exactly the days asked for, oldest first, zero filled. */
  daily: CourseDay[];
  /** The lessons currently shown to students, in course order. */
  lessons: LessonFunnel[];
  /** The quizzes currently shown to students, in course order. */
  quizzes: QuizListing[];
}

export interface QuizListing {
  contentItemId: string;
  lessonId: string;
  title: string;
  /** Students with a best score: the sum of the score bands. */
  students: number;
}

export interface QuizQuestionFigures {
  questionId: string;
  /** The question's prompt as plain text. */
  text: string;
  attempts: number;
  misses: number;
  /** `misses / attempts` as a whole percent, rounded down; null with no attempts. */
  missRate: number | null;
  /** Whether there are enough attempts to rank the question. */
  ranked: boolean;
}

export interface ScoreBand {
  from: number;
  to: number;
  students: number;
}

export interface QuizAnalytics {
  /** Ranked questions first, by miss rate then attempts, then the unranked in quiz order. */
  questions: QuizQuestionFigures[];
  scoreBands: ScoreBand[];
  students: number;
}

/** Attempts a question needs before its miss rate is ranked. */
export const MIN_RANKED_ATTEMPTS = 5;

export interface LessonFunnel {
  lessonId: string;
  title: string;
  moduleId: string;
  moduleTitle: string;
  inProgress: number;
  completed: number;
  /** Students who have started the lesson: in progress or completed. */
  started: number;
  /** `completed / started` as a whole percent, rounded down; null when none started. */
  completionShare: number | null;
}

const DAY_MS = 86_400_000;

// A course's aggregates and curriculum, one query of each.
const loadCourse = async (coreTable: CoreTable, courseId: string) => {
  const [{ data: aggregates }, { data: curriculum }] = await Promise.all([
    coreTable.collections.analytics({ courseId }).go({ pages: 'all' }),
    coreTable.collections.curriculum({ courseId }).go({ pages: 'all' }),
  ]);
  return { aggregates, curriculum };
};

type LoadedCourse = Awaited<ReturnType<typeof loadCourse>>;

// The curriculum narrowed to what students see, modules in course order.
const shownCurriculum = ({ curriculum }: LoadedCourse) => {
  const { modules, lessons, contentItems } = filterEffectivelyVisible({
    modules: curriculum.module,
    lessons: curriculum.lesson,
    contentItems: curriculum.contentItem,
  });
  return {
    modules: [...modules].sort((a, b) => a.order - b.order),
    lessons,
    contentItems,
  };
};

const lessonFunnel = (loaded: LoadedCourse): LessonFunnel[] => {
  const { modules, lessons } = shownCurriculum(loaded);
  const statsOf = new Map(
    loaded.aggregates.lessonStats.map((item) => [item.lessonId, item]),
  );
  return modules.flatMap((module) =>
    lessons
      .filter((lesson) => lesson.moduleId === module.moduleId)
      .sort((a, b) => a.order - b.order)
      .map((lesson) => {
        const stats = statsOf.get(lesson.lessonId);
        const inProgress = counter(stats?.inProgress);
        const completed = counter(stats?.completed);
        const started = inProgress + completed;
        return {
          lessonId: lesson.lessonId,
          title: lesson.title,
          moduleId: module.moduleId,
          moduleTitle: module.title,
          inProgress,
          completed,
          started,
          completionShare:
            started > 0
              ? Math.min(100, Math.floor((completed * 100) / started))
              : null,
        };
      }),
  );
};

/**
 * The lessons shown to students (neither they nor their module hidden or
 * archived), in course order, with their funnel figures: one query of the
 * course's aggregates joined with one of its curriculum. A hidden lesson's
 * counts stay stored and come back when it is shown again; a lesson with no
 * item shows zeros.
 */
export const readLessonFunnel = async (
  coreTable: CoreTable,
  courseId: string,
): Promise<LessonFunnel[]> =>
  lessonFunnel(await loadCourse(coreTable, courseId));

// The ten bands of a quiz's score item, each clamped at zero.
const scoreBands = (item: Record<string, unknown> | undefined): ScoreBand[] =>
  Array.from({ length: SCORE_BANDS }, (_, band) => ({
    from: band * SCORE_BANDS,
    to: band === SCORE_BANDS - 1 ? 100 : band * SCORE_BANDS + SCORE_BANDS - 1,
    students: counter(item?.[`band${band}`] as number | undefined),
  }));

const sumOfBands = (bands: ScoreBand[]) =>
  bands.reduce((sum, { students }) => sum + students, 0);

// The shown quizzes in course order (module, lesson, then item order).
const shownQuizzes = (loaded: LoadedCourse) => {
  const { modules, lessons, contentItems } = shownCurriculum(loaded);
  return modules.flatMap((module) =>
    lessons
      .filter((lesson) => lesson.moduleId === module.moduleId)
      .sort((a, b) => a.order - b.order)
      .flatMap((lesson) =>
        contentItems
          .filter(
            (item) => item.type === 'quiz' && item.lessonId === lesson.lessonId,
          )
          .sort((a, b) => a.order - b.order),
      ),
  );
};

const quizListings = (loaded: LoadedCourse): QuizListing[] => {
  const scoresOf = new Map(
    loaded.aggregates.quizScoreStats.map((item) => [item.contentItemId, item]),
  );
  return shownQuizzes(loaded).map(({ contentItemId, lessonId, title }) => ({
    contentItemId,
    lessonId,
    title,
    students: sumOfBands(scoreBands(scoresOf.get(contentItemId))),
  }));
};

/**
 * The quizzes shown to students, in course order, each with how many students
 * have a best score: one query of the course's aggregates and one of its
 * curriculum.
 */
export const readCourseQuizzes = async (
  coreTable: CoreTable,
  courseId: string,
): Promise<QuizListing[]> =>
  quizListings(await loadCourse(coreTable, courseId));

// A question's prompt (a Tiptap document in a string) as plain text: its
// text nodes and the LaTeX of its maths nodes, in order, one paragraph or
// block per space.
const plainText = (prompt: unknown): string => {
  const parts: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node !== 'object' || node === null) {
      return;
    }
    const { text, attrs, content } = node as {
      text?: unknown;
      attrs?: { latex?: unknown };
      content?: unknown;
    };
    if (typeof text === 'string') {
      parts.push(text);
    } else if (typeof attrs?.latex === 'string') {
      parts.push(attrs.latex);
    }
    if (Array.isArray(content)) {
      content.forEach(visit);
      parts.push(' ');
    }
  };
  try {
    visit(typeof prompt === 'string' ? JSON.parse(prompt) : prompt);
  } catch {
    return '';
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
};

/**
 * One quiz's most-missed ranking and score distribution, for the quiz as it
 * is now: only its current questions (a deleted question's stats are
 * dropped, a new one shows zeros). Questions with at least
 * MIN_RANKED_ATTEMPTS attempts come first by miss rate, then attempts, both
 * descending; the rest follow in quiz order. Undefined when the course has no
 * such quiz shown to students.
 */
export const readQuizAnalytics = async (
  coreTable: CoreTable,
  courseId: string,
  contentItemId: string,
): Promise<QuizAnalytics | undefined> => {
  const loaded = await loadCourse(coreTable, courseId);
  const quiz = shownQuizzes(loaded).find(
    (item) => item.contentItemId === contentItemId,
  );
  if (!quiz) {
    return undefined;
  }
  const statsOf = new Map(
    loaded.aggregates.quizQuestionStats
      .filter((item) => item.contentItemId === contentItemId)
      .map((item) => [item.questionId, item]),
  );
  const current: { questionId: string; prompt?: unknown }[] = Array.isArray(
    quiz.questions,
  )
    ? quiz.questions
    : [];
  const questions = current.map(({ questionId, prompt }) => {
    const stats = statsOf.get(questionId);
    const attempts = counter(stats?.attempts);
    const misses = Math.min(attempts, counter(stats?.misses));
    return {
      questionId,
      text: plainText(prompt),
      attempts,
      misses,
      missRate: attempts > 0 ? Math.floor((misses * 100) / attempts) : null,
      ranked: attempts >= MIN_RANKED_ATTEMPTS,
    };
  });
  const bands = scoreBands(
    loaded.aggregates.quizScoreStats.find(
      (item) => item.contentItemId === contentItemId,
    ),
  );
  return {
    questions: [
      ...questions
        .filter(({ ranked }) => ranked)
        .sort(
          (a, b) =>
            (b.missRate ?? 0) - (a.missRate ?? 0) || b.attempts - a.attempts,
        ),
      ...questions.filter(({ ranked }) => !ranked),
    ],
    scoreBands: bands,
    students: sumOfBands(bands),
  };
};

/**
 * One course's totals and its last `days` UTC days (today included), from the
 * summary item, this week's item and one range query over the day items.
 */
export const readCourseAnalytics = async (
  coreTable: CoreTable,
  courseId: string,
  days: number,
  now = new Date(),
): Promise<CourseAnalytics> => {
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(now.getTime() - (days - 1 - i) * DAY_MS)
      .toISOString()
      .slice(0, 10),
  );
  const [[summary], { data: items }, loaded] = await Promise.all([
    readCourseSummaries(coreTable, [courseId], now),
    coreTable.entities.periodStats.query
      .primary({ courseId })
      .between(
        { periodKey: dayKey(dates[0]) as string },
        { periodKey: dayKey(dates[days - 1]) as string },
      )
      .go({ pages: 'all' }),
    loadCourse(coreTable, courseId),
  ]);

  const dayOf = new Map(items.map((item) => [item.periodKey, item]));
  return {
    ...summary,
    active: Math.max(
      0,
      summary.enrolments - summary.completed - summary.dropped,
    ),
    lessons: lessonFunnel(loaded),
    quizzes: quizListings(loaded),
    daily: dates.map((date) => {
      const item = dayOf.get(`DAY#${date}`);
      return {
        date,
        enrolments: counter(item?.enrolments),
        activeLearners: counter(item?.activeLearners),
      };
    }),
  };
};
