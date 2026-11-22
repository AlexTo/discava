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
  certificateRequirements,
  myCertificates,
  recordLinkedInClick,
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
  answerPrompt,
  ask,
  listQuestions,
  removeOwn,
  reply,
  report,
  thread,
  vote,
} from './procedures/discussion.js';
import {
  dismissFirstLessonPrompt,
  enrol,
  myEnrolment,
} from './procedures/enrolment.js';
import {
  freePreviewFileUrl,
  freePreviewLesson,
  freePreviewVideoUrl,
} from './procedures/free-preview.js';
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
import {
  checkout,
  myOrder,
  paymentAvailable,
  requestRefund,
} from './procedures/payment.js';
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
import {
  answerVideoQuestion,
  viewVideoQuestions,
} from './procedures/video-question.js';

export const router = t.router;

export const appRouter = router({
  course: router({
    enrol,
    dismissFirstLessonPrompt,
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
  freePreview: router({
    lesson: freePreviewLesson,
    videoUrl: freePreviewVideoUrl,
    fileUrl: freePreviewFileUrl,
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
    requirements: certificateRequirements,
    recordLinkedInClick,
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
    answerPrompt,
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
    requestRefund,
    myOrder,
  }),
  review: router({
    mine: myReview,
    post: postReview,
    edit: editReview,
    delete: deleteReview,
    summary: reviewSummary,
    list: listReviews,
  }),
  videoQuestion: router({
    view: viewVideoQuestions,
    answer: answerVideoQuestion,
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
// anonymous caller. The three freePreview operations are the only public ones
// that return course content, each gated by loadOpenFreePreview.
export const PUBLIC_OPERATIONS = [
  'course.publicList',
  'course.publicView',
  'course.publicSearch',
  'course.publicSuggest',
  'course.previewVideoUrl',
  'freePreview.lesson',
  'freePreview.videoUrl',
  'freePreview.fileUrl',
  'review.summary',
  'review.list',
  'category.list',
  'category.bySlug',
  'instructorProfile.publicView',
  'certificate.verify',
  'certificate.recordLinkedInClick',
] as const;
