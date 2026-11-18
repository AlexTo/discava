/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildSearchRequest } from './search-query.js';

const build = (input: Record<string, unknown> = {}) =>
  buildSearchRequest({ limit: 10, ...input } as never) as any;

describe('buildSearchRequest', () => {
  it('browses every published course, newest first, without text', () => {
    const body = build();

    expect(body.query.bool.must).toEqual({ match_all: {} });
    expect(body.query.bool.filter).toEqual([{ term: { status: 'published' } }]);
    expect(body.sort).toEqual([{ publishedAt: 'desc' }, { courseId: 'asc' }]);
    expect(body.post_filter).toBeUndefined();
  });

  it('searches text by relevance, with no explicit sort', () => {
    const body = build({ q: 'dynamodb' });

    expect(body.query.bool.must.function_score.query.multi_match).toMatchObject(
      {
        query: 'dynamodb',
        fields: ['title', 'description'],
        type: 'cross_fields',
      },
    );
    expect(body.sort).toBeUndefined();
  });

  it('puts every filter in post_filter, OR inside a facet and AND across', () => {
    const body = build({
      categoryId: 'cat-1',
      tags: ['sql', 'data'],
      levels: ['beginner', 'advanced'],
      languages: ['en'],
      durationBands: ['lt2', 'gt40'],
    });

    expect(body.query.bool.filter).toEqual([{ term: { status: 'published' } }]);
    const clauses = body.post_filter.bool.filter;
    expect(clauses).toHaveLength(5);
    expect(clauses).toContainEqual({ terms: { categoryId: ['cat-1'] } });
    expect(clauses).toContainEqual({ terms: { tags: ['sql', 'data'] } });
    expect(clauses).toContainEqual({
      terms: { level: ['beginner', 'advanced'] },
    });
    expect(clauses).toContainEqual({ terms: { language: ['en'] } });
    const durations = clauses.find((c: any) => c.bool?.should);
    expect(durations.bool.should).toHaveLength(2);
    expect(durations.bool.minimum_should_match).toBe(1);
  });

  it('counts each facet with every filter except its own', () => {
    const body = build({
      categoryId: 'cat-1',
      levels: ['beginner'],
      languages: ['en'],
    });

    const filtersOf = (facet: string) => body.aggs[facet].filter.bool.filter;
    expect(filtersOf('categories')).toEqual([
      { terms: { level: ['beginner'] } },
      { terms: { language: ['en'] } },
    ]);
    expect(filtersOf('levels')).toEqual([
      { terms: { categoryId: ['cat-1'] } },
      { terms: { language: ['en'] } },
    ]);
    expect(filtersOf('languages')).toHaveLength(2);
    expect(filtersOf('tags')).toHaveLength(3);
    expect(filtersOf('durationBands')).toHaveLength(3);
  });

  it('counts over everything when no filter applies', () => {
    expect(build().aggs.levels.filter).toEqual({ match_all: {} });
  });

  it('sizes the aggregations: 500 categories, 20 tags', () => {
    const { aggs } = build();

    expect(aggs.categories.aggs.values.terms).toMatchObject({
      field: 'categoryId',
      size: 500,
    });
    expect(aggs.tags.aggs.values.terms).toMatchObject({
      field: 'tags',
      size: 20,
    });
    expect(aggs.levels.aggs.values.terms.field).toBe('level');
    expect(aggs.languages.aggs.values.terms.field).toBe('language');
  });

  it('matches nothing for an unknown duration band', () => {
    const body = build({ durationBands: ['nope'] });
    const clause = body.post_filter.bool.filter[0];
    expect(clause.bool.should).toEqual([{ match_none: {} }]);
  });

  it('maps duration bands without gaps or overlaps', () => {
    const { ranges } = build().aggs.durationBands.aggs.values.range;
    const bandOf = (hours: number) =>
      ranges
        .filter(
          (r: any) =>
            (r.from === undefined || hours >= r.from) &&
            (r.to === undefined || hours < r.to),
        )
        .map((r: any) => r.key);

    expect(bandOf(1)).toEqual(['lt2']);
    expect(bandOf(2)).toEqual(['2to10']);
    expect(bandOf(10)).toEqual(['2to10']);
    expect(bandOf(11)).toEqual(['10to40']);
    expect(bandOf(40)).toEqual(['10to40']);
    expect(bandOf(41)).toEqual(['gt40']);
    expect(bandOf(500)).toEqual(['gt40']);
  });

  it('applies the same bands as a filter', () => {
    const body = build({ durationBands: ['2to10'] });
    expect(body.post_filter.bool.filter[0].bool.should).toEqual([
      { range: { durationHours: { gte: 2, lt: 11 } } },
    ]);
  });

  it('pages by offset', () => {
    expect(build({ cursor: 20, limit: 5 })).toMatchObject({
      from: 20,
      size: 5,
    });
  });
});
