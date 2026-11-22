/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { CourseStatusSchema } from './course.js';

// What the instructor dashboard shows (specs/20261115-210425-instructor-
// dashboard/contracts/instructor-api-analytics.md). Aggregates only: no
// student identifier appears in any of it.

/** Input of every procedure scoped to one course. */
export const AnalyticsCourseInputSchema = z.object({
  courseId: z.string().min(1),
});

export const CourseSummarySchema = z.object({
  courseId: z.string(),
  title: z.string(),
  status: CourseStatusSchema,
  /** All-time enrolments. */
  enrolments: z.number().int().nonnegative(),
  /** Learners active in the current UTC calendar week. */
  activeThisWeek: z.number().int().nonnegative(),
  /**
   * `completed / (enrolments - dropped)` as a whole percent, rounded down;
   * null when nobody is enrolled and active.
   */
  completionRate: z.number().int().min(0).max(100).nullable(),
  /** When anything about the course's analytics last changed. */
  updatedAt: z.string().nullable(),
});

export type ICourseSummary = z.output<typeof CourseSummarySchema>;

export const CourseSummariesOutputSchema = z.array(CourseSummarySchema);

export type ICourseSummariesOutput = z.output<
  typeof CourseSummariesOutputSchema
>;

const CountSchema = z.number().int().nonnegative();

/** The ranges of the daily series the dashboard offers. */
export const AnalyticsDaysSchema = z.union([z.literal(30), z.literal(90)]);

export const CourseAnalyticsInputSchema = z.object({
  days: AnalyticsDaysSchema.default(90),
});

export const CourseTotalsSchema = z.object({
  enrolments: CountSchema,
  /** Enrolled, and neither completed nor dropped. */
  active: CountSchema,
  completed: CountSchema,
  dropped: CountSchema,
  completionRate: z.number().int().min(0).max(100).nullable(),
  activeThisWeek: CountSchema,
  /** Enrolments that have done a first thing. */
  activated: CountSchema,
  /** `activated / enrolments` as a whole percent, rounded down; null with no enrolments. */
  activationRate: z.number().int().min(0).max(100).nullable(),
  promptAnswered: CountSchema,
  promptDismissed: CountSchema,
  updatedAt: z.string().nullable(),
});

export const CourseDaySchema = z.object({
  /** The UTC day, `yyyy-mm-dd`. */
  date: z.string(),
  enrolments: CountSchema,
  activeLearners: CountSchema,
  /** Of the enrolments made that day, how many are activated so far. */
  activated: CountSchema,
});

export const LessonDropOffSchema = z.object({
  lessonId: z.string(),
  moduleId: z.string(),
  title: z.string(),
  /** Students in progress or completed. */
  started: CountSchema,
  completed: CountSchema,
  /** `completed / started` as a whole percent, rounded down; null when `started` is 0. */
  completionShare: z.number().int().min(0).max(100).nullable(),
});

export type ILessonDropOff = z.output<typeof LessonDropOffSchema>;

export const QuizListingSchema = z.object({
  contentItemId: z.string(),
  lessonId: z.string(),
  title: z.string(),
  /** Students with a best score. */
  students: CountSchema,
});

export type IQuizListing = z.output<typeof QuizListingSchema>;

export const VideoQuestionListingSchema = z.object({
  contentItemId: z.string(),
  lessonId: z.string(),
  title: z.string(),
  /** How many questions the video has now. */
  questions: z.number().int().positive(),
});

export type IVideoQuestionListing = z.output<typeof VideoQuestionListingSchema>;

export const CourseAnalyticsOutputSchema = z.object({
  totals: CourseTotalsSchema,
  /** Exactly `days` entries, oldest first, zero filled. */
  daily: z.array(CourseDaySchema),
  /** Lessons currently shown to students, in course order. */
  lessons: z.array(LessonDropOffSchema),
  /** Quizzes currently shown to students, in course order. */
  quizzes: z.array(QuizListingSchema),
  /** Videos currently shown to students that have questions, in course order. */
  videoQuestions: z.array(VideoQuestionListingSchema),
  /** Modules shown to students with video and no questions, in course order. */
  modulesWithoutQuestions: z.array(
    z.object({ moduleId: z.string(), title: z.string() }),
  ),
});

export type ICourseAnalyticsOutput = z.output<
  typeof CourseAnalyticsOutputSchema
>;

export const QuizAnalyticsInputSchema = z.object({
  contentItemId: z.string().min(1),
});

export const QuizQuestionFiguresSchema = z.object({
  questionId: z.string(),
  /** The question's prompt as plain text. */
  text: z.string(),
  attempts: CountSchema,
  misses: CountSchema,
  /** `misses / attempts` as a whole percent, rounded down; null with no attempts. */
  missRate: z.number().int().min(0).max(100).nullable(),
  /** True with 5 or more attempts. */
  ranked: z.boolean(),
});

export const ScoreBandSchema = z.object({
  from: z.number().int().min(0).max(90),
  to: z.number().int().min(9).max(100),
  students: CountSchema,
});

export const QuizAnalyticsOutputSchema = z.object({
  /** Ranked questions first (miss rate, then attempts), then the rest in quiz order. */
  questions: z.array(QuizQuestionFiguresSchema),
  /** Ten bands, 0-9 through 90-100. */
  scoreBands: z.array(ScoreBandSchema),
  /** Students with a best score: the sum of the bands. */
  students: CountSchema,
});

export type IQuizAnalyticsOutput = z.output<typeof QuizAnalyticsOutputSchema>;

export const VideoQuestionsAnalyticsInputSchema = z.object({
  contentItemId: z.string().min(1),
});

export const VideoQuestionsAnalyticsOutputSchema = z.object({
  /** Ranked questions first (miss rate, then answers), then the rest in asking order. */
  questions: z.array(
    QuizQuestionFiguresSchema.extend({
      /** Whole seconds into the video, or null for an end question. */
      atSeconds: z.number().int().min(0).nullable(),
    }),
  ),
});

export type IVideoQuestionsAnalyticsOutput = z.output<
  typeof VideoQuestionsAnalyticsOutputSchema
>;
