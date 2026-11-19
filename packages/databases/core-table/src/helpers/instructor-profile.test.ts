/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidHandle } from '../entities/instructor-profile.js';
import { useCoreTable } from '../test-support/core-table.js';
import {
  classifyProfileCancellation,
  defaultDisplayName,
  ensureInstructorProfile,
  handleCandidates,
  handleFromName,
  instructorProfileWrites,
  RESERVED_HANDLES,
} from './instructor-profile.js';

const service = useCoreTable();

type Request = Record<string, any>;
const part = (item: unknown): Request => {
  const [kind, request] = Object.entries(item as object)[0] as [
    string,
    Request,
  ];
  return { kind, ...request };
};

describe('handleFromName', () => {
  it.each([
    ['Alex', 'To', 'alex-to'],
    ['José', 'Ñandú', 'jose-nandu'],
    ['Zoë', 'Müller-Weiß', 'zoe-muller-wei'],
    ['  Mary  Ann ', "O'Neil", 'mary-ann-o-neil'],
    ['Alex', undefined, 'alex'],
  ])('turns %s %s into %s', (given, family, handle) => {
    expect(handleFromName(given, family)).toBe(handle);
  });

  it.each([
    ['', ''],
    ['🙂', '🎉'],
    ['Al', ''],
    [undefined, undefined],
  ])('falls back to "instructor" for %j %j', (given, family) => {
    expect(handleFromName(given, family)).toBe('instructor');
  });

  it('cuts a long name to 30 characters without a trailing hyphen', () => {
    const handle = handleFromName('a'.repeat(29), 'bcd');
    expect(handle).toHaveLength(29);
    expect(handle.endsWith('-')).toBe(false);
    expect(handleFromName('x'.repeat(40), '')).toHaveLength(30);
  });

  it.each(RESERVED_HANDLES)('never returns the reserved handle %s', (word) => {
    const handle = handleFromName(word, '');
    expect(RESERVED_HANDLES).not.toContain(handle);
    expect(isValidHandle(handle)).toBe(true);
  });
});

describe('handleCandidates', () => {
  it('is the base, -2 to -9, then four random ones', () => {
    const list = handleCandidates('alex');
    expect(list.slice(0, 9)).toEqual([
      'alex',
      ...Array.from({ length: 8 }, (_, i) => `alex-${i + 2}`),
    ]);
    expect(list).toHaveLength(13);
    for (const candidate of list.slice(9)) {
      expect(candidate).toMatch(/^alex-[a-z0-9]{4}$/);
    }
  });

  it('keeps every candidate a valid handle for the longest base', () => {
    for (const candidate of handleCandidates('a'.repeat(30))) {
      expect(isValidHandle(candidate)).toBe(true);
    }
  });
});

describe('defaultDisplayName', () => {
  it('joins the names, or falls back', () => {
    expect(defaultDisplayName({ givenName: 'Alex', familyName: 'To' })).toBe(
      'Alex To',
    );
    expect(defaultDisplayName({ givenName: 'Alex' })).toBe('Alex');
    expect(defaultDisplayName({})).toBe('Discava instructor');
    expect(defaultDisplayName(undefined)).toBe('Discava instructor');
  });
});

// A table of just keys, standing in for DynamoDB's conditional writes.
let keys: Set<string>;
let transactions: Request[][];
let user: Record<string, string> | undefined;
let profile: Record<string, string> | undefined;

beforeEach(() => {
  vi.restoreAllMocks();
  keys = new Set();
  transactions = [];
  user = { givenName: 'Alex', familyName: 'To' };
  profile = undefined;
  vi.spyOn(service.entities.instructorProfile, 'get').mockReturnValue({
    go: async () => ({ data: profile ?? null }),
  } as never);
  vi.spyOn(service.entities.user, 'get').mockReturnValue({
    go: async () => ({ data: user ?? null }),
  } as never);
  vi.spyOn(service.transaction, 'write').mockImplementation(((
    build: () => unknown[],
  ) => ({
    go: async () => {
      const items = build().map(part);
      transactions.push(items);
      const results = items.map((item) =>
        keys.has(`${item.Item.pk}|${item.Item.sk}`)
          ? { code: 'ConditionalCheckFailed' }
          : { code: 'None' },
      );
      if (results.some((r) => r.code === 'ConditionalCheckFailed')) {
        return { canceled: true, data: results };
      }
      for (const item of items) {
        keys.add(`${item.Item.pk}|${item.Item.sk}`);
      }
      return { canceled: false, data: results };
    },
  })) as never);
});

const claimOwner = (handle: string) =>
  transactions
    .flat()
    .find((item) => item.Item.handle === handle && !item.Item.displayName);

describe('ensureInstructorProfile', () => {
  it('creates the profile and its claim in one transaction', async () => {
    const result = await ensureInstructorProfile(service, 'i1');

    expect(result).toEqual({ status: 'created', handle: 'alex-to' });
    expect(transactions).toHaveLength(1);
    const [created, claim] = transactions[0];
    expect(created.Item).toMatchObject({
      instructorId: 'i1',
      handle: 'alex-to',
      displayName: 'Alex To',
      version: 1,
    });
    expect(claim.Item).toMatchObject({ handle: 'alex-to', instructorId: 'i1' });
    expect(created.ConditionExpression).toBeDefined();
    expect(claim.ConditionExpression).toBeDefined();
  });

  it('does nothing when the profile exists', async () => {
    profile = { instructorId: 'i1', handle: 'alex-to' };

    expect(await ensureInstructorProfile(service, 'i1')).toEqual({
      status: 'exists',
    });
    expect(transactions).toHaveLength(0);
  });

  it('gives a name-alike the next handle', async () => {
    await ensureInstructorProfile(service, 'i1');
    const second = await ensureInstructorProfile(service, 'i2');

    expect(second).toEqual({ status: 'created', handle: 'alex-to-2' });
  });

  it('works for a name with accents, emoji or nothing', async () => {
    user = { givenName: 'José', familyName: '🙂' };
    expect(await ensureInstructorProfile(service, 'i1')).toEqual({
      status: 'created',
      handle: 'jose',
    });
    user = undefined;
    expect(await ensureInstructorProfile(service, 'i2')).toEqual({
      status: 'created',
      handle: 'instructor',
    });
    expect(transactions[1][0].Item.displayName).toBe('Discava instructor');
  });

  it('keeps going until the random candidates', async () => {
    for (const handle of [
      'alex-to',
      ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `alex-to-${n}`),
    ]) {
      await ensureInstructorProfile(service, `other-${handle}`, { handle });
    }
    const result = await ensureInstructorProfile(service, 'i1');

    expect(result.status).toBe('created');
    expect((result as { handle: string }).handle).toMatch(
      /^alex-to-[a-z0-9]{4}$/,
    );
  });

  it('uses the fields it is given', async () => {
    await ensureInstructorProfile(service, 'i1', {
      fields: { displayName: 'Dr Alex', headline: 'Teacher', bio: 'Hi' },
    });

    expect(transactions[0][0].Item).toMatchObject({
      displayName: 'Dr Alex',
      headline: 'Teacher',
      bio: 'Hi',
    });
  });

  it('tries only an explicit handle, and reports it taken', async () => {
    await ensureInstructorProfile(service, 'i1', { handle: 'taken' });
    transactions = [];

    const result = await ensureInstructorProfile(service, 'i2', {
      handle: 'taken',
    });

    expect(result).toEqual({ status: 'handle-taken' });
    expect(transactions).toHaveLength(1);
    expect(claimOwner('taken')).toBeDefined();
  });

  it('is idempotent when the profile was created concurrently', async () => {
    // The profile appears between the read and the write.
    const { Item } = service.entities.instructorProfile
      .create({ instructorId: 'i1', handle: 'zzz', displayName: 'x' })
      .params() as { Item: Record<string, string> };
    keys.add(`${Item.pk}|${Item.sk}`);

    expect(await ensureInstructorProfile(service, 'i1')).toEqual({
      status: 'exists',
    });
    expect(transactions).toHaveLength(1);
  });
});

const NOW = new Date('2026-11-19T00:00:00.000Z');
const expressionOf = (request: Request) =>
  `${request.UpdateExpression ?? ''} ${request.ConditionExpression ?? ''}`;
const valuesOf = (request: Request) =>
  Object.values({
    ...request.ExpressionAttributeValues,
  }) as unknown[];

describe('instructorProfileWrites.update', () => {
  it('patches the fields, conditioned on and incrementing the version', () => {
    const [item] = instructorProfileWrites.update(service, {
      instructorId: 'i1',
      version: 3,
      patch: { displayName: 'Dr Alex', headline: 'Teacher', bio: '' },
      now: NOW,
    });
    const request = part(item);

    expect(request.kind).toBe('Update');
    expect(request.ConditionExpression).toBeDefined();
    expect(valuesOf(request)).toEqual(
      expect.arrayContaining([3, 4, 'Dr Alex', 'Teacher']),
    );
    expect(request.UpdateExpression).toMatch(/REMOVE/);
    expect(JSON.stringify(request.ExpressionAttributeNames)).toContain('bio');
    expect(JSON.stringify(request.ExpressionAttributeNames)).not.toContain(
      'headline"]',
    );
  });

  it('removes nothing when no field is cleared', () => {
    const [item] = instructorProfileWrites.update(service, {
      instructorId: 'i1',
      version: 1,
      patch: { displayName: 'A' },
      now: NOW,
    });
    expect(part(item).UpdateExpression).not.toMatch(/REMOVE/);
  });
});

describe('instructorProfileWrites.changeHandle', () => {
  const items = (patch?: Record<string, string>) =>
    instructorProfileWrites
      .changeHandle(service, {
        instructorId: 'i1',
        version: 2,
        from: 'old-one',
        to: 'new-one',
        patch,
        now: NOW,
      })
      .map(part);

  it('creates the new claim, deletes the old and updates the profile', () => {
    const [create, remove, update] = items();

    expect(create.kind).toBe('Put');
    expect(create.Item).toMatchObject({
      handle: 'new-one',
      instructorId: 'i1',
    });
    expect(create.ConditionExpression).toMatch(/attribute_not_exists/);
    expect(remove.kind).toBe('Delete');
    expect(remove.Key.pk).toContain('old-one');
    expect(valuesOf(remove)).toContain('i1');
    expect(update.kind).toBe('Update');
    expect(valuesOf(update)).toEqual(
      expect.arrayContaining(['old-one', 'new-one', 2, 3]),
    );
    expect(expressionOf(update)).toMatch(/AND/);
  });

  it('carries the edited fields in the profile update', () => {
    const [, , update] = items({ displayName: 'New name' });
    expect(valuesOf(update)).toContain('New name');
  });
});

describe('instructorProfileWrites.setPhoto', () => {
  it('sets the key and increments the version, unconditioned on it', () => {
    const [item] = instructorProfileWrites.setPhoto(service, {
      instructorId: 'i1',
      photoKey: 'instructors/i1/a.jpg',
      now: NOW,
    });
    const request = part(item);

    expect(valuesOf(request)).toContain('instructors/i1/a.jpg');
    expect(request.UpdateExpression).toMatch(/ADD/);
    expect(request.UpdateExpression).not.toMatch(/REMOVE/);
  });

  it('removes the photo for null', () => {
    const [item] = instructorProfileWrites.setPhoto(service, {
      instructorId: 'i1',
      photoKey: null,
      now: NOW,
    });
    expect(part(item).UpdateExpression).toMatch(/REMOVE/);
  });
});

describe('classifyProfileCancellation', () => {
  const failed = { code: 'ConditionalCheckFailed' };
  const none = { code: 'None' };

  it('gives handle-taken for a failed new claim', () => {
    expect(
      classifyProfileCancellation('changeHandle', [failed, none, none]),
    ).toBe('handle-taken');
  });

  it.each([[[none, failed, none]], [[none, none, failed]]])(
    'gives stale for a failed old claim or profile %j',
    (reasons) => {
      expect(classifyProfileCancellation('changeHandle', reasons)).toBe(
        'stale',
      );
    },
  );

  it('gives stale for a failed update', () => {
    expect(classifyProfileCancellation('update', [failed])).toBe('stale');
  });

  it('gives nothing for a transaction conflict', () => {
    const conflict = { code: 'TransactionConflict' };
    expect(
      classifyProfileCancellation('changeHandle', [conflict, none, none]),
    ).toBeUndefined();
    expect(classifyProfileCancellation('update', [conflict])).toBeUndefined();
  });
});
