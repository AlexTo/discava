/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TranscriptCue } from '@discava/common-web-utils/webvtt';
import type { CaptionTrack } from '@discava/core-table';
import {
  type ITranscriptDocument,
  TranscriptDocumentSchema,
  transcriptDocumentId,
} from '@discava/search';

// How much of a track one document holds (specs/20261120-002950-transcript-search,
// research R-2). A passage is long enough to read as a sentence or two and
// short enough that a match lands near the moment it was spoken.
export const PASSAGE_SECONDS = 30;
export const PASSAGE_CHARACTERS = 600;

// The most a document's `text` can hold (TranscriptDocumentSchema).
const MAX_TEXT_CHARACTERS = 2000;

export interface Passage {
  seq: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  /** Each cue's start in seconds and its character offset in `text`. */
  cues: { s: number; o: number }[];
}

// The private-use characters the search response uses as highlight tags must
// not occur in the text.
const cleanText = (text: string): string =>
  text.replace(/[]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Splits a track's cues into overlapping passages. A passage takes cues while
 * the next one keeps it within PASSAGE_SECONDS of its first cue's start and
 * within PASSAGE_CHARACTERS. Every passage after the first starts with the
 * previous passage's last cue, so two neighbouring cues share a passage, and
 * adds at least one new cue. A single cue over either limit is a passage on
 * its own, cut at 2,000 characters.
 */
export const buildPassages = (cues: TranscriptCue[]): Passage[] => {
  const kept = cues
    .map((cue) => ({ ...cue, text: cleanText(cue.text) }))
    .filter((cue) => cue.text !== '');
  const passages: Passage[] = [];

  let first = 0;
  // Whether `first` is the previous passage's last cue, which this passage
  // must add to.
  let overlaps = false;
  while (first < kept.length) {
    let last = first;
    let length = kept[first].text.length;
    let end = kept[first].end;
    while (last + 1 < kept.length) {
      const next = kept[last + 1];
      const nextLength = length + 1 + next.text.length;
      const nextEnd = Math.max(end, next.end);
      if (
        nextEnd - kept[first].start > PASSAGE_SECONDS ||
        nextLength > PASSAGE_CHARACTERS
      ) {
        break;
      }
      last++;
      length = nextLength;
      end = nextEnd;
    }

    if (last === first && overlaps) {
      // Nothing fits beside the shared cue: start afresh after it.
      first++;
      overlaps = false;
      continue;
    }

    const group = kept.slice(first, last + 1);
    const offsets: number[] = [];
    let offset = 0;
    for (const cue of group) {
      offsets.push(offset);
      offset += cue.text.length + 1;
    }
    passages.push({
      seq: passages.length,
      startSeconds: group[0].start,
      endSeconds: Math.max(...group.map((cue) => cue.end), group[0].start),
      text: group
        .map((cue) => cue.text)
        .join(' ')
        .slice(0, MAX_TEXT_CHARACTERS),
      cues: group.map((cue, index) => ({ s: cue.start, o: offsets[index] })),
    });

    if (last === kept.length - 1) {
      break;
    }
    if (last === first) {
      // A cue on its own: the next passage has no cue to share.
      first++;
      overlaps = false;
    } else {
      first = last;
      overlaps = true;
    }
  }
  return passages;
};

/** The item fields a document carries. */
export interface TranscriptItemSource {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}

/**
 * The documents for one caption track: its passages, each validated by
 * TranscriptDocumentSchema, with the id it is written under.
 */
export const toTranscriptDocuments = ({
  item,
  versionId,
  track,
  trackLanguages,
  cues,
  now,
}: {
  item: TranscriptItemSource;
  versionId: string;
  track: Pick<CaptionTrack, 'trackId' | 'language' | 'source' | 'isDefault'>;
  trackLanguages: string[];
  cues: TranscriptCue[];
  now: Date;
}): { id: string; document: ITranscriptDocument }[] =>
  buildPassages(cues).map((passage) => ({
    id: transcriptDocumentId(item.contentItemId, track.trackId, passage.seq),
    document: TranscriptDocumentSchema.parse({
      courseId: item.courseId,
      moduleId: item.moduleId,
      lessonId: item.lessonId,
      contentItemId: item.contentItemId,
      versionId,
      trackId: track.trackId,
      language: track.language,
      source: track.source,
      isDefault: track.isDefault,
      trackLanguages,
      ...passage,
      indexedAt: now.toISOString(),
    }),
  }));
