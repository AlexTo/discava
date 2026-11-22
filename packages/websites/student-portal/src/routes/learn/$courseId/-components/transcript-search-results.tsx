/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { formatTime } from '@discava/common-shadcn/components/video-controls';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { loadPreferences } from '@discava/common-web-utils/video-player';
import { spokenTime } from '@discava/common-web-utils/webvtt';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCoreApi } from '../../../../api';

const MIN_LENGTH = 2;
const MAX_LENGTH = 200;

// The moments of a course's videos matching `q`, each a link that opens the
// lesson at that video and second.
export function TranscriptSearchResults({
  courseId,
  q,
}: {
  courseId: string;
  q: string;
}) {
  const trpc = useCoreApi();
  const text = q.trim();
  const valid = text.length >= MIN_LENGTH && text.length <= MAX_LENGTH;
  const search = useQuery(
    trpc.transcript.search.queryOptions(
      { courseId, q: text, language: loadPreferences().captionLanguage },
      { enabled: valid, staleTime: 60_000, retry: false },
    ),
  );

  let status = '';
  let body;
  if (!valid) {
    body = (
      <p className="text-muted-foreground">
        Search what was said in this course's videos.
      </p>
    );
  } else if (search.isPending) {
    status = 'Searching…';
    body = (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  } else if (search.isError) {
    body = (
      <ErrorAlert type="error" header="Couldn't search the transcripts">
        <p>{apiErrorMessage(search.error)}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => search.refetch()}
        >
          Try again
        </Button>
      </ErrorAlert>
    );
  } else if (search.data.items.length === 0) {
    status = 'No moments match';
    body = (
      <p className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
        No moments match '{text}'. Check the spelling, or try the words in the
        captions' language.
      </p>
    );
  } else {
    const { items, hasMore } = search.data;
    status = `${items.length} ${items.length === 1 ? 'moment' : 'moments'} found`;
    body = (
      <>
        <h2 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">
          Moments matching '{text}'
        </h2>
        <ol aria-label="Search results" className="mt-4 space-y-3">
          {items.map((moment) => (
            <li
              key={`${moment.contentItemId}-${moment.language}-${moment.startSeconds}`}
            >
              <Link
                to="/learn/$courseId/lesson/$lessonId"
                params={{ courseId, lessonId: moment.lessonId }}
                search={{ item: moment.contentItemId, t: moment.startSeconds }}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted/60"
              >
                <span className="block min-w-0 break-words text-xs text-muted-foreground">
                  {moment.moduleTitle} · Lesson: {moment.lessonTitle}
                </span>
                <span className="mt-1 block text-sm font-medium">
                  {moment.itemTitle} ·{' '}
                  <span aria-hidden="true">
                    {formatTime(moment.startSeconds)}
                  </span>
                  <span className="sr-only">
                    {spokenTime(moment.startSeconds)}
                  </span>
                </span>
                <span className="mt-1 block min-w-0 break-words text-sm">
                  {moment.snippet.map((part, index) =>
                    part.match ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: parts are static text
                      <mark
                        key={index}
                        className="bg-primary/20 font-semibold text-foreground"
                      >
                        {part.text}
                      </mark>
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: parts are static text
                      <span key={index}>{part.text}</span>
                    ),
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {hasMore ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Showing the 20 best matches. Add a word to narrow the search.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div>
      <p role="status" className="sr-only">
        {status}
      </p>
      {body}
    </div>
  );
}
