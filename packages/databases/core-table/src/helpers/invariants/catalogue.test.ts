/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TableSnapshot } from './snapshot.js';
import { consistentTable, testHelpers } from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { broken, expectOnly } = testHelpers(() => table);

describe('course-landing-shape', () => {
  it('accepts lists of ten trimmed items', () => {
    table.courses[0].learningOutcomes = Array.from(
      { length: 10 },
      (_, i) => `Outcome ${i}`,
    );
    table.courses[0].requirements = ['a'.repeat(160)];
    expect(broken().invariants).toEqual([]);
  });

  it('reports an 11-item list', () => {
    table.courses[0].learningOutcomes = Array.from(
      { length: 11 },
      (_, i) => `Outcome ${i}`,
    );
    expectOnly('course-landing-shape', /11 items/);
  });

  it('reports a padded item', () => {
    table.courses[0].requirements = [' padded '];
    expectOnly('course-landing-shape', /not trimmed/);
  });

  it('reports an empty item and a 161-character item', () => {
    table.courses[0].requirements = [''];
    expectOnly('course-landing-shape', /item 1 is 0 characters/);
    table = consistentTable();
    table.courses[0].learningOutcomes = ['a'.repeat(161)];
    expectOnly('course-landing-shape', /161 characters/);
  });
});

describe('course-category-exists', () => {
  it('reports a course whose category does not exist', () => {
    table.courses[0].categoryId = 'gone';
    expectOnly('course-category-exists', /names no category/);
  });

  it('passes a course in an existing category, archived or not', () => {
    table.categories = [
      {
        categoryId: 'cat',
        name: 'Science',
        slug: 'science',
        status: 'archived',
      },
    ];
    table.categoryClaims = [
      { claim: 'slug#science', categoryId: 'cat' },
      { claim: 'name#science', categoryId: 'cat' },
    ];
    table.courses[0].categoryId = 'cat';
    expect(broken().invariants).toEqual([]);
  });

  it('does not report a course with no catalogue fields', () => {
    expect(broken().invariants).toEqual([]);
  });
});

describe('category-claims-consistent', () => {
  const category = {
    categoryId: 'cat',
    name: 'Data  Science',
    slug: 'data-science',
    status: 'active' as const,
  };
  const claims = [
    { claim: 'slug#data-science', categoryId: 'cat' },
    { claim: 'name#data science', categoryId: 'cat' },
  ];
  beforeEach(() => {
    table.categories = [category];
    table.categoryClaims = [...claims];
  });

  it('passes a category with its two claims', () => {
    expect(broken().invariants).toEqual([]);
  });

  it('reports a category missing its slug claim', () => {
    table.categoryClaims = [claims[1]];
    expectOnly('category-claims-consistent', /0 slug claims/);
  });

  it('reports a category missing its name claim', () => {
    table.categoryClaims = [claims[0]];
    expectOnly('category-claims-consistent', /0 name claims/);
  });

  it('reports a claim pointing to no category', () => {
    table.categoryClaims = [
      ...claims,
      { claim: 'name#other', categoryId: 'missing' },
    ];
    expectOnly('category-claims-consistent', /points to no category/);
  });

  it('reports a claim whose slug differs from its category', () => {
    table.categoryClaims = [
      { claim: 'slug#other', categoryId: 'cat' },
      claims[1],
    ];
    expectOnly('category-claims-consistent', /not for its slug/);
  });

  it('reports a claim whose name differs from its category', () => {
    table.categoryClaims = [
      claims[0],
      { claim: 'name#other', categoryId: 'cat' },
    ];
    expectOnly('category-claims-consistent', /not for its name/);
  });
});

describe('course-catalogue-shape', () => {
  it('passes a course with valid fields', () => {
    Object.assign(table.courses[0], {
      tags: ['data science', 'sql'],
      level: 'beginner',
      language: 'en',
      durationHours: 500,
    });
    expect(broken().invariants).toEqual([]);
  });

  it.each([
    ['an unnormalised tag', { tags: [' SQL'] }],
    ['a duplicate tag', { tags: ['sql', 'sql'] }],
    ['nine tags', { tags: Array.from({ length: 9 }, (_, i) => `tag${i}`) }],
    ['a bad level', { level: 'expert' }],
    ['a bad language', { language: 'xx' }],
    ['a duration of 0', { durationHours: 0 }],
    ['a duration of 501', { durationHours: 501 }],
    ['a fractional duration', { durationHours: 2.5 }],
  ])('reports %s', (_, over) => {
    Object.assign(table.courses[0], over);
    expectOnly('course-catalogue-shape');
  });
});
