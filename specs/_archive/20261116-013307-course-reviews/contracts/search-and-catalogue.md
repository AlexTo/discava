# Contract: search and catalogue changes

## Search document (`@discava/search`, `ICourseDocument`)

Four optional numeric fields, mapped additively on the existing `courses` index (no recreate; a change that cannot apply in place belongs to #270):

| Field | Meaning |
|-------|---------|
| `ratingCount` | number of visible ratings; 0 or absent when unrated |
| `ratingAverage` | plain average; absent when unrated |
| `ratingScore` | weighted rating `(count x average + PRIOR_WEIGHT x PRIOR_MEAN) / (count + PRIOR_WEIGHT)` (5 and 3.5, constants in `review-rating.ts`); absent when unrated |
| `ratingBoost` | `1 + 0.1 x (ratingScore - 3.5)`; `1` when unrated |

`toCourseDocument(course, rating?)` is the one builder (search-indexing handler and re-index Lambda). Search changes reach the handler through the stream event router's standard queue, which does not keep order, so the handler never indexes from the stream image. It extends the existing `index-content.ts` (`courseIdsOf`, `syncCourse`):

- `courseIdsOf` collects the distinct course ids of the batch's `course` records and now also its `courseRating` records (both carry `courseId`); a record without one fails the batch, as today.
- `syncCourse` reads the `course` by key with a consistent read and, if it is published, also reads its `courseRating` by key (consistent) and indexes `toCourseDocument(course, rating)`. An unpublished or missing course is deleted from the index, as today. A rating change for a draft course therefore deletes a document that does not exist, which is a no-op.
- A `course` REMOVE still leads to a delete, because the keyed read finds no course.

`SEARCH_STREAM_FILTERS` lists `courseRating` for INSERT and MODIFY, in addition to `course`. The router's `featuresFor` and the local event runner both read it, so `courseRating` records reach the `search-indexing` feature with no separate event source mapping.

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
