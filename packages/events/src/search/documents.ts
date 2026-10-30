/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ContentItemDocument,
  CourseDocument,
  LessonDocument,
  ModuleDocument,
  UserDocument,
} from '@discava/search';

// The core-table records the builders take, as the entity getters return them
// (only the fields the documents use are named, so a test can pass a plain
// object). These mirror @discava/core-table's entity attributes.
export interface CourseRecord {
  courseId: string;
  title: string;
  description?: string;
  status: 'draft' | 'published' | 'archived';
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleRecord {
  moduleId: string;
  courseId: string;
  title: string;
  description?: string;
  visibility: 'hidden' | 'visible';
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonRecord {
  lessonId: string;
  moduleId: string;
  courseId: string;
  title: string;
  description?: string;
  visibility: 'hidden' | 'visible';
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentItemRecord {
  contentItemId: string;
  lessonId: string;
  moduleId: string;
  courseId: string;
  title: string;
  description?: string;
  type: 'video' | 'text' | 'quiz' | 'file';
  visibility: 'hidden' | 'visible';
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  userId: string;
  email?: string;
  givenName?: string;
  familyName?: string;
  createdAt: string;
  updatedAt: string;
}

// The one place the searchable text is folded: title (and description, when
// there is one) into the `searchText` field a multi-match query runs against.
// Kept here rather than in the query, so every index folds it the same way.
const searchText = (...parts: (string | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

export const courseDoc = (course: CourseRecord): CourseDocument => ({
  id: course.courseId,
  title: course.title,
  ...(course.description !== undefined && { description: course.description }),
  status: course.status,
  ...(course.publishedAt !== undefined && {
    publishedAt: course.publishedAt,
  }),
  searchText: searchText(course.title, course.description),
  createdAt: course.createdAt,
  updatedAt: course.updatedAt,
});

// A module's document carries its own visibility and the course's status,
// because the search shows a module only when it's visible, not archived, and
// the course is published. The indexer passes the course here.
export const moduleDoc = (
  module: ModuleRecord,
  course: CourseRecord,
): ModuleDocument => ({
  id: module.moduleId,
  courseId: module.courseId,
  title: module.title,
  ...(module.description !== undefined && {
    description: module.description,
  }),
  searchText: searchText(module.title, module.description),
  visibility: module.visibility,
  ...(module.archivedAt !== undefined && {
    archivedAt: module.archivedAt,
  }),
  courseStatus: course.status,
  createdAt: module.createdAt,
  updatedAt: module.updatedAt,
});

// A lesson's document carries its module's and course's state, because the
// search shows a lesson only when it, its module and the course are all
// effectively visible/published. The indexer loads the course's curriculum and
// passes the module and course here.
export const lessonDoc = (
  lesson: LessonRecord,
  module: ModuleRecord,
  course: CourseRecord,
): LessonDocument => ({
  id: lesson.lessonId,
  courseId: lesson.courseId,
  moduleId: lesson.moduleId,
  moduleTitle: module.title,
  title: lesson.title,
  ...(lesson.description !== undefined && {
    description: lesson.description,
  }),
  searchText: searchText(lesson.title, lesson.description),
  visibility: lesson.visibility,
  ...(lesson.archivedAt !== undefined && {
    archivedAt: lesson.archivedAt,
  }),
  moduleVisibility: module.visibility,
  ...(module.archivedAt !== undefined && {
    moduleArchivedAt: module.archivedAt,
  }),
  courseStatus: course.status,
  createdAt: lesson.createdAt,
  updatedAt: lesson.updatedAt,
});

// A content item's document carries its lesson's and course's state, for the
// same effectively-visible reason; the item's own visibility is recorded too,
// as the other document types keep their own.
export const contentItemDoc = (
  item: ContentItemRecord,
  lesson: LessonRecord,
  course: CourseRecord,
): ContentItemDocument => ({
  id: item.contentItemId,
  courseId: item.courseId,
  moduleId: item.moduleId,
  lessonId: item.lessonId,
  lessonTitle: lesson.title,
  title: item.title,
  ...(item.description !== undefined && { description: item.description }),
  type: item.type,
  searchText: searchText(item.title, item.description),
  visibility: item.visibility,
  ...(item.archivedAt !== undefined && {
    archivedAt: item.archivedAt,
  }),
  lessonVisibility: lesson.visibility,
  ...(lesson.archivedAt !== undefined && {
    lessonArchivedAt: lesson.archivedAt,
  }),
  courseStatus: course.status,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

// A user's document: the name (or email, when there is no name) is what a
// result shows, and name plus email are what the search matches on.
export const userDoc = (user: UserRecord): UserDocument => {
  const displayName =
    [user.givenName, user.familyName].filter(Boolean).join(' ') || user.email;
  return {
    id: user.userId,
    ...(user.email !== undefined && { email: user.email }),
    ...(user.givenName !== undefined && {
      givenName: user.givenName,
    }),
    ...(user.familyName !== undefined && {
      familyName: user.familyName,
    }),
    ...(displayName !== undefined && { displayName }),
    searchText: searchText(user.givenName, user.familyName, user.email),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};
