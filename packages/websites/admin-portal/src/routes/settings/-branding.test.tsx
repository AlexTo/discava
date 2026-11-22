/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithAdminApi,
} from '../../test/render-with-admin-api';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, { useBlocker: () => undefined });
});

const { measureImage } = vi.hoisted(() => ({ measureImage: vi.fn() }));
vi.mock('./-components/measure-image', () => ({ measureImage }));

import { Route } from './branding';

const BrandingSettings = Route.options.component!;

const NONCE = '0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12';
const none = {
  brand: {
    name: null,
    showNameBesideLogo: true,
    colour: null,
    logoKey: null,
    iconKey: null,
    shareImageKey: null,
  },
  revision: 0,
  changed: null,
};

const upload: Handler = (input) => {
  const { kind, contentType } = input as { kind: string; contentType: string };
  const ext = contentType === 'image/svg+xml' ? 'svg' : 'png';
  return {
    key: `brand/${kind}/${NONCE}.${ext}`,
    uploadUrl: 'https://upload.test/put',
    headers: { 'Content-Type': contentType },
  };
};

const open = (handlers: Record<string, Handler> = {}) =>
  renderWithAdminApi(<BrandingSettings />, {
    handlers: {
      'branding.get': () => none,
      'branding.createUploadUrl': upload,
      ...handlers,
    },
  });

const file = (name: string, type: string, size = 1000) =>
  new File([new Uint8Array(size)], name, { type });

const choose = (label: string, chosen: File) =>
  fireEvent.change(screen.getByLabelText(label), {
    target: { files: [chosen] },
  });

let put: ReturnType<typeof vi.fn>;
beforeEach(() => {
  put = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', put);
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  measureImage.mockReset();
  measureImage.mockResolvedValue({ width: 400, height: 100 });
});

describe('the Branding page', () => {
  it('shows the default brand, with Save disabled until something changes', async () => {
    open();
    expect(
      await screen.findByText('Using the default Discava brand'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Branding' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Discava logo' }),
    ).toBeInTheDocument();
  });

  it('says who last changed it', async () => {
    open({
      'branding.get': () => ({
        ...none,
        revision: 2,
        changed: {
          by: 'a',
          byName: 'Carol Admin',
          at: new Date().toISOString(),
        },
      }),
    });
    expect(
      await screen.findByText(/Last changed by Carol Admin, /),
    ).toBeInTheDocument();
  });

  it('refuses a file of the wrong type, without uploading it', async () => {
    const { calls } = open();
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('logo.gif', 'image/gif'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /PNG, JPEG, WebP or SVG/,
    );
    expect(calls.some((c) => c.path === 'branding.createUploadUrl')).toBe(
      false,
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses a file over the size limit', async () => {
    const { calls } = open();
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('big.png', 'image/png', 1024 * 1024 + 1));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too large/);
    expect(calls.some((c) => c.path === 'branding.createUploadUrl')).toBe(
      false,
    );
  });

  it('refuses a logo that is too wide, naming its size', async () => {
    measureImage.mockResolvedValue({ width: 420, height: 100 });
    const { calls } = open();
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('wide.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /420 × 100.*width ÷ height from 1 to 4/,
    );
    expect(calls.some((c) => c.path === 'branding.createUploadUrl')).toBe(
      false,
    );
  });

  it('refuses a non-square icon and a small one', async () => {
    open();
    await screen.findByLabelText('Upload icon');
    measureImage.mockResolvedValue({ width: 512, height: 256 });
    choose('Upload icon', file('icon.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong shape/);
    measureImage.mockResolvedValue({ width: 191, height: 191 });
    choose('Upload icon', file('icon.png', 'image/png'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/too small/),
    );
  });

  it('uploads a valid logo, puts it with the signed headers, and previews it', async () => {
    const { calls } = open();
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('logo.png', 'image/png', 1234));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith(
      'https://upload.test/put',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    expect(
      calls.find((c) => c.path === 'branding.createUploadUrl')?.input,
    ).toEqual({ kind: 'logo', contentType: 'image/png', contentLength: 1234 });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('img', { name: 'Discava logo' })
          .every((img) => img.getAttribute('src') === 'blob:preview'),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('refuses a blank or 51-character name, with its message, and disables Save', async () => {
    const { user } = open();
    const input = await screen.findByLabelText('Name');
    expect(input).toHaveValue('Discava');
    await user.clear(input);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The name must be 1–50 characters.',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(input, 'x'.repeat(51));
    expect(screen.getByRole('alert')).toHaveTextContent('1–50 characters');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'Acme Academy');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('hides the name in the preview header only when the switch is off', async () => {
    const { user } = open();
    const input = await screen.findByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Acme Academy');
    const header = () =>
      screen.getByRole('img', { name: 'Acme Academy logo' }).parentElement!;
    expect(header()).toHaveTextContent('Acme Academy');
    await user.click(screen.getByLabelText('Show the name beside the logo'));
    expect(header()).not.toHaveTextContent('Acme Academy');
    // The share preview still names the platform.
    expect(screen.getByText(/A page title · Acme Academy/)).toBeInTheDocument();
  });

  it('refuses a share image under 1200 × 630, without uploading it', async () => {
    measureImage.mockResolvedValue({ width: 1000, height: 524 });
    const { calls } = open();
    await screen.findByLabelText('Upload share image');
    choose('Upload share image', file('share.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /1000 × 524.*too small/,
    );
    expect(calls.some((c) => c.path === 'branding.createUploadUrl')).toBe(
      false,
    );
  });

  it('uploads a share image, previews it, and saves its key with the name', async () => {
    measureImage.mockResolvedValue({ width: 1200, height: 630 });
    const { calls, user } = open({
      'branding.save': (input) => ({ ...none, brand: input, revision: 1 }),
    });
    await screen.findByLabelText('Upload share image');
    choose('Upload share image', file('share.png', 'image/png', 5000));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(
      calls.find((c) => c.path === 'branding.createUploadUrl')?.input,
    ).toEqual({
      kind: 'share-image',
      contentType: 'image/png',
      contentLength: 5000,
    });
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'Share image preview' }),
      ).toHaveAttribute('src', 'blob:preview'),
    );
    const input = screen.getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Acme Academy');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === 'branding.save')?.input).toEqual({
        expectedRevision: 0,
        name: 'Acme Academy',
        showNameBesideLogo: true,
        colour: null,
        logoKey: null,
        iconKey: null,
        shareImageKey: `brand/share-image/${NONCE}.png`,
      }),
    );
  });

  it('resets the share image and the name to the default in the form', async () => {
    const { user } = open({
      'branding.get': () => ({
        ...none,
        brand: {
          ...none.brand,
          name: 'Acme',
          shareImageKey: `brand/share-image/${NONCE}.png`,
        },
        revision: 3,
      }),
    });
    await screen.findByLabelText('Upload share image');
    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(
      screen.queryByRole('img', { name: 'Share image preview' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Reset name to default' }),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Discava');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('shows an error when the upload itself fails', async () => {
    put.mockResolvedValue(new Response(null, { status: 403 }));
    open();
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('logo.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Couldn't upload the file/,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves the whole form with the loaded revision, then confirms', async () => {
    const saved = {
      ...none,
      brand: { ...none.brand, logoKey: `brand/logo/${NONCE}.png` },
      revision: 5,
      changed: { by: 'a', byName: 'Carol Admin', at: new Date().toISOString() },
    };
    const { calls, user } = open({
      'branding.get': () => ({
        ...none,
        brand: { ...none.brand, name: 'Acme', colour: '#1d4ed8' },
        revision: 4,
      }),
      'branding.save': () => saved,
    });
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('logo.png', 'image/png'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(calls.find((c) => c.path === 'branding.save')?.input).toEqual({
        expectedRevision: 4,
        name: 'Acme',
        showNameBesideLogo: true,
        colour: '#1d4ed8',
        logoKey: `brand/logo/${NONCE}.png`,
        iconKey: null,
        shareImageKey: null,
      }),
    );
    expect(
      await screen.findByText(
        'Branding saved. Visitors see it within 5 minutes.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the edits and offers to reload on a conflict', async () => {
    const { user, calls } = open({
      'branding.save': () => {
        throw new ApiError(
          'CONFLICT',
          'Someone else changed the branding. Reload to see their changes.',
        );
      },
    });
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('logo.png', 'image/png'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Someone else changed the branding');
    // The admin's logo is still in the preview.
    expect(
      screen
        .getAllByRole('img', { name: 'Discava logo' })
        .some((img) => img.getAttribute('src') === 'blob:preview'),
    ).toBe(true);

    const before = calls.filter((c) => c.path === 'branding.get').length;
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === 'branding.get').length).toBe(
        before + 1,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText('Reload')).not.toBeInTheDocument(),
    );
  });

  it('shows the server’s message for an image beside that image', async () => {
    const { user } = open({
      'branding.save': () => {
        throw new ApiError(
          'BAD_REQUEST',
          "The logo can't contain a <script> element.",
        );
      },
    });
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('logo.svg', 'image/svg+xml'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const message = await screen.findByText(/can't contain a <script>/);
    expect(message.closest('section')).toHaveTextContent('Logo');
  });

  it('offers to try again when the brand cannot be loaded', async () => {
    open({
      'branding.get': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'Down');
      },
    });
    expect(
      await screen.findByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });
});
