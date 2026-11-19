/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from './init.js';
import { listAnnouncements } from './procedures/announcement.js';
import {
  mySubmission,
  submissionFileUrl,
  submit,
  uploadUrl,
} from './procedures/assignment.js';
import { categoryBySlug, listCategories } from './procedures/category.js';
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
  previewVideoUrl,
  publicListCourses,
  publicViewCourse,
  viewCourse,
} from './procedures/course.js';
import {
  accept,
  ask,
  listQuestions,
  removeOwn,
  reply,
  report,
  thread,
  vote,
} from './procedures/discussion.js';
import { enrol, myEnrolment } from './procedures/enrolment.js';
import { instructorProfilePublicView } from './procedures/instructor-profile.js';
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
import { checkout, paymentAvailable } from './procedures/payment.js';
import {
  myQuizAttempts,
  submitQuizAttempt,
  viewQuiz,
} from './procedures/quiz.js';
import {
  deleteReview,
  editReview,
  listReviews,
  myReview,
  postReview,
  reviewSummary,
} from './procedures/review.js';
import {
  publicSearchCourses,
  publicSuggestCourses,
} from './procedures/search.js';

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
    publicSuggest: publicSuggestCourses,
    publicView: publicViewCourse,
    previewVideoUrl,
    view: viewCourse,
  }),
  announcement: router({
    list: listAnnouncements,
  }),
  assignment: router({
    uploadUrl,
    submit,
    mySubmission,
    submissionFileUrl,
  }),
  instructorProfile: router({
    publicView: instructorProfilePublicView,
  }),
  category: router({
    list: listCategories,
    bySlug: categoryBySlug,
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
  discussion: router({
    listQuestions,
    thread,
    ask,
    reply,
    vote,
    accept,
    report,
    removeOwn,
  }),
  notification: router({
    list: listNotifications,
    unreadCount: notificationUnreadCount,
    markRead: markNotificationReadProcedure,
    markAllRead: markAllNotificationsRead,
    preferences: notificationPreferences,
    setPreference: setNotificationPreferenceProcedure,
  }),
  payment: router({
    checkout,
    available: paymentAvailable,
  }),
  review: router({
    mine: myReview,
    post: postReview,
    edit: editReview,
    delete: deleteReview,
    summary: reviewSummary,
    list: listReviews,
  }),
  quiz: router({
    view: viewQuiz,
    submitAttempt: submitQuizAttempt,
    myAttempts: myQuizAttempts,
  }),
});

export type AppRouter = typeof appRouter;

// The operations anonymous callers may use: those built on publicCourseProcedure
// or publicSearchProcedure. API Gateway skips its Cognito authorizer for these
// only (see CoreApi in @discava/common-constructs), so a new public procedure
// must be added here or signed-out callers get a 401 before reaching it.
// router.test.ts checks this list against how each procedure treats an
// anonymous caller.
export const PUBLIC_OPERATIONS = [
  'course.publicList',
  'course.publicView',
  'course.publicSearch',
  'course.publicSuggest',
  'course.previewVideoUrl',
  'review.summary',
  'review.list',
  'category.list',
  'category.bySlug',
  'instructorProfile.publicView',
  'certificate.verify',
] as const;
