/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SEARCH_TYPES,
  type SearchScope,
  type SearchType,
  searchAcross,
} from '@discava/search';
import { searchProcedure } from '../init.js';
import {
  ISearchOutput,
  SearchInputSchema,
  SearchOutputSchema,
} from '../schema/index.js';

// The content types a caller actually searches: the ones they asked for (or
// every type they may search, if they didn't), restricted to the types they
// may search. A student asking for `user` gets it dropped, not an error, so
// their request can't probe which types exist beyond the ones they're given.
const effectiveTypes = (
  requested: readonly SearchType[] | undefined,
  allowed: readonly SearchType[],
): SearchType[] =>
  requested
    ? requested.filter((type) =>
        (allowed as readonly SearchType[]).includes(type),
      )
    : [...allowed];

export const search = searchProcedure
  .input(SearchInputSchema)
  .output(SearchOutputSchema)
  .query(async ({ ctx, input }) => {
    const types = effectiveTypes(
      input.types,
      ctx.searchableTypes ?? SEARCH_TYPES,
    );
    if (types.length === 0) {
      return { results: [] };
    }
    const scope: SearchScope = ctx.searchScope ?? {};
    const results = await searchAcross({
      query: input.query,
      types,
      size: input.size,
      scope,
    });
    return { results } as ISearchOutput;
  });
