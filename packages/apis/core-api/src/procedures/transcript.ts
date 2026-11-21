/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveIndexName } from '@discava/search';
import { TRPCError } from '@trpc/server';
import { watchableVideos } from '../helpers/transcript-access.js';
import { buildTranscriptSearchRequest } from '../helpers/transcript-query.js';
import { transcriptSnippet } from '../helpers/transcript-snippet.js';
import { courseSearchProcedure } from '../init.js';
import {
  TranscriptSearchInputSchema,
  TranscriptSearchOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';
import { mapSearchError } from './search.js';

// As the course search's: a cold collection must answer with a retriable
// error before the Lambda's own timeout.
const SEARCH_REQUEST_TIMEOUT_MS = 8_000;

const MAX_ITEMS = 20;

interface ITranscriptHit {
  _source: {
    contentItemId: string;
    versionId: string;
    trackId: string;
    language: string;
    text: string;
    cues: { s: number; o: number }[];
  };
  highlight?: Record<string, string[]>;
}

/**
 * Moments in a course's videos where a phrase was said, for a learner
 * enrolled in it. What may be found is decided here, from the curriculum read
 * now, and not by the index: the query is limited to the videos a student can
 * watch, and every hit is checked again against the version and tracks being
 * played, so a video hidden a moment ago can't be found even if the index
 * still holds it.
 */
export const searchTranscripts = courseSearchProcedure
  .input(TranscriptSearchInputSchema)
  .output(TranscriptSearchOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const [{ data }, enrolment] = await Promise.all([
      // Every page: a course's curriculum can exceed a single 1 MB query page.
      coreTable.collections
        .curriculum({ courseId: input.courseId })
        .go({ pages: 'all' }),
      getEnrolment(coreTable, input.courseId, ctx.user!.sub),
    ]);
    const [course] = data.course;
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);

    const videos = watchableVideos({
      modules: data.module,
      lessons: data.lesson,
      contentItems: data.contentItem,
    });
    if (videos.length === 0) {
      return { items: [], hasMore: false };
    }
    const byItem = new Map(videos.map((video) => [video.contentItemId, video]));

    const { body } = await ctx
      .search!.search(
        {
          index: resolveIndexName('transcripts'),
          body: buildTranscriptSearchRequest({
            courseId: input.courseId,
            contentItemIds: videos.map((video) => video.contentItemId),
            q: input.q,
            language: input.language,
          }) as never,
        },
        { requestTimeout: SEARCH_REQUEST_TIMEOUT_MS },
      )
      .catch(mapSearchError);

    const hits = body.hits.hits as ITranscriptHit[];
    const modules = new Map(data.module.map((m) => [m.moduleId, m]));
    const lessons = new Map(data.lesson.map((l) => [l.lessonId, l]));
    const contentItems = new Map(
      data.contentItem.map((i) => [i.contentItemId, i]),
    );

    const seen = new Set<string>();
    const items = hits.flatMap(({ _source: doc, highlight }) => {
      const video = byItem.get(doc.contentItemId);
      if (
        !video ||
        doc.versionId !== video.versionId ||
        !video.trackIds.includes(doc.trackId)
      ) {
        return [];
      }
      const { startSeconds, snippet } = transcriptSnippet(
        highlight?.text?.[0] ?? highlight?.['text.english']?.[0] ?? doc.text,
        doc.cues,
      );
      const key = `${doc.contentItemId}.${doc.trackId}.${startSeconds}`;
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [
        {
          moduleId: video.moduleId,
          moduleTitle: modules.get(video.moduleId)?.title ?? '',
          lessonId: video.lessonId,
          lessonTitle: lessons.get(video.lessonId)?.title ?? '',
          contentItemId: video.contentItemId,
          itemTitle: contentItems.get(video.contentItemId)?.title ?? '',
          startSeconds,
          language: doc.language,
          snippet,
        },
      ];
    });

    return {
      items: items.slice(0, MAX_ITEMS),
      hasMore: items.length > MAX_ITEMS || hits.length >= 40,
    };
  });
