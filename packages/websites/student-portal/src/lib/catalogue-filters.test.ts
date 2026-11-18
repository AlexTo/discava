/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  catalogueFiltersToInput,
  catalogueFiltersToSearch,
  hasCatalogueFilters,
  NO_FILTERS,
  parseCatalogueFilters,
} from './catalogue-filters';

describe('catalogue filters', () => {
  it('round-trips through the search params', () => {
    const filters = {
      category: 'science',
      tags: ['sql', 'data'],
      levels: ['beginner'],
      languages: ['en', 'fr'],
      durations: ['lt2'],
    };

    expect(parseCatalogueFilters(catalogueFiltersToSearch(filters))).toEqual(
      filters,
    );
  });

  it('round-trips the sort and minimum rating, and sends them to the search', () => {
    const filters = { ...NO_FILTERS, sort: 'rating', minRating: 4.5 } as const;

    expect(catalogueFiltersToSearch(filters)).toEqual({
      sort: 'rating',
      minRating: 4.5,
    });
    expect(parseCatalogueFilters(catalogueFiltersToSearch(filters))).toEqual(
      filters,
    );
    expect(catalogueFiltersToInput(filters)).toEqual({
      sort: 'rating',
      minRating: 4.5,
    });
  });

  it('ignores a sort or minimum rating the API does not know', () => {
    // 'relevance' is the default, so it is never in the address.
    for (const search of [
      { sort: 'relevance', minRating: 5 },
      { sort: 'popular', minRating: 'high' },
      { minRating: 2 },
    ]) {
      expect(parseCatalogueFilters(search)).toEqual(NO_FILTERS);
    }
    expect(parseCatalogueFilters({ minRating: '3.5' }).minRating).toBe(3.5);
  });

  it('leaves unset filters out of the params', () => {
    expect(catalogueFiltersToSearch(NO_FILTERS)).toEqual({});
    expect(
      catalogueFiltersToSearch({ ...NO_FILTERS, levels: ['beginner'] }),
    ).toEqual({
      levels: ['beginner'],
    });
  });

  it('ignores unknown params and values of the wrong type', () => {
    expect(
      parseCatalogueFilters({
        query: 'sql',
        colour: 'red',
        category: 5,
        tags: [1, 'sql', ''],
        levels: 'beginner',
      }),
    ).toEqual({ ...NO_FILTERS, tags: ['sql'], levels: ['beginner'] });
  });

  it('knows whether any filter is set', () => {
    expect(hasCatalogueFilters(NO_FILTERS)).toBe(false);
    expect(hasCatalogueFilters({ ...NO_FILTERS, category: 'science' })).toBe(
      true,
    );
  });

  it('builds the search input, naming duration bands as the API does', () => {
    expect(
      catalogueFiltersToInput(
        { ...NO_FILTERS, durations: ['gt40'], tags: ['sql'] },
        'cat-1',
      ),
    ).toEqual({ categoryId: 'cat-1', tags: ['sql'], durationBands: ['gt40'] });
    expect(catalogueFiltersToInput(NO_FILTERS)).toEqual({});
  });
});
