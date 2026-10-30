/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ContentItemDocumentSchema,
  CourseDocumentSchema,
  LessonDocumentSchema,
  ModuleDocumentSchema,
  SEARCH_TYPES,
  UserDocumentSchema,
} from '@discava/search';
import { z } from 'zod';

export const SearchInputSchema = z.object({
  // The full-text query; matched against each index's folded searchText field
  // and title (see @discava/search's searchAcross).
  query: z.string().trim().min(1).max(200),
  // Which content types to search; defaults to every type the caller may
  // search (the procedure drops the rest, so a student can't ask for users).
  types: z.array(z.enum(SEARCH_TYPES)).optional(),
  // How many results to return per type, before the cross-type merge.
  size: z.number().int().min(1).max(50).optional().default(20),
});

export type ISearchInput = z.infer<typeof SearchInputSchema>;

// One hit: which type it came from, its relevance score, and the indexed
// document (validated against that type's index schema). The discriminator is
// the type, so a client narrows by it.
export const SearchResultSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('course'),
    score: z.number(),
    document: CourseDocumentSchema,
  }),
  z.object({
    type: z.literal('module'),
    score: z.number(),
    document: ModuleDocumentSchema,
  }),
  z.object({
    type: z.literal('lesson'),
    score: z.number(),
    document: LessonDocumentSchema,
  }),
  z.object({
    type: z.literal('contentItem'),
    score: z.number(),
    document: ContentItemDocumentSchema,
  }),
  z.object({
    type: z.literal('user'),
    score: z.number(),
    document: UserDocumentSchema,
  }),
]);

export type ISearchResult = z.infer<typeof SearchResultSchema>;

export const SearchOutputSchema = z.object({
  // All the hits, merged across the searched types and ordered by score.
  results: z.array(SearchResultSchema),
});

export type ISearchOutput = z.infer<typeof SearchOutputSchema>;
