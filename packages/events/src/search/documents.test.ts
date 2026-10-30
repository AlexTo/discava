/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  type ContentItemRecord,
  type CourseRecord,
  contentItemDoc,
  courseDoc,
  type LessonRecord,
  lessonDoc,
  type ModuleRecord,
  moduleDoc,
  type UserRecord,
  userDoc,
} from './documents.js';

const course: CourseRecord = {
  courseId: 'course-1',
  title: 'Algebra 101',
  description: 'Linear equations and functions',
  status: 'published',
  publishedAt: '2024-05-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-02-01T00:00:00Z',
};

const module: ModuleRecord = {
  moduleId: 'module-1',
  courseId: 'course-1',
  title: 'Getting Started',
  visibility: 'visible',
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

const lesson: LessonRecord = {
  lessonId: 'lesson-1',
  moduleId: 'module-1',
  courseId: 'course-1',
  title: 'First Steps',
  description: 'Setting up the environment',
  visibility: 'visible',
  createdAt: '2024-01-03T00:00:00Z',
  updatedAt: '2024-01-03T00:00:00Z',
};

const item: ContentItemRecord = {
  contentItemId: 'item-1',
  lessonId: 'lesson-1',
  moduleId: 'module-1',
  courseId: 'course-1',
  title: 'Welcome video',
  type: 'video',
  visibility: 'visible',
  createdAt: '2024-01-04T00:00:00Z',
  updatedAt: '2024-01-04T00:00:00Z',
};

describe('courseDoc', () => {
  it('folds title and description into searchText', () => {
    expect(courseDoc(course)).toMatchObject({
      id: 'course-1',
      title: 'Algebra 101',
      status: 'published',
      searchText: 'Algebra 101 Linear equations and functions',
    });
  });

  it('omits optional fields the record does not have', () => {
    const draft: CourseRecord = {
      courseId: 'course-2',
      title: 'Draft Course',
      status: 'draft',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    const doc = courseDoc(draft);
    expect(doc.description).toBeUndefined();
    expect(doc.publishedAt).toBeUndefined();
    expect(doc.searchText).toBe('Draft Course');
  });
});

describe('moduleDoc', () => {
  it('carries the course status for the effectively-visible filter', () => {
    expect(moduleDoc(module, course)).toMatchObject({
      id: 'module-1',
      courseId: 'course-1',
      visibility: 'visible',
      courseStatus: 'published',
      searchText: 'Getting Started',
    });
  });

  it('records the module archived state when set', () => {
    const archivedModule: ModuleRecord = {
      ...module,
      archivedAt: '2024-03-01T00:00:00Z',
    };
    expect(moduleDoc(archivedModule, course).archivedAt).toBe(
      '2024-03-01T00:00:00Z',
    );
  });
});

describe('lessonDoc', () => {
  it('carries the module and course state for the effectively-visible filter', () => {
    expect(lessonDoc(lesson, module, course)).toMatchObject({
      id: 'lesson-1',
      courseId: 'course-1',
      moduleId: 'module-1',
      moduleTitle: 'Getting Started',
      visibility: 'visible',
      moduleVisibility: 'visible',
      courseStatus: 'published',
      searchText: 'First Steps Setting up the environment',
    });
  });

  it('records the module archived state when set', () => {
    const archivedModule: ModuleRecord = {
      ...module,
      archivedAt: '2024-03-01T00:00:00Z',
    };
    expect(lessonDoc(lesson, archivedModule, course).moduleArchivedAt).toBe(
      '2024-03-01T00:00:00Z',
    );
  });
});

describe('contentItemDoc', () => {
  it('carries the lesson and course state for the effectively-visible filter', () => {
    expect(contentItemDoc(item, lesson, course)).toMatchObject({
      id: 'item-1',
      courseId: 'course-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      lessonTitle: 'First Steps',
      type: 'video',
      visibility: 'visible',
      lessonVisibility: 'visible',
      courseStatus: 'published',
      searchText: 'Welcome video',
    });
  });

  it('records the lesson archived state when set', () => {
    const archivedLesson: LessonRecord = {
      ...lesson,
      archivedAt: '2024-03-01T00:00:00Z',
    };
    expect(contentItemDoc(item, archivedLesson, course).lessonArchivedAt).toBe(
      '2024-03-01T00:00:00Z',
    );
  });
});

describe('userDoc', () => {
  it('shows the name and matches on name and email', () => {
    const user: UserRecord = {
      userId: 'user-1',
      email: 'ada@example.com',
      givenName: 'Ada',
      familyName: 'Lovelace',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    expect(userDoc(user)).toMatchObject({
      id: 'user-1',
      displayName: 'Ada Lovelace',
      searchText: 'Ada Lovelace ada@example.com',
    });
  });

  it('falls back to the email for the display name when there is no name', () => {
    const user: UserRecord = {
      userId: 'user-2',
      email: 'grace@example.com',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    expect(userDoc(user)).toMatchObject({
      id: 'user-2',
      displayName: 'grace@example.com',
      searchText: 'grace@example.com',
    });
  });
});
