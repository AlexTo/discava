/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  PUBLIC_MEDIA_URL,
  renderWithInstructorApi,
} from '../../test/render-with-instructor-api';
import { Route } from './profile';

const ProfilePage = Route.options.component!;

const AREA = { x: 0, y: 0, width: 800, height: 800 };
const CROPPED = new Blob(['x'.repeat(321)], { type: 'image/jpeg' });
vi.mock('react-easy-crop', () => ({
  default: ({
    onCropComplete,
  }: {
    onCropComplete: (area: unknown, pixels: unknown) => void;
  }) => {
    useEffect(() => onCropComplete(AREA, AREA), [onCropComplete]);
    return <div data-testid="cropper" />;
  },
}));
const cropToJpeg = vi.hoisted(() => vi.fn());
vi.mock('../../lib/crop-to-jpeg', async (importActual) => ({
  ...(await importActual<typeof import('../../lib/crop-to-jpeg')>()),
  cropToJpeg,
}));

const s3Put = vi.fn();
beforeEach(() => {
  cropToJpeg.mockResolvedValue(CROPPED);
  s3Put.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', s3Put);
  URL.createObjectURL = vi.fn(() => 'blob:picked');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const profile = {
  handle: 'alex-to',
  displayName: 'Alex To',
  headline: 'Teacher',
  bio: 'Hello',
  version: 2,
  isPublic: true,
};

const open = (handlers: Record<string, Handler> = {}) =>
  renderWithInstructorApi(<ProfilePage />, {
    handlers: { 'profile.get': () => profile, ...handlers },
  });

const field = (name: string) => screen.findByLabelText(name);

describe('profile editor', () => {
  it('sets the title and keeps one h1 while loading and on failure', async () => {
    const { unmount } = open({ 'profile.get': () => new Promise(() => {}) });
    expect(document.title).toBe('Profile · Discava');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Loading your profile…')).toBeVisible();
    unmount();

    open({
      'profile.get': () => {
        throw new Error('boom');
      },
    });
    expect(await screen.findByText("Couldn't load your profile")).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows the saved profile and the public status', async () => {
    open();

    expect(await field('Display name')).toHaveValue('Alex To');
    expect(screen.getByLabelText('Handle')).toHaveValue('alex-to');
    expect(screen.getByLabelText('Headline')).toHaveValue('Teacher');
    expect(screen.getByLabelText('Bio')).toHaveValue('Hello');
    expect(screen.getByTestId('profile-status')).toHaveTextContent(
      'Your profile is public',
    );
    expect(screen.getByRole('link', { name: 'view it' })).toHaveAttribute(
      'href',
      expect.stringContaining('/instructors/alex-to'),
    );
  });

  it('says when the profile is not public yet', async () => {
    open({ 'profile.get': () => ({ ...profile, isPublic: false }) });

    await field('Display name');
    expect(screen.getByTestId('profile-status')).toHaveTextContent(
      'Your profile becomes public when one of your courses is published',
    );
    expect(screen.queryByRole('link', { name: 'view it' })).toBeNull();
  });

  it('shows the address for the handle as it is typed', async () => {
    const { user } = open();
    const handle = await field('Handle');

    expect(
      screen.getByText('Your address: /instructors/alex-to'),
    ).toBeVisible();
    await user.clear(handle);
    await user.type(handle, 'Alex-Two');
    expect(
      screen.getByText('Your address: /instructors/alex-two'),
    ).toBeVisible();
  });

  it('saves the fields with the version it read', async () => {
    const { calls, user } = open({
      'profile.update': () => ({ ...profile, version: 3 }),
    });
    const name = await field('Display name');
    await user.clear(name);
    await user.type(name, 'Dr Alex');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(calls.find(({ path }) => path === 'profile.update')).toBeDefined(),
    );
    expect(calls.find(({ path }) => path === 'profile.update')?.input).toEqual({
      version: 2,
      displayName: 'Dr Alex',
      handle: 'alex-to',
      headline: 'Teacher',
      bio: 'Hello',
    });
    expect(await screen.findByText('Profile saved.')).toBeVisible();
  });

  it('keeps unsaved edits when the photo changes, and saves with the new version', async () => {
    let version = 2;
    const { calls, user } = open({
      'profile.get': () => ({ ...profile, version }),
      'profile.createPhotoUploadUrl': () => ({
        uploadUrl: 'https://bucket.s3.test/upload',
        photoKey: 'instructors/i1/new.jpg',
        headers: {},
      }),
      'profile.updatePhoto': () => {
        version = 3;
        return { ...profile, version };
      },
      'profile.update': () => ({ ...profile, version: 4 }),
    });
    await field('Display name');
    await user.type(screen.getByLabelText('Bio'), ' unsaved');

    await user.click(screen.getByRole('button', { name: 'Add photo' }));
    await user.upload(
      screen.getByLabelText('Profile photo file'),
      new File(['png'], 'me.png', { type: 'image/png' }),
    );
    await screen.findByTestId('cropper');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        calls.filter(({ path }) => path === 'profile.get').length,
      ).toBeGreaterThan(1),
    );

    expect(screen.getByLabelText('Bio')).toHaveValue('Hello unsaved');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find(({ path }) => path === 'profile.update')).toBeDefined(),
    );
    expect(
      calls.find(({ path }) => path === 'profile.update')?.input,
    ).toMatchObject({ version: 3, bio: 'Hello unsaved' });
  });

  it('keeps Save focusable while saving', async () => {
    const { user } = open({ 'profile.update': () => new Promise(() => {}) });
    await field('Display name');
    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);

    await waitFor(() => expect(save).toHaveTextContent('Saving…'));
    expect(save).not.toBeDisabled();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).toHaveFocus();
  });

  it('keeps "Profile saved." once the refetch brings the new version', async () => {
    let saved = false;
    const { user } = open({
      'profile.get': () => ({ ...profile, version: saved ? 3 : 2 }),
      'profile.update': () => {
        saved = true;
        return { ...profile, version: 3 };
      },
    });
    await field('Display name');
    await user.type(screen.getByLabelText('Bio'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Profile saved.')).toBeVisible();
    expect(screen.getByText('Profile saved.')).toBeVisible();
  });

  it('shows validation errors inline and does not save', async () => {
    const { calls, user } = open();
    const handle = await field('Handle');
    await user.clear(handle);
    await user.type(handle, 'a--b');

    expect(
      await screen.findByText(
        'Use lower-case letters, numbers and single hyphens',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(calls.some(({ path }) => path === 'profile.update')).toBe(false);
  });

  it('on Save with a problem, focuses the first invalid field and ties its error to it', async () => {
    const { calls, user } = open();
    const handle = await field('Handle');
    await user.clear(handle);
    await user.type(handle, 'a--b');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(handle).toHaveFocus());
    expect(handle).toBeInvalid();
    expect(handle).toHaveAccessibleDescription(
      /Your address: .*Use lower-case letters, numbers and single hyphens/,
    );
    expect(calls.some(({ path }) => path === 'profile.update')).toBe(false);
  });

  it('shows "That handle is taken" on the handle field', async () => {
    const { user } = open({
      'profile.update': () => {
        throw new ApiError('CONFLICT', 'That handle is taken');
      },
    });
    const handle = await field('Handle');
    await user.clear(handle);
    await user.type(handle, 'taken-one');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const message = await screen.findByText('That handle is taken');
    expect(message).toBeVisible();
    expect(handle).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText("Couldn't save your profile")).toBeNull();
  });

  it('offers a reload when the profile changed elsewhere', async () => {
    const { calls, user } = open({
      'profile.update': () => {
        throw new ApiError(
          'CONFLICT',
          'Your profile changed; reload and try again',
        );
      },
    });
    await field('Display name');
    await user.type(screen.getByLabelText('Bio'), ' there');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Couldn't save your profile")).toBeVisible();
    const before = calls.filter(({ path }) => path === 'profile.get').length;
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(
        calls.filter(({ path }) => path === 'profile.get').length,
      ).toBeGreaterThan(before),
    );
  });

  it('asks a new instructor to save before adding a photo', async () => {
    open({
      'profile.get': () => ({
        handle: 'alex-to',
        displayName: 'Alex To',
        version: 0,
        isPublic: false,
      }),
    });

    await field('Display name');
    expect(screen.getByText('Save your profile to add a photo.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
  });

  it('crops a photo to 512 by 512, uploads it as signed and saves it', async () => {
    const { calls, user } = open({
      'profile.createPhotoUploadUrl': () => ({
        uploadUrl: 'https://bucket.s3.test/upload',
        photoKey: 'instructors/i1/new.jpg',
        headers: { 'Content-Type': 'image/jpeg' },
      }),
      'profile.updatePhoto': () => ({ ...profile, version: 3 }),
    });
    await field('Display name');

    await user.click(screen.getByRole('button', { name: 'Add photo' }));
    await user.upload(
      screen.getByLabelText('Profile photo file'),
      new File(['png'], 'me.png', { type: 'image/png' }),
    );
    await screen.findByTestId('cropper');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(cropToJpeg).toHaveBeenCalledWith('blob:picked', AREA, {
      width: 512,
      height: 512,
    });
    expect(s3Put).toHaveBeenCalledWith('https://bucket.s3.test/upload', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: CROPPED,
    });
    expect(
      calls
        .filter(
          ({ path }) => path.startsWith('profile.') && path !== 'profile.get',
        )
        .map(({ path, input }) => [path, input]),
    ).toEqual([
      ['profile.createPhotoUploadUrl', { contentLength: 321 }],
      ['profile.updatePhoto', { photoKey: 'instructors/i1/new.jpg' }],
    ]);
  });

  it('shows the current photo and removes it', async () => {
    const { calls, user } = open({
      'profile.get': () => ({
        ...profile,
        photoKey: 'instructors/i1/old.jpg',
      }),
      'profile.updatePhoto': () => ({ ...profile, version: 3 }),
    });
    await field('Display name');

    await user.click(screen.getByRole('button', { name: 'Change photo' }));
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
      'src',
      `${PUBLIC_MEDIA_URL}instructors/i1/old.jpg`,
    );
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));

    await waitFor(() =>
      expect(
        calls.find(({ path }) => path === 'profile.updatePhoto')?.input,
      ).toEqual({ photoKey: null }),
    );
  });

  it('offers a retry when the profile cannot be loaded', async () => {
    open({
      'profile.get': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Boom');
      },
    });
    expect(
      await screen.findByText("Couldn't load your profile", undefined, {
        timeout: 10_000,
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
