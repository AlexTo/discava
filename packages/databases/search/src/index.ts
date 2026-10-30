/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export {
  getOpenSearchClient,
  resolveCollectionEndpoint,
  resolveIndexName,
} from './client.js';
export {
  type IndexManifestEntry,
  syncIndices,
} from './index-sync/sync-indices.js';
export {
  type ContentItemDocument,
  ContentItemDocument as ContentItemDocumentSchema,
  getContentItemsIndex,
} from './indices/content-item.js';
export {
  type CourseDocument,
  CourseDocument as CourseDocumentSchema,
  getCoursesIndex,
} from './indices/course.js';
export {
  getLessonsIndex,
  type LessonDocument,
  LessonDocument as LessonDocumentSchema,
} from './indices/lesson.js';
export {
  getModulesIndex,
  type ModuleDocument,
  ModuleDocument as ModuleDocumentSchema,
} from './indices/module.js';
export {
  getUsersIndex,
  type UserDocument,
  UserDocument as UserDocumentSchema,
} from './indices/user.js';
export {
  type BoundIndex,
  createIndex,
  type IndexDefinition,
} from './indices.js';
export {
  SEARCH_TYPES,
  type SearchResult,
  type SearchScope,
  type SearchType,
  searchAcross,
} from './search.js';
