/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useAuth } from 'react-oidc-context';
import { useCoreApi } from '../../../api';
import { OwnerShare } from './-components/owner-share';

// A certificate's public page, for anyone with its ID (signed in or not):
// who completed which course, and when. Nothing else about the learner.
export const Route = createFileRoute('/certificates/$certificateId/')({
  component: RouteComponent,
});

const isNotFound = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code === 'NOT_FOUND';

function RouteComponent() {
  usePageTitle('Certificate');
  const { certificateId } = Route.useParams();
  const trpc = useCoreApi();
  const query = useQuery(
    trpc.certificate.verify.queryOptions(
      { certificateId },
      // A missing certificate stays missing: no point asking again.
      { retry: false },
    ),
  );

  // Only the owner sees the LinkedIn section. Signed out, there's nothing to
  // ask: the query stays off.
  const { isAuthenticated } = useAuth();
  const mine = useQuery(
    trpc.certificate.myCertificates.queryOptions(undefined, {
      enabled: isAuthenticated,
    }),
  );
  const isOwner =
    query.data !== undefined &&
    (mine.data ?? []).some((c) => c.certificateId === query.data.certificateId);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      {query.isPending ? (
        <div
          className="space-y-4 rounded-2xl border p-10"
          data-testid="certificate-loading"
        >
          <Skeleton className="mx-auto h-4 w-48" />
          <Skeleton className="mx-auto h-8 w-64" />
          <Skeleton className="mx-auto h-4 w-56" />
        </div>
      ) : query.isError ? (
        isNotFound(query.error) ? (
          <div className="space-y-4 text-center">
            <h1 className="text-balance text-2xl font-bold tracking-tight">
              Certificate not found
            </h1>
            <p className="text-sm text-muted-foreground">
              Check the certificate ID and try again.
            </p>
            <Button variant="outline" asChild>
              <Link to="/">Go to the home page</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <ErrorAlert type="error" header="Couldn't check this certificate">
              Something went wrong. Try again.
            </ErrorAlert>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        )
      ) : (
        <section
          aria-label="Certificate of completion"
          className="space-y-3 rounded-2xl border p-10 text-center"
        >
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Certificate of completion
          </p>
          <h1 className="text-balance text-3xl font-bold tracking-tight">
            {query.data.learnerName}
          </h1>
          <p className="text-sm text-muted-foreground">
            has completed the course
          </p>
          <h2 className="text-xl font-semibold">{query.data.courseTitle}</h2>
          <p className="text-sm">{query.data.completedOn}</p>
          <section
            aria-labelledby="certificate-statement"
            className="space-y-2 pt-4"
          >
            <h3 id="certificate-statement" className="text-sm font-semibold">
              What this certificate confirms
            </h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {query.data.statement.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
          <p className="pt-4 text-xs text-muted-foreground">
            Certificate ID: {query.data.certificateId}
          </p>
        </section>
      )}
      {query.data && isOwner ? <OwnerShare certificate={query.data} /> : null}
    </main>
  );
}
