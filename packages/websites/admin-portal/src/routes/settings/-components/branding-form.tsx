/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BRAND_NAME_MAX_LENGTH,
  DEFAULT_BRAND_NAME,
  resolveBrand,
} from '@discava/common-branding/brand';
import {
  brandPalette,
  DEFAULT_PALETTE_VARIABLES,
  parseHex,
} from '@discava/common-branding/colour';
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Switch } from '@discava/common-shadcn/components/ui/switch';
import { useReturnFocus } from '@discava/common-shadcn/hooks/use-return-focus';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useSetBrand } from '@discava/common-web-utils/brand';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
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
const fieldOf = (
  message: string,
): 'name' | 'logo' | 'icon' | 'share-image' | undefined =>
  /\bname\b/i.test(message)
    ? 'name'
    : /\bshare image\b/i.test(message)
      ? 'share-image'
      : /\blogo\b/i.test(message)
        ? 'logo'
        : /\bicon\b/i.test(message)
          ? 'icon'
          : undefined;

const NAME_MESSAGE = `The name must be 1–${BRAND_NAME_MAX_LENGTH} characters.`;

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
  const [previews, setPreviews] = useState<{
    logo?: string;
    icon?: string;
    shareImage?: string;
  }>({});
  // What is typed in the hex field, which may not be a colour yet.
  const [colourText, setColourText] = useState(saved.brand.colour ?? '');
  const colourId = useId();
  const colourPickerId = useId();
  const colourMessageId = useId();
  const nameId = useId();
  const nameMessageId = useId();
  const showNameId = useId();
  const [serverError, setServerError] = useState<string>();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetFocus = useReturnFocus(confirmingReset);

  const typedColour = colourText.trim();
  const palette = typedColour ? brandPalette(typedColour) : undefined;
  const colourMessage = palette && !palette.ok ? palette.reason : undefined;
  const colour = typedColour ? parseHex(typedColour) : null;
  const colourInvalid = colourMessage !== undefined;

  const dirty =
    colour !== saved.brand.colour ||
    colourInvalid ||
    form.name !== saved.brand.name ||
    form.showNameBesideLogo !== saved.brand.showNameBesideLogo ||
    form.logoKey !== saved.brand.logoKey ||
    form.iconKey !== saved.brand.iconKey ||
    form.shareImageKey !== saved.brand.shareImageKey;
  const savedIsDefault =
    saved.brand.name === null &&
    saved.brand.showNameBesideLogo &&
    saved.brand.colour === null &&
    saved.brand.logoKey === null &&
    saved.brand.iconKey === null &&
    saved.brand.shareImageKey === null;
  const nameText = form.name ?? DEFAULT_BRAND_NAME;
  const nameLength = nameText.trim().length;
  const nameInvalid = nameLength < 1 || nameLength > BRAND_NAME_MAX_LENGTH;

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
  const shareImageUrl = previews.shareImage ?? shown.shareImageUrl;
  const name = nameText.trim() || DEFAULT_BRAND_NAME;
  const conflict = save.error as { data?: { code?: string } } | null;
  const isConflict = conflict?.data?.code === 'CONFLICT';
  const serverField = serverError ? fieldOf(serverError) : undefined;
  const nameMessage = nameInvalid
    ? NAME_MESSAGE
    : serverField === 'name'
      ? serverError
      : undefined;

  const resetAll = () => {
    setServerError(undefined);
    setForm({
      name: null,
      showNameBesideLogo: true,
      colour: null,
      logoKey: null,
      iconKey: null,
      shareImageKey: null,
    });
    setPreviews({});
    setColourText('');
    setConfirmingReset(false);
  };

  const submit = async () => {
    setServerError(undefined);
    try {
      const result = await save.mutateAsync({
        expectedRevision: saved.revision,
        ...form,
        colour,
      });
      queryClient.setQueryData(
        trpc.branding.get.queryOptions().queryKey,
        result,
      );
      setBrand(result.brand);
      setColourText(result.brand.colour ?? '');
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
      <section className="space-y-3" aria-labelledby={`${nameId}-title`}>
        <h2 id={`${nameId}-title`} className="text-lg font-semibold">
          Platform name
        </h2>
        <p className="text-sm text-muted-foreground">
          Shown in tab titles, share previews and in text such as the student
          portal's home page.
        </p>
        <div className="max-w-sm space-y-2">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={nameText}
            aria-invalid={nameMessage ? true : undefined}
            aria-describedby={nameMessage ? nameMessageId : undefined}
            onChange={(event) => {
              setServerError(undefined);
              setForm((current) => ({ ...current, name: event.target.value }));
            }}
          />
          <p className="text-xs text-muted-foreground">
            1–{BRAND_NAME_MAX_LENGTH} characters.
          </p>
          {nameMessage && (
            <p
              id={nameMessageId}
              role="alert"
              className="break-words text-sm text-destructive"
            >
              {nameMessage}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={showNameId}
            checked={form.showNameBesideLogo}
            onCheckedChange={(checked) =>
              setForm((current) => ({
                ...current,
                showNameBesideLogo: checked,
              }))
            }
          />
          <Label htmlFor={showNameId}>Show the name beside the logo</Label>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setServerError(undefined);
            setForm((current) => ({ ...current, name: null }));
          }}
        >
          Reset name to default
        </Button>
      </section>
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
        onReset={() => {
          setForm((current) => ({ ...current, logoKey: null }));
          setPreviews((current) => ({ ...current, logo: undefined }));
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
        onReset={() => {
          setForm((current) => ({ ...current, iconKey: null }));
          setPreviews((current) => ({ ...current, icon: undefined }));
        }}
      />
      <ImageField
        kind="share-image"
        title="Share image"
        help="Shown when a link to the platform is shared, for pages with no image of their own."
        imageUrl={shareImageUrl}
        emptyText="No share image set. Pages without an image use the Discava default."
        previewClassName="aspect-[1.91/1] w-60 rounded border bg-background object-cover"
        serverError={serverField === 'share-image' ? serverError : undefined}
        onChoose={() => setServerError(undefined)}
        onUploaded={(key, preview) => {
          setForm((current) => ({ ...current, shareImageKey: key }));
          setPreviews((current) => ({ ...current, shareImage: preview }));
        }}
        onReset={() => {
          setForm((current) => ({ ...current, shareImageKey: null }));
          setPreviews((current) => ({ ...current, shareImage: undefined }));
        }}
      />
      <section className="space-y-3" aria-labelledby={`${colourId}-title`}>
        <h2 id={`${colourId}-title`} className="text-lg font-semibold">
          Brand colour
        </h2>
        <p className="text-sm text-muted-foreground">
          Used for primary buttons and highlights in every portal and on public
          pages. Text on it is chosen for readability.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor={colourPickerId}>Colour picker</Label>
            <input
              id={colourPickerId}
              type="color"
              className="block h-9 w-14 cursor-pointer rounded-md border bg-background p-1"
              value={colour ?? '#000000'}
              onChange={(event) => setColourText(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={colourId}>Hex colour</Label>
            <Input
              id={colourId}
              className="w-36"
              placeholder="#1d4ed8"
              value={colourText}
              aria-invalid={colourMessage ? true : undefined}
              aria-describedby={colourMessage ? colourMessageId : undefined}
              onChange={(event) => setColourText(event.target.value)}
            />
          </div>
          {palette?.ok && (
            <p className="text-sm text-muted-foreground">
              Text colour: {palette.textColour === 'light' ? 'light' : 'dark'} ·
              contrast {palette.contrast.toFixed(1)}:1
            </p>
          )}
        </div>
        {colourMessage && (
          <p
            id={colourMessageId}
            role="alert"
            className="break-words text-sm text-destructive"
          >
            {colourMessage}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setColourText('')}
        >
          Reset colour to default
        </Button>
      </section>
      <BrandPreview
        colourVariables={
          palette?.ok ? palette.variables : DEFAULT_PALETTE_VARIABLES
        }
        logoUrl={logoUrl}
        name={name}
        showName={form.showNameBesideLogo}
        shareImageUrl={shareImageUrl}
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
          {[
            savedIsDefault ? 'Using the default Discava brand' : undefined,
            saved.changed
              ? `Last changed by ${saved.changed.byName}, ${relativeTime(saved.changed.at)}`
              : undefined,
          ]
            .filter(Boolean)
            .join(' · ') || 'Using the default Discava brand'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmingReset(true)}
          >
            Reset all to default
          </Button>
          <PendingButton
            type="submit"
            disabled={!dirty || nameInvalid || colourInvalid}
            pending={save.isPending}
            pendingLabel="Saving…"
          >
            Save
          </PendingButton>
        </div>
      </footer>
      <AlertDialog open={confirmingReset} onOpenChange={setConfirmingReset}>
        <AlertDialogContent onCloseAutoFocus={resetFocus.onCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all to the default brand?</AlertDialogTitle>
            <AlertDialogDescription>
              The name, logo, icon, share image and colour go back to the
              Discava default in this form. Nothing changes for visitors until
              you save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetAll}>Reset all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
