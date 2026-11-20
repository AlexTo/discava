/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { EntityItem } from 'electrodb';
import type { createCertificateEntity } from '../entities/certificate.js';
import type { createCourseEntity } from '../entities/course.js';
import type { createQuizSummaryEntity } from '../entities/quiz-summary.js';
import { filterEffectivelyVisible } from './curriculum.js';

type Item<F extends () => Promise<any>> = EntityItem<Awaited<ReturnType<F>>>;

export type CertificateCriteria = Item<
  typeof createCourseEntity
>['certificateCriteria'];

// What a new course requires: nothing beyond completing it.
export const DEFAULT_CERTIFICATE_CRITERIA = {
  version: 1,
  requireQuizPass: false,
} as const satisfies CertificateCriteria;

// The certificate's score band: the score in tens, with 90 to 100 together.
export const scoreBand = (percent: number): number =>
  Math.min(90, Math.floor(percent / 10) * 10);

export type CertificateAssessment = Omit<
  Item<typeof createCertificateEntity>['assessment'],
  'courseHours'
>;

export type QuizRequirementState =
  | 'passed'
  | 'not-attempted'
  | 'no-attempts-left'
  | 'not-passed';

export interface CertificateRequirement {
  kind: 'pass-quizzes';
  quizzes: { contentItemId: string; state: QuizRequirementState }[];
}

export interface CertificateEvaluation {
  met: boolean;
  requirements: CertificateRequirement[];
  assessment: CertificateAssessment;
}

type QuizSummary = Pick<
  Item<typeof createQuizSummaryEntity>,
  'contentItemId' | 'attemptsUsed' | 'bestScore' | 'passedAt'
>;

interface QuizSettings {
  passMarkPercent?: number;
  attemptsAllowed?: number | null;
}

interface Shown {
  visibility: 'hidden' | 'visible';
  archivedAt?: string;
}

// The curriculum records the rule reads: ordering, and what makes a quiz.
// A record without `order` sorts as 0, one without `type` is not a quiz.
export interface CriteriaCurriculum {
  modules: (Shown & { moduleId: string; order?: number })[];
  lessons: (Shown & { moduleId: string; lessonId: string; order?: number })[];
  contentItems: (Shown & {
    moduleId: string;
    lessonId: string;
    contentItemId: string;
    order?: number;
    type?: string;
    settings?: unknown;
  })[];
}

export interface EvaluateCertificateCriteriaInput {
  criteria: CertificateCriteria;
  curriculum: CriteriaCurriculum;
  quizSummaries: QuizSummary[];
}

// Whether a student's record meets a course's certificate criteria, and what
// was assessed. Pure. Only effectively visible items count, and an assessed
// quiz is one with a pass mark above 0, in a lesson of any kind.
export const evaluateCertificateCriteria = ({
  criteria,
  curriculum,
  quizSummaries,
}: EvaluateCertificateCriteriaInput): CertificateEvaluation => {
  const visible = filterEffectivelyVisible(curriculum);
  const lessonOrder = new Map(
    [...visible.modules]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .flatMap((module) =>
        visible.lessons
          .filter((lesson) => lesson.moduleId === module.moduleId)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      )
      .map((lesson, index) => [lesson.lessonId, index]),
  );
  const assessedQuizzes = visible.contentItems
    .filter(
      (item) =>
        item.type === 'quiz' &&
        ((item.settings as QuizSettings | undefined)?.passMarkPercent ?? 0) > 0,
    )
    .sort(
      (a, b) =>
        (lessonOrder.get(a.lessonId) ?? 0) -
          (lessonOrder.get(b.lessonId) ?? 0) || (a.order ?? 0) - (b.order ?? 0),
    );
  const summaries = new Map(
    quizSummaries.map((summary) => [summary.contentItemId, summary]),
  );

  const quizzes = assessedQuizzes.map((item) => {
    const settings = item.settings as QuizSettings;
    const summary = summaries.get(item.contentItemId);
    const state: QuizRequirementState = summary?.passedAt
      ? 'passed'
      : !summary
        ? 'not-attempted'
        : settings.attemptsAllowed != null &&
            summary.attemptsUsed >= settings.attemptsAllowed
          ? 'no-attempts-left'
          : 'not-passed';
    return { item, summary, state, passMark: settings.passMarkPercent ?? 0 };
  });

  const requirements: CertificateRequirement[] =
    criteria.requireQuizPass && quizzes.length > 0
      ? [
          {
            kind: 'pass-quizzes',
            quizzes: quizzes.map(({ item, state }) => ({
              contentItemId: item.contentItemId,
              state,
            })),
          },
        ]
      : [];
  // A pass-quizzes entry is listed whenever the criterion is on, even with
  // nothing to assess, so the course home can say so.
  if (criteria.requireQuizPass && requirements.length === 0) {
    requirements.push({ kind: 'pass-quizzes', quizzes: [] });
  }

  const assessedItems = criteria.requireQuizPass
    ? quizzes.map(({ item, summary, passMark }) => ({
        contentItemId: item.contentItemId,
        kind: 'quiz' as const,
        scorePercent: summary?.bestScore ?? 0,
        passMarkPercent: passMark,
      }))
    : [];
  const met =
    !criteria.requireQuizPass ||
    quizzes.every(({ state }) => state === 'passed');

  const passMarks = assessedItems.map((i) => i.passMarkPercent);
  const assessment: CertificateAssessment = {
    criteriaVersion: criteria.version,
    requireQuizPass: criteria.requireQuizPass,
    ...(criteria.minUploadScorePercent !== undefined && {
      minUploadScorePercent: criteria.minUploadScorePercent,
    }),
    itemCount: visible.contentItems.length,
    assessedItemCount: assessedItems.length,
    assessedItems,
    ...(assessedItems.length > 0 && {
      passMarkLowest: Math.min(...passMarks),
      passMarkHighest: Math.max(...passMarks),
      scoreBand: scoreBand(
        assessedItems.reduce((sum, i) => sum + i.scorePercent, 0) /
          assessedItems.length,
      ),
    }),
  };
  return { met, requirements, assessment };
};
