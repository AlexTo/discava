/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from './init.js';
import {
  course as analyticsCourse,
  quiz as analyticsQuiz,
  courseSummaries,
} from './procedures/analytics.js';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from './procedures/announcement.js';
import {
  createQuizAssignment,
  createUploadAssignment,
  updateContentItemAssignment,
} from './procedures/assignment.js';
import {
  attachContentItemCaption,
  createContentItemCaptionUploadUrl,
  removeContentItemCaption,
} from './procedures/content-item-captions.js';
import {
  createContentItemFile,
  createContentItemFileUploadUrl,
  createContentItemFileUrl,
  updateContentItemFile,
} from './procedures/content-item-file.js';
import {
  createContentItemQuiz,
  updateContentItemQuiz,
} from './procedures/content-item-quiz.js';
import {
  deleteContentItem,
  deleteContentItemPermanently,
  hideContentItem,
  publishContentItem,
  reorderContentItems,
  restoreContentItem,
} from './procedures/content-item-shared.js';
import {
  createContentItemText,
  updateContentItemText,
} from './procedures/content-item-text.js';
import {
  createContentItemVideo,
  createContentItemVideoUploadUrl,
  createContentItemVideoUrl,
  updateContentItemVideo,
} from './procedures/content-item-video.js';
import {
  archiveCourse,
  createCourse,
  publishCourse,
  restoreCourse,
  setCourseCertificates,
  viewCourse,
} from './procedures/course.js';
import {
  listActiveCategories,
  updateCourseCatalogue,
} from './procedures/course-catalogue.js';
import {
  createCourseImageUploadUrl,
  updateCourseImage,
} from './procedures/course-image.js';
import {
  dismissReports,
  hide as hideDiscussionPost,
  remove as removeDiscussionPost,
  reported,
  unanswered,
  unhide as unhideDiscussionPost,
} from './procedures/discussion.js';
import {
  createLesson,
  deleteLesson,
  deleteLessonPermanently,
  hideLesson,
  publishLesson,
  reorderLessons,
  restoreLesson,
  updateLesson,
} from './procedures/lesson.js';
import {
  createModule,
  deleteModule,
  deleteModulePermanently,
  hideModule,
  publishModule,
  reorderModules,
  restoreModule,
  updateModule,
} from './procedures/module.js';

export const router = t.router;

export const appRouter = router({
  analytics: router({
    courseSummaries,
    course: analyticsCourse,
    quiz: analyticsQuiz,
  }),
  announcement: router({
    create: createAnnouncement,
    list: listAnnouncements,
    update: updateAnnouncement,
    delete: deleteAnnouncement,
  }),
  course: router({
    create: createCourse,
    archive: archiveCourse,
    publish: publishCourse,
    restore: restoreCourse,
    setCertificates: setCourseCertificates,
    view: viewCourse,
    createImageUploadUrl: createCourseImageUploadUrl,
    updateImage: updateCourseImage,
    updateCatalogue: updateCourseCatalogue,
  }),
  discussion: router({
    unanswered,
    reported,
    hide: hideDiscussionPost,
    unhide: unhideDiscussionPost,
    remove: removeDiscussionPost,
    dismissReports,
  }),
  category: router({
    listActive: listActiveCategories,
  }),
  module: router({
    create: createModule,
    update: updateModule,
    delete: deleteModule,
    publish: publishModule,
    hide: hideModule,
    reorder: reorderModules,
    restore: restoreModule,
    deletePermanently: deleteModulePermanently,
  }),
  lesson: router({
    create: createLesson,
    update: updateLesson,
    delete: deleteLesson,
    publish: publishLesson,
    hide: hideLesson,
    reorder: reorderLessons,
    createQuizAssignment,
    createUploadAssignment,
    restore: restoreLesson,
    deletePermanently: deleteLessonPermanently,
  }),
  contentItem: router({
    createVideoUploadUrl: createContentItemVideoUploadUrl,
    createVideo: createContentItemVideo,
    createText: createContentItemText,
    createQuiz: createContentItemQuiz,
    updateVideo: updateContentItemVideo,
    updateText: updateContentItemText,
    updateQuiz: updateContentItemQuiz,
    createVideoUrl: createContentItemVideoUrl,
    captionUploadUrl: createContentItemCaptionUploadUrl,
    attachCaption: attachContentItemCaption,
    removeCaption: removeContentItemCaption,
    createFileUploadUrl: createContentItemFileUploadUrl,
    createFile: createContentItemFile,
    updateFile: updateContentItemFile,
    updateAssignment: updateContentItemAssignment,
    createFileUrl: createContentItemFileUrl,
    delete: deleteContentItem,
    publish: publishContentItem,
    hide: hideContentItem,
    reorder: reorderContentItems,
    restore: restoreContentItem,
    deletePermanently: deleteContentItemPermanently,
  }),
});

export type AppRouter = typeof appRouter;
