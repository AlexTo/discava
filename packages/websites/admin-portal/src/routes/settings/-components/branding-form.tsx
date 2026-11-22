/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveBrand } from '@discava/common-branding/brand';
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useSetBrand } from '@discava/common-web-utils/brand';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAdminApi } from '../../../api';
import { BrandPreview } from './brand-preview';
import { ImageField } from './image-field';

// What branding.get returns.
export interface SavedBrand {
  brand: {
    name: string | null;
    showNameBesideLogo: boolean;
    colour: string | null;
    logoKey: string | null;
    iconKey: string | null;
    shareImageKey: string | null;
  };
  revision: number;
  changed: { by: string; byName: string; at: string } | null;
}

const UNSAVED_MESSAGE = 'You have unsaved branding changes. Leave this page?';

const relativeTime = (iso: string): string => {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as const) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
};

// Which section a message from the server is about, by what it names.
const fieldOf = (message: string): 'logo' | 'icon' | undefined =>
  /\blogo\b/i.test(message)
    ? 'logo'
    : /\bicon\b/i.test(message)
      ? 'icon'
      : undefined;

export function BrandingForm({
  saved,
  onReload,
  onSaved,
  onEdited,
}: {
  saved: SavedBrand;
  onReload: () => void;
  /** Called after a save, which also restarts the form from the result. */
  onSaved: () => void;
  /** Called when the form has unsaved changes. */
  onEdited: () => void;
}) {
  const trpc = useAdminApi();
  const queryClient = useQueryClient();
  const setBrand = useSetBrand();
  const mediaBase: string | undefined =
    useRuntimeConfig().media?.PublicMediaBucket;
  const save = useMutation(trpc.branding.save.mutationOptions());

  const [form, setForm] = useState(saved.brand);
  // Where an image uploaded in this session can be seen before it is saved.
  const [previews, setPreviews] = useState<{ logo?: string; icon?: string }>(
    {},
  );
  const [serverError, setServerError] = useState<string>();

  const dirty =
    form.logoKey !== saved.brand.logoKey ||
    form.iconKey !== saved.brand.iconKey;

  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm(UNSAVED_MESSAGE),
    enableBeforeUnload: dirty,
  });
  useEffect(() => {
    if (dirty) {
      onEdited();
    }
  }, [dirty, onEdited]);

  const shown = resolveBrand(form, mediaBase);
  const logoUrl = previews.logo ?? shown.logoUrl;
  const iconUrl = previews.icon ?? shown.iconUrl ?? '/favicon.ico';
  const conflict = save.error as { data?: { code?: string } } | null;
  const isConflict = conflict?.data?.code === 'CONFLICT';
  const serverField = serverError ? fieldOf(serverError) : undefined;

  const submit = async () => {
    setServerError(undefined);
    try {
      const result = await save.mutateAsync({
        expectedRevision: saved.revision,
        ...form,
      });
      queryClient.setQueryData(
        trpc.branding.get.queryOptions().queryKey,
        result,
      );
      setBrand(result.brand);
      onSaved();
    } catch (error) {
      if (
        (error as { data?: { code?: string } }).data?.code === 'BAD_REQUEST'
      ) {
        setServerError(apiErrorMessage(error));
      }
    }
  };

  return (
    <form
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ImageField
        kind="logo"
        title="Logo"
        help="Shown in the header of every portal and on public pages."
        imageUrl={logoUrl}
        previewClassName="h-10 w-auto max-w-40 rounded border bg-background object-contain"
        serverError={serverField === 'logo' ? serverError : undefined}
        onChoose={() => setServerError(undefined)}
        onUploaded={(key, preview) => {
          setForm((current) => ({ ...current, logoKey: key }));
          setPreviews((current) => ({ ...current, logo: preview }));
        }}
      />
      <ImageField
        kind="icon"
        title="Icon"
        help="Shown in browser tabs and on home screens. 512 × 512 is a good size."
        imageUrl={iconUrl}
        previewClassName="size-12 rounded border bg-background object-contain"
        serverError={serverField === 'icon' ? serverError : undefined}
        onChoose={() => setServerError(undefined)}
        onUploaded={(key, preview) => {
          setForm((current) => ({ ...current, iconKey: key }));
          setPreviews((current) => ({ ...current, icon: preview }));
        }}
      />
      <BrandPreview
        logoUrl={logoUrl}
        name={shown.name}
        showName={shown.showNameBesideLogo}
      />

      {serverError && !serverField && (
        <ErrorAlert type="error" header="Couldn't save the branding">
          {serverError}
        </ErrorAlert>
      )}
      {isConflict && (
        <ErrorAlert
          type="error"
          header="Someone else changed the branding"
          onRetry={onReload}
          retryLabel="Reload"
        >
          {apiErrorMessage(save.error)} Your changes stay here until you reload.
        </ErrorAlert>
      )}
      {save.isError && !isConflict && !serverError && (
        <ErrorAlert type="error" header="Couldn't save the branding">
          {apiErrorMessage(save.error)}
        </ErrorAlert>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <p className="min-w-0 break-words text-sm text-muted-foreground">
          {saved.changed
            ? `Last changed by ${saved.changed.byName}, ${relativeTime(saved.changed.at)}`
            : 'Using the default Discava brand'}
        </p>
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
      </footer>
    </form>
  );
}
