# Data Model: Transcript Panel and Transcript Search

No core-table entity, attribute or index is added or changed, and nothing new is written to the core table. The feature adds one search index, derived entirely from records and files that exist today.

## New: `transcripts` search index

Defined in `packages/databases/search/src/indices/transcripts.ts` with `createIndex`, beside `courses.ts`, and added to `INDICES`. One document is one passage of one caption track (research R-2).

**Document id**: `<contentItemId>.<trackId>.<seq>`, with `seq` zero-padded to 5 digits.

| Field | Mapping | Holds |
|-------|---------|-------|
| `courseId` | `keyword` | The course. Every query filters on it |
| `moduleId` | `keyword` | The module. Used to delete a removed module's documents |
| `lessonId` | `keyword` | The lesson. Used to delete a removed lesson's documents, and by #289 to scope retrieval to a lesson |
| `contentItemId` | `keyword` | The video item. Queries filter on the watchable set (R-4) |
| `versionId` | `keyword` | The video version (manifest nonce) the track belongs to |
| `trackId` | `keyword` | The caption track |
| `language` | `keyword` | The track's BCP 47 tag, as on the track |
| `source` | `keyword` | `auto`, `uploaded` or `translated` (a machine-translated track) |
| `isDefault` | `boolean` | Whether the track is its version's default |
| `trackLanguages` | `keyword` (array) | Every language that version has a track in (R-5) |
| `seq` | `integer` | The passage's position in the track, from 0 |
| `startSeconds` | `float` | Start of the passage's first cue |
| `endSeconds` | `float` | End of the passage's last cue |
| `text` | `text`, `standard`, with sub-field `english` (`text`, `english`) | The passage's cues joined with single spaces |
| `cues` | `object`, `enabled: false` | `[{ s, o }]`: each cue's start in seconds and its character offset in `text`. Stored, not indexed |
| `indexedAt` | `date` | When the document was written |

Settings: `number_of_shards: 1`, `number_of_replicas: 0`, as `courses`.

`TranscriptDocumentSchema` (zod, in the same file) validates a document before it's written: every identifier non-empty, `seq >= 0`, `endSeconds >= startSeconds`, `text` 1 to 2,000 characters, `cues` non-empty with `o` ascending from 0 and `s` ascending, `trackLanguages` containing `language`.

**Which documents exist** (the rule `syncItemTranscripts` keeps):

> For a content item that is a video, is shown, whose lesson and module are shown, and which has a playable version: the passages of every track `tracksForPlayback(item.captionTracks, versionId)` returns. For any other item: none.

The course's status plays no part: enrolled learners watch a course after it is archived, and a draft has no learners to search it.

**Passage rule** (`buildPassages`, in `packages/events/src/search/transcript-document.ts`):

- Cues come from `parseWebVtt`, in file order, with empty ones dropped.
- A passage takes cues while the next one keeps it within 30 seconds of its first cue's start and within 600 characters.
- Every passage after the first starts with the previous passage's last cue, and adds at least one new cue.
- A single cue longer than either limit is a passage on its own, cut at 2,000 characters.
- The private-use characters used as highlight tags (U+E000, U+E001) are removed from cue text.

## Read in a new way: core-table records

| Record | Read by | How | Already covered by |
|--------|---------|-----|--------------------|
| `course`, `module`, `lesson`, `contentItem` (the `curriculum` collection) | `transcript.search` | One partition query, every page, as `course.view` | `filterEffectivelyVisible` and its tests in `core-table/src/helpers/curriculum.test.ts`; the `curriculum` invariants |
| `enrolment` | `transcript.search` | `get` by `courseId` and the caller, through `getEnrolment` and `requireEnrolment` | `enrolment.test.ts`, `content-item.test.ts` (the same refusals) |
| `contentItem`, `lesson`, `module` | `transcript-indexing`, `transcript-reindex` | Consistent `get` by key. Items under a lesson or module by key range on the primary index | `caption-tracks.test.ts` (`tracksForPlayback`), the `caption-tracks-valid` invariant |
| `course` | `transcript-reindex` | `query.byStatus` per status, paged | none needed: read-only |

No scan in a user request. The rebuild's walk over every course is a keyed query in admin tooling.

**`STREAM_FEATURES`**: gains `transcript-indexing`. It reacts to `contentItem`, `lesson` and `module` records, which `progress-recalculation` also receives. Each feature has its own queue, so neither affects the other. The feature writes nothing to the table, so it can't trigger itself or any other feature.

## Moved, not changed

`playableManifest` moves from `packages/apis/core-api/src/helpers/playback.ts` to `@discava/common-server-utils/media-keys`, beside `manifestNonce`, with a new `playableVersion(item)` returning `{ manifest, versionId }`. core-api's `videoUrl` and the indexer both call it, so they can't disagree about which version a student plays.

## Browser only

| Shape | Where | Fields |
|-------|-------|--------|
| `TranscriptCue` | `@discava/common-web-utils/webvtt` | `start` (seconds), `end` (seconds), `text` (plain) |
| `PlayerPreferences` | `@discava/common-web-utils/video-player` | gains `transcriptOpen: boolean`, default `false`, validated like the others |
| `LoadedCaption` | `common-shadcn` `video-controls.tsx` | gains `cues: TranscriptCue[]` |

## Response shape (not stored)

A **moment**, as `transcript.search` returns it: see [contracts/core-api-transcript-search.md](./contracts/core-api-transcript-search.md).

## Access patterns

| # | Pattern | Served by |
|---|---------|-----------|
| TP1 | A course's curriculum and the caller's enrolment | The `curriculum` collection query and an `enrolment` get (existing) |
| TP2 | Passages of a course's watchable videos matching text, in one language per video, top 40 | One `_search` on `transcripts` with `term courseId`, `terms contentItemId`, the language filter, highlighting, no aggregations |
| TP3 | The ids of one item's (or lesson's, module's, course's) documents | `_search` with a `term` filter, `_source: false`, sorted by `_id`, paged with `search_after` |
| TP4 | The video items under a lesson or a module | `contentItem` primary-index query by `courseId`, `moduleId` and optionally `lessonId` (existing key range) |
| TP5 | Every course, for the rebuild | `course.query.byStatus`, once per status, paged with a cursor |
