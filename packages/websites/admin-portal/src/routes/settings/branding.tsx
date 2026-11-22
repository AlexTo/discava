/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useAdminApi } from '../../api';
import { BrandingForm } from './-components/branding-form';

// The platform's logo and icon (and, as they arrive, name, share image and
// colour), seen by every visitor of every portal and public page.
export const Route = createFileRoute('/settings/branding')({
  component: BrandingSettings,
});

function BrandingSettings() {
  usePageTitle('Branding');
  const trpc = useAdminApi();
  const query = useQuery(trpc.branding.get.queryOptions());
  // Outside the form, which starts again from the saved brand after a save.
  const [justSaved, setJustSaved] = useState(false);
  const onSaved = useCallback(() => setJustSaved(true), []);
  const onEdited = useCallback(() => setJustSaved(false), []);

  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-balance text-2xl font-bold tracking-tight">
        Branding
      </h1>
      <p className="text-sm text-muted-foreground">
        Set how the platform looks to everyone who visits it. Changes reach
        visitors within 5 minutes of saving.
      </p>
      {query.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Spinner /> Loading…
        </p>
      )}
      {query.isError && (
        <ErrorAlert
          type="error"
          header="Couldn't load the branding"
          onRetry={() => query.refetch()}
        >
          {apiErrorMessage(query.error)}
        </ErrorAlert>
      )}
      {query.data && (
        <BrandingForm
          // A reload starts the form again from what is saved.
          key={`${query.data.revision}-${query.dataUpdatedAt}`}
          saved={query.data}
          onReload={() => query.refetch()}
          onSaved={onSaved}
          onEdited={onEdited}
        />
      )}
      {justSaved && (
        <ErrorAlert header="Branding saved">
          Branding saved. Visitors see it within 5 minutes.
        </ErrorAlert>
      )}
    </section>
  );
}
