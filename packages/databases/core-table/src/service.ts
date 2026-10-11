/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Service } from 'electrodb';
import {
  createAssignmentEntity,
  createContentItemEntity,
  createCourseEntity,
  createCourseInstructorEntity,
  createEnrolmentEntity,
  createLessonEntity,
  createModuleEntity,
  createProgressEntity,
  createQuizAttemptEntity,
  createQuizSummaryEntity,
  createSubmissionEntity,
  createUserEntity,
} from './entities/index.js';

// Course, Module, Lesson, and ContentItem join the `curriculum` collection
// (declared on each entity's primary index), so a course's full curriculum
// can be read with a single query: coreTableService.collections.curriculum({
// courseId }).go(). Other entities are included for a single access point
// but don't need to be queried alongside the curriculum.
export const createCoreTableService = async () => {
  const [
    user,
    course,
    lesson,
    module,
    contentItem,
    enrolment,
    courseInstructor,
    assignment,
    submission,
    progress,
    quizAttempt,
    quizSummary,
  ] = await Promise.all([
    createUserEntity(),
    createCourseEntity(),
    createLessonEntity(),
    createModuleEntity(),
    createContentItemEntity(),
    createEnrolmentEntity(),
    createCourseInstructorEntity(),
    createAssignmentEntity(),
    createSubmissionEntity(),
    createProgressEntity(),
    createQuizAttemptEntity(),
    createQuizSummaryEntity(),
  ]);

  return new Service({
    user,
    course,
    module,
    lesson,
    contentItem,
    enrolment,
    courseInstructor,
    assignment,
    submission,
    progress,
    quizAttempt,
    quizSummary,
  });
};
