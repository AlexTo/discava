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
import { ScoreChart } from './score-chart';

export interface QuizFigures {
  contentItemId: string;
  title: string;
  students: number;
}

const percent = (value: number | null) => (value === null ? '–' : `${value}%`);

// One quiz: its most-missed questions, ranked by miss rate, and the spread of
// the students' best scores. The figures are read when the panel is opened,
// so a course with many quizzes asks for none of them up front.
export function QuizPanel({
  courseId,
  quiz,
}: {
  courseId: string;
  quiz: QuizFigures;
}) {
  const [open, setOpen] = useState(false);
  const trpc = useInstructorApi();
  const query = useQuery({
    ...trpc.analytics.quiz.queryOptions({
      courseId,
      contentItemId: quiz.contentItemId,
    }),
    enabled: open,
  });
  const figures = query.data;
  const anyAttempts =
    figures !== undefined &&
    (figures.students > 0 || figures.questions.some((q) => q.attempts > 0));
  let rank = 0;

  return (
    <Card role="article" aria-label={quiz.title}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base" role="heading" aria-level={3}>
            {quiz.title}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {quiz.students === 1 ? '1 student' : `${quiz.students} students`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? 'Hide analysis' : 'Show analysis'}
        </Button>
      </CardHeader>
      {open && (
        <CardContent>
          {query.isError ? (
            <div className="space-y-3">
              <ErrorAlert type="error" header="Couldn't load this quiz">
                {apiErrorMessage(query.error)}
              </ErrorAlert>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => query.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : !figures ? (
            <Skeleton
              className="h-40 w-full rounded-xl"
              aria-label="Loading the quiz analysis"
            />
          ) : !anyAttempts ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nobody has attempted this quiz yet.
            </p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Most-missed questions for {quiz.title}
                  </caption>
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-2 font-medium">
                        Rank
                      </th>
                      <th scope="col" className="py-2 pr-2 font-medium">
                        Question
                      </th>
                      <th scope="col" className="py-2 pr-2 font-medium">
                        Attempts
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
                        <td className="py-2 pr-2 [overflow-wrap:anywhere]">
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
                              Not enough attempts
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium">
                  Best score per student
                </h4>
                <ScoreChart
                  title={`Best scores for ${quiz.title}`}
                  bands={figures.scoreBands}
                />
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
