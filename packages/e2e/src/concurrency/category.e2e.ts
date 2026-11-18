/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ApiUser, apiUser } from '../helpers/api.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Category creates fired at the same moment, as two admins or a double click
// would (#71). Each test checks what the callers were told; the
// table-invariants fixture then checks the claims they left behind
// (category-claims-consistent).

// How many requests each race fires at once.
const RACERS = 5;

const errorCodes = (results: PromiseSettledResult<unknown>[]) =>
  results.flatMap((result) =>
    result.status === 'rejected'
      ? [(result.reason as { data?: { code?: string } }).data?.code]
      : [],
  );

let admin: ApiUser;

test.beforeEach(async () => {
  admin = await apiUser('Carol', ['admin']);
});

test.describe('an admin', () => {
  test('creating one name at once leaves one category and conflicts for the rest', async () => {
    const name = uniqueName('Raced');

    const results = await Promise.allSettled(
      Array.from({ length: RACERS }, () =>
        admin.admin.category.create.mutate({ name }),
      ),
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(errorCodes(results)).toEqual(
      Array.from({ length: RACERS - 1 }, () => 'CONFLICT'),
    );
    const categories = await admin.admin.category.list.query();
    expect(
      categories.filter((category) => category.name === name),
    ).toHaveLength(1);
  });

  test('creating names that slug alike at once succeeds for each, with distinct slugs', async () => {
    const suffix = uniqueName('slug').toLowerCase().replace(/\s+/g, '-');
    // "Data Science x" and "Data-Science x" are different names with one slug.
    const names = [
      `Data Science ${suffix}`,
      `Data-Science ${suffix}`,
      `Data  Science! ${suffix}`,
    ];

    const results = await Promise.allSettled(
      names.map((name) => admin.admin.category.create.mutate({ name })),
    );

    expect(errorCodes(results)).toEqual([]);
    const created = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const slugs = created.map(({ slug }) => slug);
    expect(new Set(slugs).size).toBe(names.length);
    for (const slug of slugs) {
      expect(slug).toMatch(new RegExp(`^data-science-${suffix}(-\\d+)?$`));
    }
  });
});
