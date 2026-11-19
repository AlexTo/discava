/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '../components/alert';
import { Spinner } from '../components/spinner';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';

// The link in a notification email. Public: the signed token in it says whose
// emails these are, so nobody needs to sign in. Opening the page only reads
// the link; the button is what changes anything.
export const Route = createFileRoute('/unsubscribe')({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === 'string' ? { token: search.token } : {},
  component: Unsubscribe,
});

interface LinkInfo {
  type: string;
  name: string;
}

class InvalidLinkError extends Error {}

const callUnsubscribe = async (
  apiUrl: string,
  token: string,
  init?: { method: 'POST'; resubscribe?: boolean },
): Promise<LinkInfo> => {
  const url = `${apiUrl.replace(/\/$/, '')}/unsubscribe/${encodeURIComponent(token)}${
    init?.resubscribe ? '?resubscribe=1' : ''
  }`;
  const response = await fetch(url, init ? { method: init.method } : undefined);
  // 404 is a link that isn't ours or is stale; 400 a type that can't be
  // switched off. Neither has anything to stop.
  if (response.status === 404 || response.status === 400) {
    throw new InvalidLinkError();
  }
  if (!response.ok) {
    throw new Error(`Unexpected response ${response.status}`);
  }
  return response.json();
};

function Unsubscribe() {
  const { token } = Route.useSearch();
  const { apis } = useRuntimeConfig();
  const apiUrl: string = apis.CoreApi;
  const [phase, setPhase] = useState<'ask' | 'stopped' | 'resumed'>('ask');

  const linkQuery = useQuery({
    queryKey: ['unsubscribe', token],
    queryFn: () => callUnsubscribe(apiUrl, token as string),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const change = useMutation({
    mutationFn: (resubscribe: boolean) =>
      callUnsubscribe(apiUrl, token as string, { method: 'POST', resubscribe }),
    onSuccess: (_info, resubscribe) =>
      setPhase(resubscribe ? 'resumed' : 'stopped'),
  });

  const invalid =
    !token ||
    linkQuery.error instanceof InvalidLinkError ||
    change.error instanceof InvalidLinkError;
  const name = linkQuery.data?.name;

  let content: React.ReactNode;
  if (invalid) {
    content = (
      <>
        <h1 className="text-balance text-2xl font-bold tracking-tight">
          This link is not valid.
        </h1>
        <Button asChild variant="outline">
          <Link to="/">Go to the home page</Link>
        </Button>
      </>
    );
  } else if (linkQuery.isError) {
    content = (
      <Alert type="error" header="Couldn't open this link">
        <p>Something went wrong. Check your connection and try again.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => linkQuery.refetch()}
        >
          Try again
        </Button>
      </Alert>
    );
  } else if (!name) {
    content = (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  } else if (phase === 'ask') {
    content = (
      <>
        <h1 className="text-balance text-2xl font-bold tracking-tight">
          Stop {name} emails?
        </h1>
        <p className="text-muted-foreground">
          You'll still see these notifications in the bell.
        </p>
        <Button
          type="button"
          disabled={change.isPending}
          onClick={() => change.mutate(false)}
        >
          Stop these emails
        </Button>
      </>
    );
  } else if (phase === 'stopped') {
    content = (
      <>
        <h1 className="text-balance text-2xl font-bold tracking-tight">
          You won't get {name} emails any more.
        </h1>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={change.isPending}
            onClick={() => change.mutate(true)}
          >
            Turn them back on
          </Button>
          <Button asChild variant="ghost">
            <Link to="/settings/notifications">Notification settings</Link>
          </Button>
        </div>
      </>
    );
  } else {
    content = (
      <>
        <h1 className="text-balance text-2xl font-bold tracking-tight">
          {name} emails are back on.
        </h1>
        <Button asChild variant="ghost">
          <Link to="/settings/notifications">Notification settings</Link>
        </Button>
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-6 py-16">
      {content}
      {change.isError && !invalid ? (
        <Alert type="error" header="Couldn't save that">
          <p>Something went wrong. Try again.</p>
        </Alert>
      ) : null}
    </main>
  );
}
