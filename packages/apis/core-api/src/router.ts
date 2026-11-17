/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from './init.js';
import {
  mySubmission,
  submissionFileUrl,
  submit,
  uploadUrl,
} from './procedures/assignment.js';
import {
  certificatePdf,
  myCertificates,
  verifyCertificate,
} from './procedures/certificate.js';
import {
  completeContentItem,
  myItemCompletions,
} from './procedures/completion.js';
import {
  fileUrl,
  saveVideoPosition,
  videoUrl,
} from './procedures/content-item.js';
import {
  listCoursesByInstructor,
  listInstructorsForCourse,
  publicListCourses,
  publicViewCourse,
  viewCourse,
} from './procedures/course.js';
import { enrol, myEnrolment } from './procedures/enrolment.js';
import { myLessonProgress } from './procedures/lesson-progress.js';
import { myEnrolments } from './procedures/my-enrolments.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationReadProcedure,
  notificationPreferences,
  notificationUnreadCount,
  setNotificationPreferenceProcedure,
} from './procedures/notification.js';
import {
  myQuizAttempts,
  submitQuizAttempt,
  viewQuiz,
} from './procedures/quiz.js';
import { publicSearchCourses } from './procedures/search.js';

export const router = t.router;

export const appRouter = router({
  course: router({
    enrol,
    myItemCompletions,
    myEnrolment,
    myEnrolments,
    myLessonProgress,
    listByInstructor: listCoursesByInstructor,
    listInstructors: listInstructorsForCourse,
    publicList: publicListCourses,
    publicSearch: publicSearchCourses,
    publicView: publicViewCourse,
    view: viewCourse,
  }),
  assignment: router({
    uploadUrl,
    submit,
    mySubmission,
    submissionFileUrl,
  }),
  certificate: router({
    verify: verifyCertificate,
    myCertificates,
    pdf: certificatePdf,
  }),
  contentItem: router({
    complete: completeContentItem,
    videoUrl,
    saveVideoPosition,
    fileUrl,
  }),
  notification: router({
    list: listNotifications,
    unreadCount: notificationUnreadCount,
    markRead: markNotificationReadProcedure,
    markAllRead: markAllNotificationsRead,
    preferences: notificationPreferences,
    setPreference: setNotificationPreferenceProcedure,
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
  'course.publicSearch',
  'certificate.verify',
] as const;
