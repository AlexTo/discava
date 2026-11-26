/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithAdminApi,
} from '../../test/render-with-admin-api';

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
  it('shows the default brand, with Save enabled', async () => {
    open();
    expect(
      await screen.findByText('Using the default Discava brand'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Branding' }),
    ).toBeInTheDocument();
  });

  it('says there is nothing to save, and sends nothing, when nothing changed', async () => {
    const { user, calls } = open();
    await screen.findByText('Using the default Discava brand');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Nothing to save: the branding is as saved.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === 'branding.save')).toBe(false);
    expect(
      screen.getByRole('img', { name: 'Discava logo' }),
    ).toBeInTheDocument();
  });

  it('stops saying there is nothing to save once something is edited', async () => {
    const { user } = open();
    await screen.findByText('Using the default Discava brand');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Nothing to save: the branding is as saved.');

    await user.type(screen.getByLabelText('Name'), 'x');

    expect(
      screen.queryByText('Nothing to save: the branding is as saved.'),
    ).not.toBeInTheDocument();
  });

  it('says who last changed it', async () => {
    open({
      'branding.get': () => ({
        ...none,
        brand: { ...none.brand, name: 'Acme' },
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
    expect(
      screen.queryByText(/Using the default Discava brand/),
    ).not.toBeInTheDocument();
  });

  it('says both that the brand is the default and who last changed it, once reset and saved', async () => {
    open({
      'branding.get': () => ({
        ...none,
        revision: 6,
        changed: {
          by: 'a',
          byName: 'Carol Admin',
          at: new Date().toISOString(),
        },
      }),
    });
    expect(
      await screen.findByText(
        /^Using the default Discava brand · Last changed by Carol Admin, /,
      ),
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

  it('holds Save while an image uploads, then saves with the image', async () => {
    let finish!: (response: Response) => void;
    put.mockImplementation(
      () => new Promise<Response>((resolve) => (finish = resolve)),
    );
    const { calls, user } = open({ 'branding.save': () => none });
    await screen.findByLabelText('Upload logo');
    choose('Upload logo', file('logo.png', 'image/png'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    await user.type(screen.getByLabelText('Name'), 'Acme');

    const waiting = await screen.findByRole('button', {
      name: 'Wait for the upload to finish…',
    });
    expect(waiting).toHaveAttribute('aria-disabled', 'true');
    await user.click(waiting);
    expect(calls.some((c) => c.path === 'branding.save')).toBe(false);

    finish(new Response(null, { status: 200 }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.path === 'branding.save')?.input,
      ).toMatchObject({ logoKey: `brand/logo/${NONCE}.png` }),
    );
  });

  it('refuses a blank or 51-character name, with its message, and focuses it on Save', async () => {
    const { user } = open();
    const input = await screen.findByLabelText('Name');
    expect(input).toHaveValue('Discava');
    await user.clear(input);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The name must be 1–50 characters.',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/1–50 characters/);
    await user.type(input, 'x'.repeat(51));
    expect(screen.getByRole('alert')).toHaveTextContent('1–50 characters');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
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
    await user.click(
      within(screen.getByRole('region', { name: 'Share image' })).getByRole(
        'button',
        { name: 'Reset the share image to default' },
      ),
    );
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
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it("guards leaving with the portal's own dialog, never window.confirm", async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const root = createRootRoute({
      component: () => (
        <>
          <Link to="/other">Other page</Link>
          <Outlet />
        </>
      ),
    });
    const branding = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: BrandingSettings,
    });
    const other = createRoute({
      getParentRoute: () => root,
      path: '/other',
      component: () => <h1>Other</h1>,
    });
    const router = createRouter({
      routeTree: root.addChildren([branding, other]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const { user } = renderWithAdminApi(<RouterProvider router={router} />, {
      handlers: { 'branding.get': () => none },
    });
    await user.type(await screen.findByLabelText('Name'), 'Acme');

    await user.click(screen.getByRole('link', { name: 'Other page' }));

    expect(
      await screen.findByText('Leave without saving?'),
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/');

    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(
      await screen.findByRole('heading', { name: 'Other' }),
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
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
      (
        await screen.findAllByText(
          'Branding saved. Visitors see it within 5 minutes.',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
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

  describe('resetting to the default', () => {
    const custom = {
      ...none,
      brand: {
        name: 'Acme',
        showNameBesideLogo: false,
        colour: '#1d4ed8',
        logoKey: `brand/logo/${NONCE}.png`,
        iconKey: `brand/icon/${NONCE}.png`,
        shareImageKey: `brand/share-image/${NONCE}.png`,
      },
      revision: 4,
      changed: { by: 'a', byName: 'Carol Admin', at: new Date().toISOString() },
    };
    const saveHandler: Handler = (input) => ({
      ...none,
      brand: input as typeof none.brand,
      revision: 5,
    });

    it('resets the logo only, sending logoKey null and keeping the colour', async () => {
      const { calls, user } = open({
        'branding.get': () => custom,
        'branding.save': saveHandler,
      });
      await screen.findByLabelText('Upload logo');
      await user.click(
        within(screen.getByRole('region', { name: 'Logo' })).getByRole(
          'button',
          { name: 'Reset the logo to default' },
        ),
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(calls.find((c) => c.path === 'branding.save')?.input).toEqual({
          expectedRevision: 4,
          ...custom.brand,
          logoKey: null,
        }),
      );
    });

    it('asks before resetting all, then sends every field null and the switch on', async () => {
      const { calls, user } = open({
        'branding.get': () => custom,
        'branding.save': saveHandler,
      });
      await screen.findByLabelText('Upload logo');
      await user.click(
        screen.getByRole('button', { name: 'Reset all to default' }),
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Reset all' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(calls.find((c) => c.path === 'branding.save')?.input).toEqual({
          expectedRevision: 4,
          name: null,
          showNameBesideLogo: true,
          colour: null,
          logoKey: null,
          iconKey: null,
          shareImageKey: null,
        }),
      );
    });

    it('changes nothing when the reset all is cancelled', async () => {
      const { user } = open({ 'branding.get': () => custom });
      await screen.findByLabelText('Upload logo');
      await user.click(
        screen.getByRole('button', { name: 'Reset all to default' }),
      );
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('Acme');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  describe('the brand colour', () => {
    const hex = () => screen.getByLabelText('Hex colour');

    it('refuses #777777 with the message, and focuses it on Save', async () => {
      open();
      await screen.findByLabelText('Hex colour');
      fireEvent.change(hex(), { target: { value: '#777777' } });
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Text on this colour would be hard to read. Choose a darker or lighter shade.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(hex()).toHaveFocus();
      expect(hex()).toHaveAttribute('aria-invalid', 'true');
      fireEvent.change(hex(), { target: { value: '#1d4ed8' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('previews #1d4ed8 with light text and its contrast ratio, in the preview only', async () => {
      open();
      await screen.findByLabelText('Hex colour');
      fireEvent.change(hex(), { target: { value: '#1d4ed8' } });
      expect(screen.getByText(/Text colour: light/)).toHaveTextContent(
        /contrast 6\.\d:1/,
      );
      const preview = screen.getByTestId('brand-preview');
      expect(preview.style.getPropertyValue('--primary')).toBe('#1d4ed8');
      expect(preview.style.getPropertyValue('--primary-foreground')).toBe(
        '#fafafa',
      );
      // The page outside the preview keeps its colours until Save.
      expect(document.documentElement.style.getPropertyValue('--primary')).toBe(
        '',
      );
    });

    it('previews the default, not the saved colour, after a reset or a refused colour', async () => {
      open({
        'branding.get': () => ({
          ...none,
          brand: { ...none.brand, colour: '#1d4ed8' },
          revision: 1,
        }),
      });
      await screen.findByLabelText('Hex colour');
      // What the portal has applied to the page for the saved brand.
      document.documentElement.style.setProperty('--primary', '#1d4ed8');
      const preview = screen.getByTestId('brand-preview');
      expect(preview.style.getPropertyValue('--primary')).toBe('#1d4ed8');
      fireEvent.click(
        screen.getByRole('button', { name: 'Reset colour to default' }),
      );
      expect(preview.style.getPropertyValue('--primary')).toBe(
        'oklch(0.205 0 0)',
      );
      fireEvent.change(hex(), { target: { value: '#1d4ed8' } });
      fireEvent.change(hex(), { target: { value: '#777777' } });
      expect(preview.style.getPropertyValue('--primary')).toBe(
        'oklch(0.205 0 0)',
      );
      document.documentElement.style.removeProperty('--primary');
    });

    it('sends the colour on Save, and null after a reset', async () => {
      const { calls } = open({
        'branding.save': (input) => ({
          ...none,
          brand: input,
          revision: 1,
        }),
      });
      await screen.findByLabelText('Hex colour');
      fireEvent.change(hex(), { target: { value: '#1D4ED8' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(
          (
            calls.find((c) => c.path === 'branding.save')?.input as {
              colour: string;
            }
          ).colour,
        ).toBe('#1d4ed8'),
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Reset colour to default' }),
      );
      expect(hex()).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });
});

describe('the Branding page, as a page', () => {
  it('names the tab and says it is loading the branding', () => {
    open({ 'branding.get': () => new Promise(() => {}) });

    expect(document.title).toBe('Branding · Settings · Discava');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Branding' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('status').map((status) => status.textContent),
    ).toContain('Loading the branding…');
  });
});

describe('the Branding page, with the keyboard', () => {
  it('returns focus to Reset all to default when its confirmation is dismissed', async () => {
    const { user } = open();
    await screen.findByLabelText('Upload logo');
    const resetAll = screen.getByRole('button', {
      name: 'Reset all to default',
    });
    await user.click(resetAll);
    await screen.findByRole('alertdialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(resetAll).toHaveFocus());
  });

  it('announces a save once, in the status region', async () => {
    const { user } = open({
      'branding.save': (input) => ({ ...none, brand: input, revision: 1 }),
    });
    await user.type(await screen.findByLabelText('Name'), ' Academy');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        screen.getAllByRole('status').map((status) => status.textContent),
      ).toContain('Branding saved. Visitors see it within 5 minutes.'),
    );
    // The visible alert is not a second announcement.
    expect(screen.queryByRole('status', { name: /saved/i })).toBeNull();
    expect(
      screen
        .getAllByRole('status')
        .filter((status) => /Branding saved/.test(status.textContent ?? '')),
    ).toHaveLength(1);
  });

  it('keeps focus on a pending Save and sends nothing on a second press', async () => {
    const { user, calls } = open({
      'branding.save': () => new Promise(() => {}),
    });
    await user.type(await screen.findByLabelText('Name'), ' Academy');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const pending = await screen.findByRole('button', { name: 'Saving…' });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    pending.focus();
    await user.click(pending);
    expect(pending).toHaveFocus();
    expect(calls.filter((c) => c.path === 'branding.save')).toHaveLength(1);
  });

  it('keeps focus on the logo reset button while an upload runs', async () => {
    const { user } = open({
      'branding.get': () => ({
        ...none,
        brand: { ...none.brand, logoKey: `brand/logo/${NONCE}.png` },
        revision: 1,
      }),
    });
    await screen.findByLabelText('Upload logo');
    put.mockReturnValue(new Promise(() => {}));
    const reset = within(
      screen.getByRole('region', { name: 'Logo' }),
    ).getByRole('button', { name: 'Reset the logo to default' });
    reset.focus();
    choose('Upload logo', file('logo.png', 'image/png'));

    await waitFor(() => expect(reset).toHaveAttribute('aria-disabled', 'true'));
    expect(reset).not.toBeDisabled();
    expect(reset).toHaveFocus();
    await user.click(reset);
    expect(reset).toHaveFocus();
  });
});
