/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { BrandConflictError } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { createBrandUploadUrl, getBranding, saveBranding } from './branding.js';

const {
  getBrand,
  saveBrand,
  inspectBrandImage,
  presignPublicMediaUpload,
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
  userGet,
  mockModule,
} = await vi.hoisted(async () => ({
  getBrand: vi.fn(),
  saveBrand: vi.fn(),
  inspectBrandImage: vi.fn(),
  presignPublicMediaUpload: vi.fn(),
  attachPublicMediaObject: vi.fn(),
  bestEffortDetachPublicMediaObject: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    user: ['get'],
  }),
}));

vi.mock('@discava/core-table', async (importActual) =>
  mockModule(await importActual(), { getBrand, saveBrand }),
);
vi.mock('../helpers/brand-image.js', () => ({ inspectBrandImage }));
vi.mock('@discava/common-server-utils/public-media', () => ({
  presignPublicMediaUpload,
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
}));

const router = t.router({
  get: getBranding,
  createUploadUrl: createBrandUploadUrl,
  save: saveBranding,
});

const callAs = (groups: string[] = ['admin']) =>
  callerFor(router, { sub: 'admin-1', groups });

const NONCE = '0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12';
const OLD = '0193a5c8-0000-7a3c-9d2f-1e4b6c8a0f12';
const NEW_LOGO = `brand/logo/${NONCE}.svg`;
const OLD_LOGO = `brand/logo/${OLD}.png`;

const input = {
  expectedRevision: 0,
  name: null,
  showNameBesideLogo: true,
  colour: null,
  logoKey: null,
  iconKey: null,
  shareImageKey: null,
};

const stored = {
  name: 'Acme',
  showNameBesideLogo: true,
  colour: null,
  logoKey: OLD_LOGO,
  iconKey: null,
  shareImageKey: null,
  revision: 4,
  changedBy: 'admin-2',
  changedByName: 'Dan',
  changedAt: '2026-11-21T00:00:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  userGet.mockReturnValue({
    go: async () => ({ data: { givenName: 'Carol', familyName: 'C' } }),
  });
  inspectBrandImage.mockResolvedValue({ ok: true });
  presignPublicMediaUpload.mockResolvedValue({
    uploadUrl: 'https://upload',
    headers: { 'Content-Type': 'image/png' },
  });
  saveBrand.mockImplementation(async (_t, { expectedRevision, changes }) => ({
    ...changes,
    revision: expectedRevision + 1,
    changedBy: 'admin-1',
    changedByName: 'Carol C',
    changedAt: 'now',
  }));
});

describe('authorization', () => {
  it.each([
    ['get', (c: ReturnType<typeof callAs>) => c.get()],
    [
      'createUploadUrl',
      (c: ReturnType<typeof callAs>) =>
        c.createUploadUrl({
          kind: 'logo',
          contentType: 'image/png',
          contentLength: 10,
        }),
    ],
    ['save', (c: ReturnType<typeof callAs>) => c.save(input)],
  ])('%s is FORBIDDEN outside the admin group', async (_, call) => {
    await expect(call(callAs(['instructor']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(saveBrand).not.toHaveBeenCalled();
    expect(presignPublicMediaUpload).not.toHaveBeenCalled();
    expect(attachPublicMediaObject).not.toHaveBeenCalled();
  });
});

describe('branding.get', () => {
  it('is revision 0 with nothing set when no record exists', async () => {
    getBrand.mockResolvedValue(undefined);
    await expect(callAs().get()).resolves.toEqual({
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
    });
  });

  it('returns the record and who changed it', async () => {
    getBrand.mockResolvedValue(stored);
    const result = await callAs().get();
    expect(result.revision).toBe(4);
    expect(result.brand.logoKey).toBe(OLD_LOGO);
    expect(result.changed).toEqual({
      by: 'admin-2',
      byName: 'Dan',
      at: '2026-11-21T00:00:00.000Z',
    });
  });
});

describe('branding.createUploadUrl', () => {
  it('returns a brand key and the signed upload for a PNG logo', async () => {
    const result = await callAs().createUploadUrl({
      kind: 'logo',
      contentType: 'image/png',
      contentLength: 1234,
    });
    expect(result.uploadUrl).toBe('https://upload');
    expect(result.key).toMatch(/^brand\/logo\/[0-9a-f-]{36}\.png$/);
    expect(presignPublicMediaUpload).toHaveBeenCalledWith({
      key: result.key,
      contentType: 'image/png',
      contentLength: 1234,
      cacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('refuses an SVG icon', async () => {
    await expect(
      callAs().createUploadUrl({
        kind: 'icon',
        contentType: 'image/svg+xml',
        contentLength: 100,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(presignPublicMediaUpload).not.toHaveBeenCalled();
  });

  it('refuses a 3 MB share image', async () => {
    await expect(
      callAs().createUploadUrl({
        kind: 'share-image',
        contentType: 'image/png',
        contentLength: 3 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: /too large/ });
    expect(presignPublicMediaUpload).not.toHaveBeenCalled();
  });
});

describe('branding.save', () => {
  it('attaches a new logo and detaches the old one', async () => {
    getBrand.mockResolvedValue(stored);
    const result = await callAs().save({
      ...input,
      expectedRevision: 4,
      name: 'Acme',
      logoKey: NEW_LOGO,
    });
    expect(inspectBrandImage).toHaveBeenCalledWith('logo', NEW_LOGO);
    expect(attachPublicMediaObject).toHaveBeenCalledWith(NEW_LOGO);
    expect(saveBrand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedRevision: 4,
        changedBy: 'admin-1',
        changedByName: 'Carol C',
        changes: expect.objectContaining({ logoKey: NEW_LOGO }),
      }),
    );
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      OLD_LOGO,
    );
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledTimes(1);
    expect(result.revision).toBe(5);
    expect(result.brand.logoKey).toBe(NEW_LOGO);
  });

  it('gives CONFLICT on a stale revision and detaches what it attached', async () => {
    getBrand.mockResolvedValue(stored);
    saveBrand.mockRejectedValue(new BrandConflictError());
    await expect(
      callAs().save({ ...input, expectedRevision: 3, logoKey: NEW_LOGO }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        'Someone else changed the branding. Reload to see their changes.',
    });
    expect(attachPublicMediaObject).toHaveBeenCalledWith(NEW_LOGO);
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      NEW_LOGO,
    );
    expect(bestEffortDetachPublicMediaObject).not.toHaveBeenCalledWith(
      expect.anything(),
      OLD_LOGO,
    );
  });

  it('gives BAD_REQUEST with the message and writes nothing when an image fails inspection', async () => {
    getBrand.mockResolvedValue(stored);
    inspectBrandImage.mockResolvedValue({
      ok: false,
      message: 'The logo can’t contain a <script> element.',
    });
    await expect(
      callAs().save({ ...input, expectedRevision: 4, logoKey: NEW_LOGO }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'The logo can’t contain a <script> element.',
    });
    expect(attachPublicMediaObject).not.toHaveBeenCalled();
    expect(saveBrand).not.toHaveBeenCalled();
    expect(bestEffortDetachPublicMediaObject).not.toHaveBeenCalled();
  });

  it('does not re-inspect keys that are unchanged', async () => {
    getBrand.mockResolvedValue(stored);
    await callAs().save({
      ...input,
      expectedRevision: 4,
      name: 'Acme 2',
      logoKey: OLD_LOGO,
    });
    expect(inspectBrandImage).not.toHaveBeenCalled();
    expect(attachPublicMediaObject).not.toHaveBeenCalled();
    expect(bestEffortDetachPublicMediaObject).not.toHaveBeenCalled();
  });

  it('detaches the old key on a reset', async () => {
    getBrand.mockResolvedValue(stored);
    await callAs().save({ ...input, expectedRevision: 4, logoKey: null });
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      OLD_LOGO,
    );
    expect(attachPublicMediaObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ colour: '#777777' }, /hard to read/],
    [{ name: 'a'.repeat(51) }, /1–50/],
    [{ iconKey: NEW_LOGO }, /not a valid brand image/],
  ])('refuses %j before touching any image', async (change, message) => {
    getBrand.mockResolvedValue(undefined);
    await expect(callAs().save({ ...input, ...change })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message,
    });
    expect(inspectBrandImage).not.toHaveBeenCalled();
    expect(saveBrand).not.toHaveBeenCalled();
  });
});
