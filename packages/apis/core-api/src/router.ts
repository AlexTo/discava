/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from './init.js';
import {
  listCoursesByInstructor,
  listInstructorsForCourse,
  publicListCourses,
  publicViewCourse,
  viewCourse,
} from './procedures/course.js';
import { enrol, myEnrolment } from './procedures/enrolment.js';
import {
  myQuizAttempts,
  submitQuizAttempt,
  viewQuiz,
} from './procedures/quiz.js';

export const router = t.router;

export const appRouter = router({
  course: router({
    enrol,
    myEnrolment,
    listByInstructor: listCoursesByInstructor,
    listInstructors: listInstructorsForCourse,
    publicList: publicListCourses,
    publicView: publicViewCourse,
    view: viewCourse,
  }),
  quiz: router({
    view: viewQuiz,
    submitAttempt: submitQuizAttempt,
    myAttempts: myQuizAttempts,
  }),
});

export type AppRouter = typeof appRouter;
