/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@discava/common-shadcn/components/ui/avatar';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { usePublicMediaUrl } from '@discava/common-web-utils/public-media-url';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { useInstructorApi } from '../../api';
import { ImageCropDialog } from '../../components/image-crop-dialog';
import { PROFILE_PHOTO_SIZE } from '../../lib/crop-to-jpeg';

// The limits the API enforces (see instructor-api's profile schema).
const profileFormSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(60),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Use at least 3 characters')
    .max(30, 'Use at most 30 characters')
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'Use lower-case letters, numbers and single hyphens',
    ),
  headline: z.string().max(100, 'Keep the headline under 100 characters'),
  bio: z.string().max(2000, 'Keep the bio under 2000 characters'),
});

interface ProfileData {
  handle: string;
  displayName: string;
  headline?: string;
  bio?: string;
  photoKey?: string;
  version: number;
  isPublic: boolean;
}

const PROFILE_CHANGED = 'Your profile changed; reload and try again';

export const Route = createFileRoute('/_authenticated/profile')({
  component: ProfilePage,
});

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || '?';

function ProfilePage() {
  usePageTitle('Profile');
  const trpc = useInstructorApi();
  const profileQuery = useQuery(trpc.profile.get.queryOptions());
  // The form keeps what was typed when a photo change bumps the version; it
  // starts again from the saved profile only on Reload.
  const [generation, setGeneration] = useState(0);
  const [saved, setSaved] = useState(false);

  const heading = (
    <div>
      <h1 className="text-balance text-2xl font-bold tracking-tight">
        Profile
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Shown to students on your courses' pages and at your own address.
      </p>
    </div>
  );

  if (profileQuery.isPending) {
    return (
      <section className="max-w-3xl space-y-6">
        {heading}
        <div className="py-12">
          <LoadingState label="Loading your profile…" size="page" />
        </div>
      </section>
    );
  }
  if (profileQuery.isError) {
    return (
      <section className="max-w-3xl space-y-6">
        {heading}
        <ErrorAlert
          type="error"
          header="Couldn't load your profile"
          onRetry={() => void profileQuery.refetch()}
        >
          {apiErrorMessage(profileQuery.error)}
        </ErrorAlert>
      </section>
    );
  }
  return (
    <ProfileForm
      key={generation}
      heading={heading}
      profile={profileQuery.data}
      saved={saved}
      onSaved={setSaved}
      reload={async () => {
        await profileQuery.refetch();
        setSaved(false);
        setGeneration((n) => n + 1);
      }}
    />
  );
}

function ProfileForm({
  heading,
  profile,
  saved,
  onSaved,
  reload,
}: {
  heading: React.ReactNode;
  profile: ProfileData;
  saved: boolean;
  onSaved: (saved: boolean) => void;
  reload: () => Promise<void>;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const { portals } = useRuntimeConfig();
  const photoUrl = usePublicMediaUrl()(profile.photoKey);
  const update = useMutation(trpc.profile.update.mutationOptions());
  const createPhotoUploadUrl = useMutation(
    trpc.profile.createPhotoUploadUrl.mutationOptions(),
  );
  const updatePhoto = useMutation(trpc.profile.updatePhoto.mutationOptions());
  const [handleError, setHandleError] = useState<string>();
  const isNew = profile.version === 0;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.profile.get.queryKey() });

  const form = useForm({
    defaultValues: {
      displayName: profile.displayName,
      handle: profile.handle,
      headline: profile.headline ?? '',
      bio: profile.bio ?? '',
    },
    validators: { onChange: profileFormSchema },
    onSubmit: async ({ value }) => {
      setHandleError(undefined);
      onSaved(false);
      try {
        await update.mutateAsync({
          version: profile.version,
          displayName: value.displayName.trim(),
          handle: value.handle.trim().toLowerCase(),
          headline: value.headline.trim() || undefined,
          bio: value.bio.trim() || undefined,
        });
        onSaved(true);
        await refresh();
      } catch (error) {
        // A message about the handle shows on the field it concerns; the
        // rest (a changed profile, an outage) above the form.
        const message = apiErrorMessage(error);
        if (message !== PROFILE_CHANGED && /handle/i.test(message)) {
          setHandleError(message);
        }
      }
    },
  });

  const addressBase = portals?.StudentPortal ?? '';
  const publicPath = (handle: string) => `/instructors/${handle}`;

  return (
    <section className="max-w-3xl space-y-6">
      {heading}

      <p className="text-sm" data-testid="profile-status">
        {profile.isPublic ? (
          <>
            Your profile is public:{' '}
            <a
              href={`${addressBase}${publicPath(profile.handle)}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              view it
            </a>
          </>
        ) : (
          'Your profile becomes public when one of your courses is published'
        )}
      </p>

      <div className="flex items-center gap-4">
        <Avatar size="lg" className="size-20">
          {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
          <AvatarFallback aria-hidden="true" className="text-xl">
            {initialsOf(profile.displayName)}
          </AvatarFallback>
        </Avatar>
        {isNew ? (
          <p className="text-sm text-muted-foreground">
            Save your profile to add a photo.
          </p>
        ) : (
          <ImageCropDialog
            title="Profile photo"
            description="Shown beside your name. Drag and zoom to choose the square area to use."
            fileLabel="Profile photo file"
            errorHeader="Couldn't save the photo"
            aspect={1}
            output={PROFILE_PHOTO_SIZE}
            current={
              photoUrl ? (
                <img
                  src={photoUrl}
                  alt=""
                  width={160}
                  height={160}
                  className="mx-auto size-40 rounded-full border object-cover"
                />
              ) : undefined
            }
            removeLabel="Remove photo"
            trigger={
              <Button type="button" variant="outline" size="sm">
                {photoUrl ? 'Change photo' : 'Add photo'}
              </Button>
            }
            onSave={async (image) => {
              const { uploadUrl, photoKey, headers } =
                await createPhotoUploadUrl.mutateAsync({
                  contentLength: image.size,
                });
              // The upload URL was signed for exactly these headers and this size.
              const response = await fetch(uploadUrl, {
                method: 'PUT',
                headers,
                body: image,
              });
              if (!response.ok) {
                throw new Error("Couldn't upload the photo. Please try again.");
              }
              await updatePhoto.mutateAsync({ photoKey });
              await refresh();
            }}
            onRemove={async () => {
              await updatePhoto.mutateAsync({ photoKey: null });
              await refresh();
            }}
          />
        )}
      </div>

      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {update.isError && !handleError && (
          <ErrorAlert type="error" header="Couldn't save your profile">
            <p>{apiErrorMessage(update.error)}</p>
            {apiErrorMessage(update.error) === PROFILE_CHANGED && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={reload}
              >
                Reload
              </Button>
            )}
          </ErrorAlert>
        )}
        <StatusMessage message={saved ? 'Profile saved.' : null} />

        <form.Field name="displayName">
          {(field) => {
            const error = field.state.meta.errors[0];
            return (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Display name</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={Boolean(error)}
                />
                {error ? (
                  <p className="text-xs text-destructive">{error.message}</p>
                ) : null}
              </div>
            );
          }}
        </form.Field>

        <form.Field name="handle">
          {(field) => {
            const error = field.state.meta.errors[0]?.message ?? handleError;
            const shown = field.state.value.trim().toLowerCase();
            return (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Handle</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    setHandleError(undefined);
                    field.handleChange(event.target.value);
                  }}
                  aria-invalid={Boolean(error)}
                  aria-describedby="handle-address"
                />
                <p
                  id="handle-address"
                  className="text-xs text-muted-foreground"
                >
                  Your address: {publicPath(shown)}
                </p>
                {error ? (
                  <p className="text-xs text-destructive">{error}</p>
                ) : null}
              </div>
            );
          }}
        </form.Field>

        <form.Field name="headline">
          {(field) => {
            const error = field.state.meta.errors[0];
            return (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Headline</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="e.g. Professor of mathematics"
                  aria-invalid={Boolean(error)}
                />
                <p
                  className={`text-right text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {error
                    ? error.message
                    : `${field.state.value.length} / 100 characters`}
                </p>
              </div>
            );
          }}
        </form.Field>

        <form.Field name="bio">
          {(field) => {
            const error = field.state.meta.errors[0];
            return (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Bio</Label>
                <Textarea
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="min-h-40 resize-y"
                  placeholder="Tell students about yourself. A blank line starts a new paragraph."
                  aria-invalid={Boolean(error)}
                />
                <p
                  className={`text-right text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {error
                    ? error.message
                    : `${field.state.value.length} / 2000 characters`}
                </p>
              </div>
            );
          }}
        </form.Field>

        <div className="flex justify-end border-t pt-4">
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting]}
          >
            {([canSubmit, isSubmitting]) => (
              <PendingButton
                type="submit"
                pending={isSubmitting}
                pendingLabel="Saving…"
                // canSubmit is false while submitting too; only a form that
                // can't be sent disables Save, so focus stays on it.
                disabled={!canSubmit && !isSubmitting}
              >
                Save
              </PendingButton>
            )}
          </form.Subscribe>
        </div>
      </form>
    </section>
  );
}
