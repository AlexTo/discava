/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from './init.js';
import {
  createContentItemQuiz,
  updateContentItemQuiz,
} from './procedures/content-item-quiz.js';
import {
  deleteContentItem,
  deleteContentItemPermanently,
  hideContentItem,
  publishContentItem,
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
  viewCourse,
} from './procedures/course.js';
import {
  createLesson,
  deleteLesson,
  deleteLessonPermanently,
  hideLesson,
  publishLesson,
  restoreLesson,
  updateLesson,
} from './procedures/lesson.js';
import {
  createModule,
  deleteModule,
  deleteModulePermanently,
  hideModule,
  publishModule,
  restoreModule,
  updateModule,
} from './procedures/module.js';

export const router = t.router;

export const appRouter = router({
  course: router({
    create: createCourse,
    archive: archiveCourse,
    view: viewCourse,
  }),
  module: router({
    create: createModule,
    update: updateModule,
    delete: deleteModule,
    publish: publishModule,
    hide: hideModule,
    restore: restoreModule,
    deletePermanently: deleteModulePermanently,
  }),
  lesson: router({
    create: createLesson,
    update: updateLesson,
    delete: deleteLesson,
    publish: publishLesson,
    hide: hideLesson,
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
    delete: deleteContentItem,
    publish: publishContentItem,
    hide: hideContentItem,
    restore: restoreContentItem,
    deletePermanently: deleteContentItemPermanently,
  }),
});

export type AppRouter = typeof appRouter;
