/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
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
import { Link } from '@tanstack/react-router';
import { Check, Circle } from 'lucide-react';
import { useRef } from 'react';
import { useCoreApi } from '../../../../api';
import { CertificateActions } from '../../../../components/certificate-actions';

// How often, and for how long, to look again for a certificate that is
// being issued.
const PREPARING_REFETCH_MS = 5_000;
const PREPARING_GIVE_UP_MS = 60_000;

const QUIZ_STATE_TEXT = {
  passed: 'Passed',
  'not-attempted': 'Not attempted',
  'not-passed': 'Not passed yet',
  'no-attempts-left':
    'Not passed, no attempts left. Ask your instructor for another attempt.',
} as const;

const REQUIREMENT_LABEL = {
  'complete-items': 'Complete every item',
  'pass-quizzes': 'Pass every quiz',
} as const;

// What a student still needs for the course's certificate, and the
// certificate once they have it. Its own errors stay in the card, so the rest
// of the course home keeps working. Shows nothing when certificates are off.
export function CertificateRequirements({
  courseId,
  courseTitle,
  completedAt,
}: {
  courseId: string;
  courseTitle: string;
  completedAt?: string;
}) {
  const trpc = useCoreApi();
  const startedAt = useRef(Date.now());
  const query = useQuery(
    trpc.certificate.requirements.queryOptions(
      { courseId },
      {
        refetchInterval: ({ state }) =>
          state.data?.allMet &&
          !state.data.certificate &&
          Date.now() - startedAt.current < PREPARING_GIVE_UP_MS
            ? PREPARING_REFETCH_MS
            : false,
      },
    ),
  );

  if (query.data && !query.data.certificatesEnabled) {
    return null;
  }

  const data = query.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">Certificate</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : query.isError || !data ? (
          <div role="alert" className="space-y-3 text-sm">
            <p className="text-destructive">
              {apiErrorMessage(
                query.error,
                "Couldn't load your certificate requirements.",
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              Try again
            </Button>
          </div>
        ) : data.certificate ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">You earned a certificate</p>
            <CertificateActions
              courseId={courseId}
              certificateId={data.certificate.certificateId}
              courseTitle={courseTitle}
              completedAt={completedAt ?? ''}
            />
          </div>
        ) : data.allMet ? (
          <p className="text-sm text-muted-foreground" role="status">
            Your certificate is being prepared.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {data.requirements.map((requirement) => (
              <li key={requirement.kind} className="space-y-2">
                <p className="flex items-center gap-2">
                  {requirement.met ? (
                    <Check
                      className="size-4 text-emerald-600"
                      aria-label="Met"
                    />
                  ) : (
                    <Circle
                      className="size-4 text-muted-foreground"
                      aria-label="Not met"
                    />
                  )}
                  <span>
                    {REQUIREMENT_LABEL[requirement.kind]}: {requirement.done} of{' '}
                    {requirement.total}
                  </span>
                </p>
                {requirement.kind === 'pass-quizzes' && !requirement.met ? (
                  <ul className="ml-6 space-y-1">
                    {requirement.items
                      .filter((item) => item.state !== 'passed')
                      .map((item) => (
                        <li key={item.contentItemId}>
                          <Link
                            to="/learn/$courseId/lesson/$lessonId"
                            params={{ courseId, lessonId: item.lessonId }}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {item.title}
                          </Link>
                          <span className="text-muted-foreground">
                            {' '}
                            · {QUIZ_STATE_TEXT[item.state]}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
