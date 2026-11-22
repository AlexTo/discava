/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { NotificationPreferences } from '@discava/common-shadcn/components/notification-preferences';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCoreApi } from '../../api';
import { requireSignIn } from '../../lib/require-sign-in';

// Which notification emails the user gets; the bell always lists everything.
export const Route = createFileRoute('/settings/notifications')({
  beforeLoad: requireSignIn,
  component: NotificationSettings,
});

function NotificationSettings() {
  usePageTitle('Notification settings');
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const preferencesOptions = trpc.notification.preferences.queryOptions();
  const preferencesQuery = useQuery(preferencesOptions);
  const setPreference = useMutation(
    trpc.notification.setPreference.mutationOptions(),
  );

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10 lg:px-8">
      <h1 className="text-balance text-2xl font-bold tracking-tight">
        Notification settings
      </h1>
      <p className="text-sm text-muted-foreground">
        Choose which notifications also reach you by email. They always appear
        in the bell.
      </p>
      <NotificationPreferences
        preferences={preferencesQuery.data ?? []}
        isLoading={preferencesQuery.isPending}
        isError={preferencesQuery.isError}
        onRetry={() => preferencesQuery.refetch()}
        onChange={async (type, emailEnabled) => {
          const updated = await setPreference.mutateAsync({
            type,
            emailEnabled,
          });
          queryClient.setQueryData(preferencesOptions.queryKey, (rows) =>
            rows?.map((row) => (row.type === updated.type ? updated : row)),
          );
        }}
      />
    </main>
  );
}
