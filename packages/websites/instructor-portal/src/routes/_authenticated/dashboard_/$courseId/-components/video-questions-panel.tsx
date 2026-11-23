/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../api';

export interface VideoQuestionsListing {
  contentItemId: string;
  title: string;
  questions: number;
}

const percent = (value: number | null) => (value === null ? '–' : `${value}%`);

// "1:30", or "1:05:00" from an hour on; null is a question after the video.
const moment = (atSeconds: number | null) => {
  if (atSeconds === null) {
    return 'End of video';
  }
  const hours = Math.floor(atSeconds / 3600);
  const minutes = Math.floor((atSeconds % 3600) / 60);
  const seconds = String(atSeconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
};

// The videos that ask questions, and for the one chosen, how each question
// fared. The figures are read when a video is chosen, so a course with many
// videos asks for none of them up front.
export function VideoQuestionsPanel({
  courseId,
  videos,
}: {
  courseId: string;
  videos: VideoQuestionsListing[];
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const trpc = useInstructorApi();
  const video = videos.find(({ contentItemId }) => contentItemId === chosen);
  const query = useQuery({
    ...trpc.analytics.videoQuestions.queryOptions({
      courseId,
      contentItemId: chosen ?? '',
    }),
    enabled: video !== undefined,
  });
  const figures = query.data;
  let rank = 0;

  return (
    <Card role="article" aria-label="Video questions">
      <CardHeader>
        <CardTitle className="text-base" role="heading" aria-level={3}>
          Video questions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {videos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No videos with questions are shown to learners yet.
          </p>
        ) : (
          <ul className="divide-y">
            {videos.map(({ contentItemId, title, questions }) => (
              <li
                key={contentItemId}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">
                    {questions === 1 ? '1 question' : `${questions} questions`}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={chosen === contentItemId}
                  aria-label={`${chosen === contentItemId ? 'Hide' : 'Show'} results for ${title}`}
                  onClick={() =>
                    setChosen((was) =>
                      was === contentItemId ? null : contentItemId,
                    )
                  }
                >
                  {chosen === contentItemId ? 'Hide results' : 'Show results'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {video &&
          (query.isError ? (
            <ErrorAlert
              type="error"
              header="Couldn't load this video"
              onRetry={() => void query.refetch()}
            >
              {apiErrorMessage(query.error)}
            </ErrorAlert>
          ) : !figures ? (
            <Skeleton
              className="h-40 w-full rounded-xl"
              aria-label="Loading the video's results"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Question results for {video.title}
                </caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-2 font-medium">
                      Rank
                    </th>
                    <th scope="col" className="py-2 pr-2 font-medium">
                      Moment
                    </th>
                    <th scope="col" className="py-2 pr-2 font-medium">
                      Question
                    </th>
                    <th scope="col" className="py-2 pr-2 font-medium">
                      Answers
                    </th>
                    <th scope="col" className="py-2 pr-2 font-medium">
                      Misses
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Miss rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {figures.questions.map((question) => (
                    <tr key={question.questionId} className="border-b">
                      <td className="py-2 pr-2 tabular-nums">
                        {question.ranked ? ++rank : '–'}
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap tabular-nums">
                        {moment(question.atSeconds)}
                      </td>
                      <td className="py-2 pr-2">
                        {question.text || question.questionId}
                      </td>
                      <td className="py-2 pr-2 tabular-nums">
                        {question.attempts}
                      </td>
                      <td className="py-2 pr-2 tabular-nums">
                        {question.misses}
                      </td>
                      <td className="py-2 tabular-nums">
                        {question.ranked ? (
                          percent(question.missRate)
                        ) : (
                          <span className="text-muted-foreground">
                            Not enough answers yet
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
