/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import { checkTableInvariants, consistentTable, T } from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});

const NONCE = '0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12';

describe('branding: platform-brand-shape', () => {
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);
  const brand = (
    overrides: Partial<TableSnapshot['platformBrands'][number]> = {},
  ): TableSnapshot['platformBrands'][number] => ({
    name: 'Acme Academy',
    showNameBesideLogo: true,
    colour: '#1d4ed8',
    logoKey: `brand/logo/${NONCE}.svg`,
    iconKey: `brand/icon/${NONCE}.png`,
    shareImageKey: `brand/share-image/${NONCE}.jpg`,
    revision: 3,
    changedBy: 'admin',
    changedAt: T,
    ...overrides,
  });

  it('is not violated by no record, or a consistent one', () => {
    table.platformBrands = [];
    expect(violationsOf('platform-brand-shape')).toEqual([]);
    table.platformBrands = [brand()];
    expect(violationsOf('platform-brand-shape')).toEqual([]);
    table.platformBrands = [
      brand({
        name: undefined,
        colour: undefined,
        logoKey: undefined,
        iconKey: undefined,
        shareImageKey: undefined,
      }),
    ];
    expect(violationsOf('platform-brand-shape')).toEqual([]);
  });

  it.each([
    [{ name: '' }, /name has 0 characters/],
    [{ name: '   ' }, /name has 0 characters/],
    [{ name: 'a'.repeat(51) }, /name has 51 characters/],
    [{ colour: '#777777' }, /colour #777777/],
    [{ iconKey: `brand/logo/${NONCE}.png` }, /iconKey .* is not a icon key/],
    [{ logoKey: `courses/${NONCE}.png` }, /logoKey/],
    [{ revision: 0 }, /revision 0/],
    [{ changedAt: undefined }, /changedAt is not set/],
    [{ changedBy: '' }, /changedBy is not set/],
  ])('reports %j', (change, message) => {
    table.platformBrands = [brand(change as never)];
    expect(
      violationsOf('platform-brand-shape').map((v) => v.message),
    ).toContainEqual(expect.stringMatching(message));
  });

  it('reports a second record', () => {
    table.platformBrands = [brand(), brand()];
    expect(violationsOf('platform-brand-shape')[0]?.message).toMatch(
      /2 brand records/,
    );
  });
});
