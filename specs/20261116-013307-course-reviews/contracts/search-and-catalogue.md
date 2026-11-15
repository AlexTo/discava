# Contract: search and catalogue changes

## Search document (`@discava/search`, `ICourseDocument`)

Four optional numeric fields, mapped additively on the existing `courses` index (no recreate; a change that cannot apply in place belongs to #270):

| Field | Meaning |
|-------|---------|
| `ratingCount` | number of visible ratings; 0 or absent when unrated |
| `ratingAverage` | plain average; absent when unrated |
| `ratingScore` | weighted rating `(count x average + 5 x 3.5) / (count + 5)`; absent when unrated |
| `ratingBoost` | `1 + 0.1 x (ratingScore - 3.5)`; `1` when unrated |

`toCourseDocument(course, rating?)` is the one builder (stream indexer and re-index Lambda). The indexer:

- on a `course` INSERT or MODIFY: keyed get of `courseRating`, then `index`;
- on a `courseRating` INSERT or MODIFY: keyed get of `course`; index it if published, otherwise do nothing;
- on a `course` REMOVE: delete, as today.

`SEARCH_STREAM_FILTERS` lists `courseRating` for INSERT and MODIFY, in addition to `course`; the deployed event source mapping and the local event runner both read it.

## `course.publicSearch` (changed; builds on the current procedure and on #333's version if it merged first)

New optional inputs:

| Field | Type | Rules |
|-------|------|-------|
| `sort` | `relevance` or `rating` or `newest` | default `relevance` |
| `minRating` | `4.5`, `4`, `3.5` or `3` | keeps documents with `ratingAverage >= minRating`; unrated never match |

- `relevance`: the text query's score multiplied by `ratingBoost` (`function_score`, `field_value_factor` on `ratingBoost`, `boost_mode: multiply`, `missing: 1`).
- `rating`: sort by `ratingScore` descending with unrated last, then `publishedAt` descending, then `courseId`.
- `newest`: `publishedAt` descending, then `courseId`.
- `minRating` is a `range` filter beside the existing `status: published` filter.
- Where #333 has not merged, `q` stays required and the options apply to a text search; where it has, `sort` and `minRating` also apply to browsing, and `minRating` combines with its facets by AND.

Hit output gains `ratingAverage?` and `ratingCount`. A cold collection still returns the retriable `TIMEOUT`.

## `course.publicList` (changed)

Each item gains `ratingAverage?` (one decimal) and `ratingCount`, from one batch get of the page's `courseRating` keys (at most 100). Ordering and paging are unchanged.

## Student portal reads

Cards (catalogue home, signed-in home, search results) show "4.6 (128)" or "No ratings yet". The search page gets a Sort select (Relevance, Highest rated, Newest) and a Minimum rating select (Any, 4.5 and up, 4.0 and up, 3.5 and up, 3.0 and up), carried in the URL's search params.
