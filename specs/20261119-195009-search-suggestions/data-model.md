# Data Model: Search Suggestions as You Type

No new or changed records. Nothing is written to the core table, and the `courses` index mapping is unchanged.

## Read: `courses` search index

| Field | Mapping | Used for |
|-------|---------|----------|
| `courseId` | `keyword` | Suggestion identifier, and tiebreak sort |
| `title` | `text`, `english` | Matched with `match_bool_prefix` (research R-1), and returned |
| `imageKey` | `keyword`, not indexed | Returned for the row's thumbnail |
| `status` | `keyword` | Filtered to `published` in the query (FR-004) |
| `ratingBoost` | as today | Score multiplier, the same as full search's relevance sort |
| `publishedAt` | `date` | Tiebreak sort |

`_source` is limited to `courseId`, `title` and `imageKey`.

## Suggestion (response item, not stored)

| Field | Type | Rules |
|-------|------|-------|
| `courseId` | string | Always present. Opens `/learn/<courseId>` |
| `title` | string | Always present |
| `imageKey` | string, optional | Present only when the course has an image. The portal resolves it with `usePublicMediaUrl` |

The response holds at most 10 items, best match first. The matched part of the title isn't sent: the portal works it out from the typed text (research R-5).

## Access patterns

| # | Pattern | Served by |
|---|---------|-----------|
| SP1 | Published courses whose title matches typed text, with the last word as a prefix, top 10 | One `_search` on `courses` (`size: 10`, no aggregations, `track_total_hits: false`) |

No core-table access pattern is added. `STREAM_FEATURES` is unchanged.
