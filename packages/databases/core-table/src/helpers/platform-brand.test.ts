/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import type { BrandFields } from '@discava/common-branding/brand';
import { describe, expect, it } from 'vitest';
import { createFakeCoreTable } from './payment-fake.test.js';
import {
  BrandConflictError,
  BrandValidationError,
  getBrand,
  saveBrand,
} from './platform-brand.js';

const NOW = '2026-11-22T00:00:00.000Z';
const NONCE = '0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12';
const brand = {
  name: 'Acme Academy',
  showNameBesideLogo: true,
  colour: '#1d4ed8',
  logoKey: `brand/logo/${NONCE}.png`,
  iconKey: null,
  shareImageKey: null,
};

const save = (
  fake: ReturnType<typeof createFakeCoreTable>,
  expectedRevision: number,
  changes: Record<string, string | boolean | null> = {},
) =>
  saveBrand(fake.coreTable, {
    expectedRevision,
    changes: { ...brand, ...changes } as BrandFields,
    changedBy: 'admin-1',
    changedByName: 'Carol',
    now: NOW,
  });

describe('saveBrand', () => {
  it('creates revision 1 on the first save', async () => {
    const fake = createFakeCoreTable();
    expect(await getBrand(fake.coreTable)).toBeUndefined();
    const saved = await save(fake, 0);
    expect(saved).toMatchObject({ revision: 1, name: 'Acme Academy' });
    expect(await getBrand(fake.coreTable)).toMatchObject({
      revision: 1,
      changedBy: 'admin-1',
      changedByName: 'Carol',
      changedAt: NOW,
      colour: '#1d4ed8',
      iconKey: null,
    });
  });

  it('moves revision 1 to 2 on the next save', async () => {
    const fake = createFakeCoreTable();
    await save(fake, 0);
    const saved = await save(fake, 1, { name: 'Other' });
    expect(saved.revision).toBe(2);
    expect((await getBrand(fake.coreTable))?.name).toBe('Other');
  });

  it('gives one of two saves on the same revision, and BrandConflictError to the other', async () => {
    const fake = createFakeCoreTable();
    await save(fake, 0);
    const results = await Promise.allSettled([
      save(fake, 1, { name: 'A' }),
      save(fake, 1, { name: 'B' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(BrandConflictError);
    expect((await getBrand(fake.coreTable))?.revision).toBe(2);
  });

  it('conflicts on a stale revision', async () => {
    const fake = createFakeCoreTable();
    await save(fake, 0);
    await save(fake, 1);
    await expect(save(fake, 1)).rejects.toBeInstanceOf(BrandConflictError);
  });

  it('conflicts on a create when a record already exists', async () => {
    const fake = createFakeCoreTable();
    await save(fake, 0);
    await expect(save(fake, 0)).rejects.toBeInstanceOf(BrandConflictError);
    expect((await getBrand(fake.coreTable))?.revision).toBe(1);
  });

  it('conflicts on a patch when there is no record', async () => {
    const fake = createFakeCoreTable();
    await expect(save(fake, 3)).rejects.toBeInstanceOf(BrandConflictError);
  });

  it('removes null fields instead of storing null', async () => {
    const fake = createFakeCoreTable();
    await save(fake, 0);
    await save(fake, 1, { colour: null, logoKey: null, name: null });
    const stored = fake.rows('platformBrand')[0];
    expect(stored).not.toHaveProperty('colour');
    expect(stored).not.toHaveProperty('logoKey');
    expect(stored).not.toHaveProperty('name');
    expect(Object.values(stored ?? {})).not.toContain(null);
    expect(await getBrand(fake.coreTable)).toMatchObject({
      name: null,
      colour: null,
      logoKey: null,
      revision: 2,
    });
  });

  it('never stores null on the first save either', async () => {
    const fake = createFakeCoreTable();
    await save(fake, 0);
    expect(Object.values(fake.rows('platformBrand')[0] ?? {})).not.toContain(
      null,
    );
  });

  it.each([
    [{ colour: '#777777' }, 'colour'],
    [{ name: '' }, 'name'],
    [{ iconKey: `brand/logo/${NONCE}.png` }, 'iconKey'],
  ])('throws before any write for %j', async (changes, field) => {
    const fake = createFakeCoreTable();
    const error = await save(fake, 0, changes).catch((e) => e);
    expect(error).toBeInstanceOf(BrandValidationError);
    expect(error.field).toBe(field);
    expect(fake.rows('platformBrand')).toEqual([]);
  });
});
