/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRAND_DOCUMENT_CACHE_CONTROL,
  BRAND_DOCUMENT_KEY,
  type BrandPublishingDeps,
  brandPublishing,
} from './brand-publishing.js';

const NONCE = '0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12';
const current = {
  name: 'Acme Academy',
  showNameBesideLogo: false,
  colour: '#1d4ed8',
  logoKey: `brand/logo/${NONCE}.svg`,
  iconKey: null,
  shareImageKey: null,
  revision: 7,
  changedBy: 'admin-1',
  changedByName: 'Carol',
  changedAt: '2026-11-22T00:00:00.000Z',
};

const put = vi.fn();
const readCurrent = vi.fn();
const deps: BrandPublishingDeps = { put, readCurrent };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('brandPublishing', () => {
  it('writes the current record, however many records the batch holds', async () => {
    readCurrent.mockResolvedValue(current);
    // An older image in the batch is never consulted: only the record as it
    // stands is read, once.
    await expect(brandPublishing(deps, 5)).resolves.toEqual({
      published: true,
    });
    expect(readCurrent).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    const [{ body }] = put.mock.calls[0] as [{ body: string }];
    expect(JSON.parse(body)).toEqual({
      revision: 7,
      name: 'Acme Academy',
      showNameBesideLogo: false,
      colour: '#1d4ed8',
      logoKey: `brand/logo/${NONCE}.svg`,
      iconKey: null,
      shareImageKey: null,
    });
  });

  it('puts brand/brand.json with exactly these headers', async () => {
    readCurrent.mockResolvedValue(current);
    await brandPublishing(deps, 1);
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'brand/brand.json',
        contentType: 'application/json',
        cacheControl: 'public, max-age=60, s-maxage=240',
      }),
    );
    expect(BRAND_DOCUMENT_KEY).toBe('brand/brand.json');
    expect(BRAND_DOCUMENT_CACHE_CONTROL).toBe(
      'public, max-age=60, s-maxage=240',
    );
  });

  it('writes nothing when there is no record', async () => {
    readCurrent.mockResolvedValue(undefined);
    await expect(brandPublishing(deps, 1)).resolves.toEqual({
      published: false,
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('never publishes who saved', async () => {
    readCurrent.mockResolvedValue(current);
    await brandPublishing(deps, 1);
    const [{ body }] = put.mock.calls[0] as [{ body: string }];
    expect(body).not.toContain('changedBy');
    expect(body).not.toContain('changedByName');
    expect(body).not.toContain('Carol');
    expect(body).not.toContain('admin-1');
  });

  it('fails the batch when S3 fails, so it is delivered again', async () => {
    readCurrent.mockResolvedValue(current);
    put.mockRejectedValue(new Error('S3 is down'));
    await expect(brandPublishing(deps, 1)).rejects.toThrow('S3 is down');
  });

  it('fails the batch when the record is not a valid brand', async () => {
    readCurrent.mockResolvedValue({ ...current, colour: '#777777' });
    await expect(brandPublishing(deps, 1)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
