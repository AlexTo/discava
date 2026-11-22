/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { EntityItem } from 'electrodb';
import type { createAssignmentSubmissionEntity } from '../entities/assignment-submission.js';
import type { createCertificateEntity } from '../entities/certificate.js';
import type { createCourseEntity } from '../entities/course.js';
import type { createQuizSummaryEntity } from '../entities/quiz-summary.js';
import type { CoreTable } from '../service.js';
import { filterEffectivelyVisible } from './curriculum.js';
import { isConditionalCheckFailed, VersionConflictError } from './errors.js';

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

export type UploadRequirementState =
  | 'met'
  | 'not-submitted'
  | 'awaiting-grade'
  | 'below-score';

export type CertificateRequirement =
  | {
      kind: 'pass-quizzes';
      quizzes: { contentItemId: string; state: QuizRequirementState }[];
    }
  | {
      kind: 'graded-uploads';
      minScorePercent: number;
      uploads: {
        contentItemId: string;
        state: UploadRequirementState;
        scorePercent?: number;
      }[];
    };

export interface CertificateEvaluation {
  met: boolean;
  requirements: CertificateRequirement[];
  assessment: CertificateAssessment;
}

type QuizSummary = Pick<
  Item<typeof createQuizSummaryEntity>,
  'contentItemId' | 'attemptsUsed' | 'bestScore' | 'passedAt'
>;

type Submission = Pick<
  Item<typeof createAssignmentSubmissionEntity>,
  'contentItemId' | 'status' | 'points' | 'pointsOutOf'
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
    maxPoints?: number;
  })[];
}

export interface EvaluateCertificateCriteriaInput {
  criteria: CertificateCriteria;
  curriculum: CriteriaCurriculum;
  quizSummaries: QuizSummary[];
  // Only read when `criteria.minUploadScorePercent` is set.
  submissions?: Submission[];
}

// Whether a student's record meets a course's certificate criteria, and what
// was assessed. Pure. Only effectively visible items count, and an assessed
// quiz is one with a pass mark above 0, in a lesson of any kind.
export const evaluateCertificateCriteria = ({
  criteria,
  curriculum,
  quizSummaries,
  submissions = [],
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
    const passMark = settings.passMarkPercent ?? 0;
    // `passedAt` is permanent, so a quiz whose pass mark was raised past the
    // student's best score no longer counts: the certificate records both, and
    // the score must reach the mark it lists.
    const state: QuizRequirementState =
      summary?.passedAt && summary.bestScore >= passMark
        ? 'passed'
        : !summary
          ? 'not-attempted'
          : settings.attemptsAllowed != null &&
              summary.attemptsUsed >= settings.attemptsAllowed
            ? 'no-attempts-left'
            : 'not-passed';
    return { item, summary, state, passMark };
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

  // Every visible assignment is assessed when a minimum score is required:
  // met once its submission is returned with at least that share of its points.
  const minScore = criteria.minUploadScorePercent;
  const uploads =
    minScore === undefined
      ? []
      : visible.contentItems
          .filter((item) => item.type === 'assignment')
          .sort(
            (a, b) =>
              (lessonOrder.get(a.lessonId) ?? 0) -
                (lessonOrder.get(b.lessonId) ?? 0) ||
              (a.order ?? 0) - (b.order ?? 0),
          )
          .map((item) => {
            const submission = submissions.find(
              (s) => s.contentItemId === item.contentItemId,
            );
            const outOf = submission?.pointsOutOf ?? item.maxPoints ?? 0;
            const scorePercent =
              submission?.status === 'returned'
                ? outOf > 0
                  ? Math.floor(((submission.points ?? 0) / outOf) * 100)
                  : 0
                : undefined;
            const state: UploadRequirementState = !submission
              ? 'not-submitted'
              : scorePercent === undefined
                ? 'awaiting-grade'
                : scorePercent >= (minScore ?? 0)
                  ? 'met'
                  : 'below-score';
            return { item, state, scorePercent };
          });
  if (minScore !== undefined) {
    requirements.push({
      kind: 'graded-uploads',
      minScorePercent: minScore,
      uploads: uploads.map(({ item, state, scorePercent }) => ({
        contentItemId: item.contentItemId,
        state,
        ...(scorePercent !== undefined && { scorePercent }),
      })),
    });
  }

  const assessedItems = [
    ...(criteria.requireQuizPass
      ? quizzes.map(({ item, summary, passMark }) => ({
          contentItemId: item.contentItemId,
          kind: 'quiz' as const,
          scorePercent: summary?.bestScore ?? 0,
          passMarkPercent: passMark,
        }))
      : []),
    ...uploads.map(({ item, scorePercent }) => ({
      contentItemId: item.contentItemId,
      kind: 'upload' as const,
      scorePercent: scorePercent ?? 0,
    })),
  ];
  const met =
    (!criteria.requireQuizPass ||
      quizzes.every(({ state }) => state === 'passed')) &&
    uploads.every(({ state }) => state === 'met');

  const passMarks = assessedItems.flatMap((i) =>
    'passMarkPercent' in i ? [i.passMarkPercent] : [],
  );
  const assessment: CertificateAssessment = {
    criteriaVersion: criteria.version,
    requireQuizPass: criteria.requireQuizPass,
    ...(criteria.minUploadScorePercent !== undefined && {
      minUploadScorePercent: criteria.minUploadScorePercent,
    }),
    itemCount: visible.contentItems.length,
    assessedItemCount: assessedItems.length,
    ...(minScore !== undefined && { assessedUploadCount: uploads.length }),
    assessedItems,
    ...(passMarks.length > 0 && {
      passMarkLowest: Math.min(...passMarks),
      passMarkHighest: Math.max(...passMarks),
    }),
    ...(assessedItems.length > 0 && {
      scoreBand: scoreBand(
        assessedItems.reduce((sum, i) => sum + i.scorePercent, 0) /
          assessedItems.length,
      ),
    }),
  };
  return { met, requirements, assessment };
};

// Sets what a course's certificates require. Nothing is written when the
// values are the stored ones; otherwise `version` goes up by one, so a
// certificate's `assessment` says which rules it was issued under. The patch is
// conditioned on the version just read: a concurrent change makes it read
// again and retry once.
export const setCertificateCriteria = async ({
  coreTable,
  courseId,
  criteria,
}: {
  coreTable: CoreTable;
  courseId: string;
  // `minUploadScorePercent`: an integer from 1 to 100 sets it, `null`
  // removes it, left out keeps it.
  criteria: {
    requireQuizPass: boolean;
    minUploadScorePercent?: number | null;
  };
}) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: course } = await coreTable.entities.course
      .get({ courseId })
      .go();
    if (!course) {
      throw new Error(`Course ${courseId} not found`);
    }
    const stored = course.certificateCriteria;
    const { minUploadScorePercent, requireQuizPass } = criteria;
    const nextMin =
      minUploadScorePercent === undefined
        ? stored.minUploadScorePercent
        : (minUploadScorePercent ?? undefined);
    if (
      stored.requireQuizPass === requireQuizPass &&
      stored.minUploadScorePercent === nextMin
    ) {
      return course;
    }
    if (
      nextMin !== undefined &&
      !(Number.isInteger(nextMin) && nextMin >= 1 && nextMin <= 100)
    ) {
      throw new Error('minUploadScorePercent must be an integer from 1 to 100');
    }
    const { minUploadScorePercent: _removed, ...rest } = stored;
    try {
      const { data } = await coreTable.entities.course
        .patch({ courseId })
        .set({
          certificateCriteria: {
            ...rest,
            requireQuizPass,
            ...(nextMin !== undefined && { minUploadScorePercent: nextMin }),
            version: stored.version + 1,
          },
        })
        .where((attr, op) =>
          op.eq(attr.certificateCriteria.version, stored.version),
        )
        .go({ response: 'all_new' });
      return data;
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }
  }
  throw new VersionConflictError();
};
