# Contract: core-api catalogue operations

All three are public operations (added to `PUBLIC_OPERATIONS`; `router.test.ts` checks the list).

## `course.publicSearch` (changed)

Input (all optional except as noted):

| Field | Type | Rules |
|-------|------|-------|
| `q` | string | 1 to 200 characters when present; absent means browse |
| `categoryId` | string | one category (the landing page passes the slug's id) |
| `tags` | string[] | at most 8, OR within the facet |
| `levels` | (`beginner`, `intermediate`, `advanced`)[] | OR |
| `languages` | language code[] | OR, codes from the fixed list |
| `durationBands` | (`lt2`, `2to10`, `10to40`, `gt40`)[] | OR; bands are hours: under 2, 2 to 10, over 10 to 40, over 40 |
| `cursor` | integer >= 0 | offset, as today |
| `limit` | integer <= 50 | default 10 |

Unknown values are valid and match nothing. Filters across fields AND together.

Output: `items` (courseId, title, description?, imageKey?, plus `category` `{ id, name, slug }`?, `tags`, `level`?, `language`?, `durationHours`?), `cursor`, and `facets`:

```text
facets: {
  categories: [{ id, name, slug, count }],   // active categories only
  tags:       [{ value, count }],            // top 20
  levels:     [{ value, count }],
  languages:  [{ value, count }],
  durationBands: [{ value, count }]
}
```

Counts: published courses matching the text query and every filter except the facet's own. Only values with a count above zero are listed, except the currently selected values, which are always listed (count may be zero). Ordering: relevance with `q`, otherwise `publishedAt` descending then `courseId`. A cold collection still returns the existing retriable `TIMEOUT`.

## `category.list`

No input. Output: `[{ id, name, slug, courseCount }]` for active categories, sorted by name; `courseCount` is the number of published courses with that category, from one size-0 `terms` aggregation sized to the taxonomy bound (500 buckets, not the default 10). Categories with zero courses are still listed, because the list comes from the category records and the counts are merged in.

## `category.bySlug`

Input `{ slug }`. Output `{ id, name, slug, status }` or `NOT_FOUND`. An archived category is returned with `status: 'archived'` so the page can say "no longer available".
