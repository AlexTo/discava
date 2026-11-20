/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useCoreApi, useCoreApiClient } from '../../../api';
import { useLinkedInAddToProfileUrl } from '../../../components/add-to-linkedin-button';

// How long the click's record may hold up the redirect to LinkedIn.
const RECORD_TIMEOUT_MS = 2000;

type EmailSource = 'issued-email' | 'reminder-email';

// The link in a certificate email. Public: it records the first use of
// "Add to LinkedIn profile", then replaces the page with LinkedIn's form,
// whether or not the record worked.
export const Route = createFileRoute('/certificates/$certificateId/linkedin')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { source: EmailSource } => ({
    source:
      search.source === 'reminder-email' ? 'reminder-email' : 'issued-email',
  }),
  component: RouteComponent,
});

const isNotFound = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code === 'NOT_FOUND';

// Keeps the address this page was opened from out of the request to LinkedIn.
const useNoReferrer = () => {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
};

function RouteComponent() {
  const { certificateId } = Route.useParams();
  const { source } = Route.useSearch();
  const trpc = useCoreApi();
  const client = useCoreApiClient();
  useNoReferrer();

  const query = useQuery(
    trpc.certificate.verify.queryOptions({ certificateId }, { retry: false }),
  );

  if (query.isError) {
    return isNotFound(query.error) ? (
      <Message>
        <h1 className="text-balance text-2xl font-bold tracking-tight">
          Certificate not found
        </h1>
        <p className="text-sm text-muted-foreground">
          Check the certificate ID and try again.
        </p>
        <Button variant="outline" asChild>
          <Link to="/">Go to the home page</Link>
        </Button>
      </Message>
    ) : (
      <Message>
        <ErrorAlert type="error" header="Couldn't open LinkedIn">
          Something went wrong. Try again.
        </ErrorAlert>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </Message>
    );
  }

  return (
    <Redirect
      certificate={query.data}
      source={source}
      record={(id, from) =>
        client.certificate.recordLinkedInClick.mutate({
          certificateId: id,
          source: from,
        })
      }
    />
  );
}

const Message = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto w-full max-w-2xl space-y-4 px-6 py-16 text-center">
    {children}
  </main>
);

function Redirect({
  certificate,
  source,
  record,
}: {
  certificate:
    | { certificateId: string; courseTitle: string; completedAt: string }
    | undefined;
  source: EmailSource;
  record: (certificateId: string, source: EmailSource) => Promise<unknown>;
}) {
  const url = useLinkedInAddToProfileUrl(
    certificate ?? { certificateId: '', courseTitle: '', completedAt: '' },
  );
  const started = useRef(false);

  useEffect(() => {
    if (!certificate || started.current) {
      return;
    }
    started.current = true;
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, RECORD_TIMEOUT_MS),
    );
    const recorded = Promise.resolve()
      .then(() => record(certificate.certificateId, source))
      .catch(() => {});
    void Promise.race([recorded, timeout]).then(() => {
      window.location.replace(url);
    });
  }, [certificate, source, record, url]);

  return (
    <Message>
      <h1 className="text-balance text-2xl font-bold tracking-tight">
        Opening LinkedIn…
      </h1>
      {certificate ? (
        <p className="text-sm">
          <a className="underline" href={url}>
            Continue to LinkedIn
          </a>
        </p>
      ) : null}
    </Message>
  );
}
