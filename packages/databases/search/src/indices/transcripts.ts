/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { createIndex } from './create-index.js';

const nonEmpty = z.string().min(1);

// One document is one passage of one caption track (research R-2).
export const TranscriptDocumentSchema = z
  .object({
    courseId: nonEmpty,
    moduleId: nonEmpty,
    lessonId: nonEmpty,
    contentItemId: nonEmpty,
    // The video version (manifest nonce) the track belongs to.
    versionId: nonEmpty,
    trackId: nonEmpty,
    language: nonEmpty,
    source: z.enum(['auto', 'uploaded']),
    isDefault: z.boolean(),
    // Every language that version has a track in (R-5).
    trackLanguages: z.array(nonEmpty),
    seq: z.number().int().min(0),
    startSeconds: z.number(),
    endSeconds: z.number(),
    text: z.string().min(1).max(2000),
    // Each cue's start in seconds and its character offset in `text`.
    cues: z
      .array(z.object({ s: z.number(), o: z.number().int().min(0) }))
      .min(1),
    indexedAt: z.string(),
  })
  .superRefine((doc, ctx) => {
    if (doc.endSeconds < doc.startSeconds) {
      ctx.addIssue({
        code: 'custom',
        path: ['endSeconds'],
        message: 'endSeconds is before startSeconds',
      });
    }
    if (!doc.trackLanguages.includes(doc.language)) {
      ctx.addIssue({
        code: 'custom',
        path: ['trackLanguages'],
        message: 'trackLanguages does not contain the language',
      });
    }
    doc.cues.forEach((cue, index) => {
      const previous = doc.cues[index - 1];
      if (index === 0 ? cue.o !== 0 : cue.o <= (previous?.o ?? 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cues', index, 'o'],
          message: 'offsets must ascend from 0',
        });
      }
      if (previous && cue.s < previous.s) {
        ctx.addIssue({
          code: 'custom',
          path: ['cues', index, 's'],
          message: 'cue starts must ascend',
        });
      }
    });
  });

export type ITranscriptDocument = z.output<typeof TranscriptDocumentSchema>;

/** `<contentItemId>.<trackId>.<seq padded to 5 digits>` */
export const transcriptDocumentId = (
  contentItemId: string,
  trackId: string,
  seq: number,
): string => `${contentItemId}.${trackId}.${String(seq).padStart(5, '0')}`;

export default createIndex({
  name: 'transcripts',
  schema: TranscriptDocumentSchema,
  settings: {
    index: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
  },
  mappings: {
    properties: {
      courseId: { type: 'keyword' },
      moduleId: { type: 'keyword' },
      lessonId: { type: 'keyword' },
      contentItemId: { type: 'keyword' },
      versionId: { type: 'keyword' },
      trackId: { type: 'keyword' },
      language: { type: 'keyword' },
      source: { type: 'keyword' },
      isDefault: { type: 'boolean' },
      trackLanguages: { type: 'keyword' },
      seq: { type: 'integer' },
      startSeconds: { type: 'float' },
      endSeconds: { type: 'float' },
      // `standard` matches the words as spoken; the `english` sub-field stems
      // them, so a search for "design" also finds "designing".
      text: {
        type: 'text',
        analyzer: 'standard',
        fields: { english: { type: 'text', analyzer: 'english' } },
      },
      // Stored, not indexed: the search response reads it to place a match.
      cues: { type: 'object', enabled: false },
      indexedAt: { type: 'date' },
    },
  },
});
