/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { relativeTime } from '@discava/common-web-utils/discussion';
import { Link } from '@tanstack/react-router';

export interface SubmissionRow {
  userId: string;
  displayName: string;
  enrolled: boolean;
  state: 'not_submitted' | 'submitted' | 'resubmission_requested' | 'returned';
  late?: boolean;
  submittedAt?: string;
  version?: number;
  points?: number;
  pointsOutOf?: number;
}

const STATE_LABELS: Record<SubmissionRow['state'], string> = {
  not_submitted: 'Not submitted',
  submitted: 'Waiting',
  resubmission_requested: 'Resubmission requested',
  returned: 'Returned',
};

// The assignment's students in the order the API gives (longest waiting
// first), each linking to their review page.
export function SubmissionsTable({
  courseId,
  contentItemId,
  rows,
  query,
}: {
  courseId: string;
  contentItemId: string;
  rows: SubmissionRow[];
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    refetch: () => unknown;
    fetchNextPage: () => unknown;
  };
}) {
  if (query.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading submissions">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorAlert
        type="error"
        header="Couldn't load the submissions"
        onRetry={() => void query.refetch()}
      >
        {apiErrorMessage(query.error, "Couldn't load the submissions.")}
      </ErrorAlert>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No students are enrolled yet
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Student</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Submitted</th>
              <th className="px-4 py-2 font-medium">Version</th>
              <th className="px-4 py-2 font-medium">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.userId}>
                <td className="px-4 py-2">
                  <Link
                    to="/my-courses/$courseId/assignments/$contentItemId/submissions/$userId"
                    params={{ courseId, contentItemId, userId: row.userId }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.displayName}
                  </Link>
                  {row.enrolled ? null : (
                    <Badge variant="secondary" className="ml-2">
                      No longer enrolled
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2">{STATE_LABELS[row.state]}</td>
                <td className="px-4 py-2">
                  {row.submittedAt ? relativeTime(row.submittedAt) : '-'}
                  {row.late ? (
                    <Badge variant="outline" className="ml-2">
                      Late
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-2">{row.version ?? '-'}</td>
                <td className="px-4 py-2">
                  {row.points !== undefined
                    ? `${row.points} / ${row.pointsOutOf}`
                    : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
