/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Cancelled, createFakeTable } from './fake-transaction.js';

const table = createFakeTable({
  keyFields: { thing: ['id'], tally: ['id'] },
  createDefaults: { thing: { count: 0 } },
});
const { entities, transact, rows } = table;
const { thing, tally } = entities();

beforeEach(() => {
  rows.clear();
  rows.set(table.keyOf('thing', { id: 'a' }), { id: 'a', count: 1 });
});

describe('createFakeTable', () => {
  it('creates an item with its defaults, only where none exists', () => {
    transact([thing.create({ id: 'b' }).commit()]);

    expect(rows.get('thing|b')).toEqual({ id: 'b', count: 0 });
    expect(() => transact([thing.create({ id: 'b' }).commit()])).toThrow(
      Cancelled,
    );
  });

  it('applies set, add, subtract and remove to a patched item', () => {
    transact([
      thing
        .patch({ id: 'a' })
        .set({ name: 'x' })
        .add({ count: 2 })
        .subtract({ count: 1 })
        .remove(['gone'])
        .commit(),
    ]);

    expect(rows.get('thing|a')).toEqual({ id: 'a', name: 'x', count: 2 });
  });

  it('refuses to patch or delete an item that is not there', () => {
    expect(table.succeeds([thing.patch({ id: 'z' }).commit()])).toBe(false);
    expect(table.succeeds([thing.delete({ id: 'z' }).commit()])).toBe(false);
  });

  it('writes an updated item that was not there yet', () => {
    transact([tally.update({ id: 't' }).add({ stars: 1 }).commit()]);

    expect(rows.get('tally|t')).toEqual({ id: 't', stars: 1 });
  });

  it('checks conditions, treating a missing attribute as failing a comparison', () => {
    const where = (build: (attr: any, op: any) => string) =>
      table.succeeds([
        thing
          .check({ id: 'a' })
          .where((attr: any, op: any) => build(attr, op))
          .commit(),
      ]);

    expect(where((a, o) => o.eq(a.count, 1))).toBe(true);
    expect(where((a, o) => o.gte(a.count, 2))).toBe(false);
    expect(where((a, o) => o.gte(a.missing, 0))).toBe(false);
    expect(where((a, o) => o.ne(a.missing, 0))).toBe(true);
    expect(where((a, o) => `${o.eq(a.count, 9)} OR ${o.exists(a.count)}`)).toBe(
      true,
    );
  });

  it('applies none of the items when one condition fails', () => {
    rows.set('thing|b', { id: 'b', count: 1 });
    const ok = thing.patch({ id: 'b' }).set({ name: 'x' }).commit();
    const fails = thing
      .check({ id: 'a' })
      .where((a: any, o: any) => o.eq(a.count, 5))
      .commit();

    let cancelled: Cancelled | undefined;
    try {
      transact([ok, fails]);
    } catch (error) {
      cancelled = error as Cancelled;
    }

    expect(cancelled?.reasons.map((r) => r.code)).toEqual([
      'None',
      'ConditionalCheckFailed',
    ]);
    expect(rows.get('thing|b')).toEqual({ id: 'b', count: 1 });
  });

  it('refuses a transaction with two operations on one item', () => {
    expect(() =>
      transact([
        thing.patch({ id: 'a' }).commit(),
        thing.patch({ id: 'a' }).commit(),
      ]),
    ).toThrow(/multiple operations/);
  });

  it('lists the rows of one entity', () => {
    transact([tally.update({ id: 't' }).commit()]);

    expect(table.rowsOf('thing')).toEqual([{ id: 'a', count: 1 }]);
  });
});
