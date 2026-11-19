/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCoreTableService } from '../service.js';
import {
  type CouponClaim,
  claimCouponWrites,
  confirmCouponWrites,
  couponStatus,
  releaseCouponWrites,
} from './coupon-redemption.js';

let coreTable: Awaited<ReturnType<typeof createCoreTableService>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  coreTable = await createCoreTableService();
});

const NOW = '2026-11-19T10:00:00.000Z';
const LATER = '2026-11-19T11:00:00.000Z';
const EARLIER = '2026-11-19T09:00:00.000Z';
const COURSE = 'course-1';
const CODE = 'SPRING-20';

// ---- The requests ElectroDB would send, checked without a table. ----

interface Conditional {
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}
interface TransactItem {
  Put?: Conditional;
  Update?: Conditional & { UpdateExpression: string };
  Delete?: Conditional;
}

const filled = (item: TransactItem) => {
  const request = (item.Put ?? item.Update ?? item.Delete) as Conditional;
  return request.ConditionExpression.replace(
    /#\w+|:\w+/g,
    (token) =>
      `${request.ExpressionAttributeNames[token] ?? request.ExpressionAttributeValues[token] ?? token}`,
  );
};

describe('the requests', () => {
  const claim: CouponClaim = {
    coupon: { courseId: COURSE, code: CODE },
    userId: 'student-1',
    orderId: 'order-1',
    status: 'reserved',
    now: NOW,
    reservedUntil: LATER,
  };

  it('claim raises the count under the coupon rules and creates the redemption', () => {
    const items = coreTable.transaction
      .write((entities) => claimCouponWrites(entities, claim))
      .params().TransactItems as TransactItem[];
    expect(items).toHaveLength(2);
    expect(filled(items[0] as TransactItem)).toContain(
      `enabled = true AND (attribute_not_exists(expiresAt) OR expiresAt > ${NOW}) AND (attribute_not_exists(maxRedemptions) OR redeemedCount < maxRedemptions)`,
    );
    expect((items[0] as TransactItem).Update?.UpdateExpression).toContain(
      'ADD',
    );
    expect(filled(items[1] as TransactItem)).toContain('attribute_not_exists');
  });

  it('release conditions the delete on reserved and the count on being above 0', () => {
    const items = coreTable.transaction
      .write((entities) =>
        releaseCouponWrites(entities, {
          courseId: COURSE,
          code: CODE,
          userId: 'student-1',
        }),
      )
      .params().TransactItems as TransactItem[];
    expect(filled(items[0] as TransactItem)).toContain('status = reserved');
    expect(filled(items[1] as TransactItem)).toContain('redeemedCount > 0');
  });

  it('confirm conditions on reserved and removes reservedUntil', () => {
    const items = coreTable.transaction
      .write((entities) =>
        confirmCouponWrites(entities, {
          courseId: COURSE,
          code: CODE,
          userId: 'student-1',
        }),
      )
      .params().TransactItems as TransactItem[];
    expect(filled(items[0] as TransactItem)).toContain('status = reserved');
    expect((items[0] as TransactItem).Update?.UpdateExpression).toContain(
      'REMOVE',
    );
  });

  it('refuses a reserved claim with no reservedUntil', () => {
    expect(() =>
      coreTable.transaction
        .write((entities) =>
          claimCouponWrites(entities, { ...claim, reservedUntil: undefined }),
        )
        .params(),
    ).toThrow(/reservedUntil/);
  });
});

// ---- An in-memory table that enforces every condition, atomically. ----

type Row = Record<string, any>;
interface FakeItem {
  entity: 'coupon' | 'couponRedemption';
  kind: 'create' | 'patch' | 'delete';
  key: Row;
  item?: Row;
  set: Row;
  add: Row;
  subtract: Row;
  remove: string[];
  conditions: string[];
}

const keyOf = (entity: string, k: Row) =>
  entity === 'coupon'
    ? `${k.courseId}|${k.code}`
    : `${k.courseId}|${k.code}|${k.userId}`;

// ElectroDB's attribute and operation helpers, producing a JavaScript
// expression over `ref`, which reads a row's attribute. Only what the
// helpers call is understood.
const attrs = new Proxy(
  {},
  {
    get: (_t, name: string) => ({
      toString: () => `ref(${JSON.stringify(name)})`,
    }),
  },
);
const ops = {
  eq: (a: unknown, v: unknown) => `(${a} === ${JSON.stringify(v)})`,
  gt: (a: unknown, v: unknown) => `(${a} > ${JSON.stringify(v)})`,
  exists: (a: unknown) => `(${a} !== undefined)`,
  name: (a: unknown) => `${a}`,
  notExists: (a: unknown) => `(${a} === undefined)`,
};
const holds = (row: Row | undefined, condition: string) =>
  row !== undefined &&
  Boolean(
    new Function(
      'ref',
      `return ${condition.replace(/ AND /g, ' && ').replace(/ OR /g, ' || ')}`,
    )((name: string) => row[name]),
  );

const createFakeTable = () => {
  const rows = {
    coupon: new Map<string, Row>(),
    couponRedemption: new Map<string, Row>(),
  };

  const builder = (
    entity: FakeItem['entity'],
    kind: FakeItem['kind'],
    key: Row,
    item?: Row,
  ) => {
    const built: FakeItem = {
      entity,
      kind,
      key,
      item,
      set: {},
      add: {},
      subtract: {},
      remove: [],
      conditions: [],
    };
    const chain = {
      set: (v: Row) => ((built.set = { ...built.set, ...v }), chain),
      add: (v: Row) => ((built.add = { ...built.add, ...v }), chain),
      subtract: (v: Row) => (
        (built.subtract = { ...built.subtract, ...v }), chain
      ),
      remove: (v: string[]) => (built.remove.push(...v), chain),
      where: (cb: (a: unknown, o: unknown) => string) => (
        built.conditions.push(cb(attrs, ops)), chain
      ),
      commit: () => built,
    };
    return chain;
  };
  const entity = (name: FakeItem['entity']) => ({
    create: (item: Row) => builder(name, 'create', item, item),
    patch: (key: Row) => builder(name, 'patch', key),
    delete: (key: Row) => builder(name, 'delete', key),
  });
  const entities = {
    coupon: entity('coupon'),
    couponRedemption: entity('couponRedemption'),
  };

  const apply = (it: FakeItem) => {
    const table = rows[it.entity];
    const k = keyOf(it.entity, it.key);
    if (it.kind === 'create')
      return void table.set(k, structuredClone(it.item!));
    if (it.kind === 'delete') return void table.delete(k);
    const row = table.get(k)!;
    Object.assign(row, structuredClone(it.set));
    for (const [n, v] of Object.entries(it.add)) row[n] = (row[n] ?? 0) + v;
    for (const [n, v] of Object.entries(it.subtract)) row[n] = row[n] - v;
    for (const n of it.remove) delete row[n];
  };

  // All or nothing: every condition is checked, then every item applied, with
  // no other transaction in between.
  const write = async (build: (e: typeof entities) => FakeItem[]) => {
    const items = build(entities);
    const ok = items.every((it) => {
      const row = rows[it.entity].get(keyOf(it.entity, it.key));
      if (it.kind === 'create') return row === undefined;
      return row !== undefined && it.conditions.every((c) => holds(row, c));
    });
    if (ok) for (const it of items) apply(it);
    return { canceled: !ok };
  };
  return { rows, write };
};

const setup = (coupon: Partial<Row> = {}) => {
  const table = createFakeTable();
  table.rows.coupon.set(`${COURSE}|${CODE}`, {
    courseId: COURSE,
    code: CODE,
    enabled: true,
    redeemedCount: 0,
    ...coupon,
  });
  const run = (build: (e: any) => unknown) => table.write(build as never);
  const claim = (userId: string, over: Partial<CouponClaim> = {}) =>
    run((e) =>
      claimCouponWrites(e, {
        coupon: { courseId: COURSE, code: CODE },
        userId,
        orderId: `order-${userId}`,
        status: 'reserved',
        now: NOW,
        reservedUntil: LATER,
        ...over,
      }),
    );
  const key = (userId: string) => ({ courseId: COURSE, code: CODE, userId });
  const confirm = (userId: string) =>
    run((e) => confirmCouponWrites(e, key(userId)));
  const release = (userId: string) =>
    run((e) => releaseCouponWrites(e, key(userId)));
  const count = () => table.rows.coupon.get(`${COURSE}|${CODE}`)?.redeemedCount;
  const redemptions = () => table.rows.couponRedemption.size;
  return { table, claim, confirm, release, count, redemptions };
};

describe('claim, confirm and release', () => {
  it('a claim raises the count and creates the redemption', async () => {
    const { table, claim, count, redemptions } = setup();
    expect((await claim('a')).canceled).toBe(false);
    expect(count()).toBe(1);
    expect(redemptions()).toBe(1);
    expect(
      table.rows.couponRedemption.get(`${COURSE}|${CODE}|a`),
    ).toMatchObject({
      status: 'reserved',
      reservedUntil: LATER,
      orderId: 'order-a',
    });
  });

  it('a zero-total claim creates a redeemed redemption', async () => {
    const { table, claim, count } = setup();
    expect(
      (await claim('a', { status: 'redeemed', reservedUntil: undefined }))
        .canceled,
    ).toBe(false);
    expect(count()).toBe(1);
    const row = table.rows.couponRedemption.get(`${COURSE}|${CODE}|a`);
    expect(row?.status).toBe('redeemed');
    expect(row).not.toHaveProperty('reservedUntil');
  });

  it('a second claim by the same student fails and leaves the count', async () => {
    const { claim, count, redemptions } = setup();
    await claim('a');
    expect((await claim('a')).canceled).toBe(true);
    expect(count()).toBe(1);
    expect(redemptions()).toBe(1);
  });

  it.each([
    ['past the limit', { maxRedemptions: 1, redeemedCount: 1 }],
    ['after expiry', { expiresAt: EARLIER }],
    ['at the moment of expiry', { expiresAt: NOW }],
    ['when disabled', { enabled: false }],
  ])('a claim %s fails and writes nothing', async (_, coupon) => {
    const { claim, count, redemptions } = setup(coupon);
    const before = count();
    expect((await claim('a')).canceled).toBe(true);
    expect(count()).toBe(before);
    expect(redemptions()).toBe(0);
  });

  it('a claim before expiry and under the limit succeeds', async () => {
    const { claim, count } = setup({
      expiresAt: LATER,
      maxRedemptions: 2,
      redeemedCount: 1,
    });
    expect((await claim('a')).canceled).toBe(false);
    expect(count()).toBe(2);
  });

  it('ten concurrent claims on a limit of 3 leave exactly 3', async () => {
    const { claim, count, redemptions } = setup({ maxRedemptions: 3 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => claim(`student-${i}`)),
    );
    expect(results.filter((r) => !r.canceled)).toHaveLength(3);
    expect(redemptions()).toBe(3);
    expect(count()).toBe(3);
  });

  it('confirm makes a reservation redeemed and drops reservedUntil', async () => {
    const { table, claim, confirm } = setup();
    await claim('a');
    expect((await confirm('a')).canceled).toBe(false);
    const row = table.rows.couponRedemption.get(`${COURSE}|${CODE}|a`);
    expect(row?.status).toBe('redeemed');
    expect(row).not.toHaveProperty('reservedUntil');
  });

  it('confirm is a no-op for a redeemed redemption', async () => {
    const { table, claim, confirm, count } = setup();
    await claim('a', { status: 'redeemed', reservedUntil: undefined });
    const before = structuredClone([...table.rows.couponRedemption.values()]);
    expect((await confirm('a')).canceled).toBe(true);
    expect([...table.rows.couponRedemption.values()]).toEqual(before);
    expect(count()).toBe(1);
  });

  it('confirm of nothing changes nothing', async () => {
    const { confirm, redemptions } = setup();
    expect((await confirm('a')).canceled).toBe(true);
    expect(redemptions()).toBe(0);
  });

  it('release deletes the reservation and lowers the count', async () => {
    const { claim, release, count, redemptions } = setup();
    await claim('a');
    expect((await release('a')).canceled).toBe(false);
    expect(count()).toBe(0);
    expect(redemptions()).toBe(0);
  });

  it('releasing twice lowers the count once', async () => {
    const { claim, release, count } = setup();
    await claim('a');
    await claim('b');
    await release('a');
    expect((await release('a')).canceled).toBe(true);
    expect(count()).toBe(1);
  });

  it('release leaves a redeemed redemption alone', async () => {
    const { claim, confirm, release, count, redemptions } = setup();
    await claim('a');
    await confirm('a');
    expect((await release('a')).canceled).toBe(true);
    expect(count()).toBe(1);
    expect(redemptions()).toBe(1);
  });

  it('release then a claim by another student succeeds at the limit', async () => {
    const { claim, release, count } = setup({ maxRedemptions: 1 });
    await claim('a');
    expect((await claim('b')).canceled).toBe(true);
    await release('a');
    expect((await claim('b')).canceled).toBe(false);
    expect(count()).toBe(1);
  });

  it('the student can claim again after a release', async () => {
    const { claim, release, count } = setup();
    await claim('a');
    await release('a');
    expect((await claim('a')).canceled).toBe(false);
    expect(count()).toBe(1);
  });
});

describe('couponStatus', () => {
  const base = { enabled: true, redeemedCount: 0 };
  it.each([
    ['active', base],
    ['active', { ...base, expiresAt: LATER, maxRedemptions: 5 }],
    ['disabled', { ...base, enabled: false }],
    ['expired', { ...base, expiresAt: EARLIER }],
    ['expired', { ...base, expiresAt: NOW }],
    ['used up', { ...base, maxRedemptions: 2, redeemedCount: 2 }],
    ['active', { ...base, maxRedemptions: 2, redeemedCount: 1 }],
    // Combinations: disabled beats expired beats used up.
    ['disabled', { ...base, enabled: false, expiresAt: EARLIER }],
    ['disabled', { enabled: false, maxRedemptions: 1, redeemedCount: 1 }],
    [
      'expired',
      { ...base, expiresAt: EARLIER, maxRedemptions: 1, redeemedCount: 1 },
    ],
  ] as const)('is %s for %j', (status, coupon) => {
    expect(couponStatus(coupon, NOW)).toBe(status);
  });
});
