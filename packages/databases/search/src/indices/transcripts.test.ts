/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { resolveIndexName } from '../client.js';
import { INDICES } from './index.js';
import transcripts, {
  TranscriptDocumentSchema,
  transcriptDocumentId,
} from './transcripts.js';

const valid = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 'i1',
  versionId: 'v1',
  trackId: 't1',
  language: 'en',
  source: 'auto',
  isDefault: true,
  trackLanguages: ['en', 'es'],
  seq: 0,
  startSeconds: 0,
  endSeconds: 12.5,
  text: 'Hello there. Welcome.',
  cues: [
    { s: 0, o: 0 },
    { s: 4.5, o: 13 },
  ],
  indexedAt: '2026-01-01T00:00:00.000Z',
};

const mapping = (
  transcripts as unknown as {
    mappings: { properties: Record<string, unknown> };
    settings: unknown;
  }
).mappings.properties;

describe('TranscriptDocumentSchema', () => {
  it('accepts a valid document', () => {
    expect(TranscriptDocumentSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    'courseId',
    'moduleId',
    'lessonId',
    'contentItemId',
    'versionId',
    'trackId',
    'language',
  ])('refuses an empty %s', (key) => {
    expect(
      TranscriptDocumentSchema.safeParse({ ...valid, [key]: '' }).success,
    ).toBe(false);
  });

  it.each([
    ['a negative seq', { seq: -1 }],
    ['an end before the start', { startSeconds: 5, endSeconds: 4 }],
    ['empty text', { text: '' }],
    ['text over 2,000 characters', { text: 'a'.repeat(2001) }],
    ['no cues', { cues: [] }],
    ['a first offset above 0', { cues: [{ s: 0, o: 1 }] }],
    [
      'offsets that do not ascend',
      {
        cues: [
          { s: 0, o: 0 },
          { s: 1, o: 0 },
        ],
      },
    ],
    [
      'cue starts that do not ascend',
      {
        cues: [
          { s: 2, o: 0 },
          { s: 1, o: 5 },
        ],
      },
    ],
    ['trackLanguages without the language', { trackLanguages: ['es'] }],
    ['an unknown source', { source: 'machine' }],
  ])('refuses %s', (_, change) => {
    expect(
      TranscriptDocumentSchema.safeParse({ ...valid, ...change }).success,
    ).toBe(false);
  });

  it('accepts text of exactly 2,000 characters and an uploaded track', () => {
    expect(
      TranscriptDocumentSchema.safeParse({
        ...valid,
        text: 'a'.repeat(2000),
        source: 'uploaded',
      }).success,
    ).toBe(true);
  });
});

describe('transcriptDocumentId', () => {
  it('pads the position to 5 digits', () => {
    expect(transcriptDocumentId('i1', 't1', 7)).toBe('i1.t1.00007');
    expect(transcriptDocumentId('i1', 't1', 12345)).toBe('i1.t1.12345');
  });
});

describe('transcripts mapping', () => {
  it('has a property for every schema key', () => {
    expect(Object.keys(mapping).sort()).toEqual(Object.keys(valid).sort());
  });

  it('types the fields as the data model lists them', () => {
    expect(mapping).toMatchObject({
      courseId: { type: 'keyword' },
      trackLanguages: { type: 'keyword' },
      source: { type: 'keyword' },
      isDefault: { type: 'boolean' },
      seq: { type: 'integer' },
      startSeconds: { type: 'float' },
      endSeconds: { type: 'float' },
      text: {
        type: 'text',
        analyzer: 'standard',
        fields: { english: { type: 'text', analyzer: 'english' } },
      },
      cues: { type: 'object', enabled: false },
      indexedAt: { type: 'date' },
    });
  });

  it('uses one shard and no replicas', () => {
    expect((transcripts as unknown as { settings: unknown }).settings).toEqual({
      index: { number_of_shards: 1, number_of_replicas: 0 },
    });
  });

  it('is one of the collection indices and resolves by name', () => {
    expect(INDICES.map((index) => index.name)).toContain('transcripts');
    expect(resolveIndexName('transcripts')).toBe('transcripts');
  });
});
