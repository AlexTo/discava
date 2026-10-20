/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from './init.js';
import { completeContentItem, myCompletions } from './procedures/completion.js';
import { videoUrl } from './procedures/content-item.js';
import {
  listCoursesByInstructor,
  listInstructorsForCourse,
  publicListCourses,
  publicViewCourse,
  viewCourse,
} from './procedures/course.js';
import { enrol, myEnrolment } from './procedures/enrolment.js';
import { myProgress } from './procedures/progress.js';
import {
  myQuizAttempts,
  submitQuizAttempt,
  viewQuiz,
} from './procedures/quiz.js';

export const router = t.router;

export const appRouter = router({
  course: router({
    enrol,
    myCompletions,
    myEnrolment,
    myProgress,
    listByInstructor: listCoursesByInstructor,
    listInstructors: listInstructorsForCourse,
    publicList: publicListCourses,
    publicView: publicViewCourse,
    view: viewCourse,
  }),
  contentItem: router({
    complete: completeContentItem,
    videoUrl,
  }),
  quiz: router({
    view: viewQuiz,
    submitAttempt: submitQuizAttempt,
    myAttempts: myQuizAttempts,
  }),
});

export type AppRouter = typeof appRouter;

// The operations anonymous callers may use: those built on publicProcedure or
// publicCourseProcedure. API Gateway skips its Cognito authorizer for these
// only (see CoreApi in @discava/common-constructs), so a new public procedure
// must be added here or signed-out callers get a 401 before reaching it.
// router.test.ts checks this list against how each procedure treats an
// anonymous caller.
export const PUBLIC_OPERATIONS = [
  'course.publicList',
  'course.publicView',
] as const;
