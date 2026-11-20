# Contract: the `transcript-indexing` stream feature and the rebuild

## Registration

In `packages/databases/core-table/src/helpers/stream-features.ts`:

```ts
{
  name: 'transcript-indexing',
  filters: TRANSCRIPT_STREAM_FILTERS,
  handler: 'transcript-indexing',
  batch: { maxRecords: 100, windowSeconds: 5 },
  maxReceiveCount: 5,
  // The event source mapping's minimum. Two batches can still sync the same
  // item at once; syncItemTranscripts' re-check (step 5) makes the one that
  // finishes last write the newest state.
  maxConcurrency: 2,
}
```

`TRANSCRIPT_STREAM_FILTERS` and `matchesTranscriptStreamFilters`, in a new `helpers/transcript-stream.ts` (the shape of `search-stream.ts`):

| Event | Image | Entities |
|-------|-------|----------|
| INSERT | NewImage | `contentItem` |
| MODIFY | NewImage | `contentItem`, `lesson`, `module` |
| REMOVE | OldImage | `contentItem`, `lesson`, `module` |

## Handler: `packages/events/src/search/transcript-indexing.ts`

Middleware as `search-indexing.ts` (`sqsToStreamRecords`, the stream schema parser, Powertools). Metrics namespace `TranscriptIndexing`: `ItemsSynced`, `PassagesIndexed`, `PassagesRemoved`, `RecordsSkipped`.

For a batch:

1. Turn each record into an action with `transcriptActionOf(record)` (pure, in `transcript-actions.ts`):

   | Record | Action |
   |--------|--------|
   | `contentItem` INSERT, `type` video, with `captionTracks` | `sync-item` |
   | `contentItem` MODIFY, `type` video, and `captionTracks`, `captionTracksRev`, `status`, `s3Key`, `previousS3Key`, `visibility` or `archivedAt` differs between the images | `sync-item` |
   | `contentItem` REMOVE | `delete-by` `contentItemId` |
   | `lesson` or `module` MODIFY where `isShown` differs between the images | `sync-under` that lesson or module |
   | `lesson` or `module` REMOVE | `delete-by` `lessonId` or `moduleId` |
   | anything else | none |

   A record of these entities without its keys fails the batch, as `courseIdsOf` does.
2. No actions: return without creating a client.
3. Expand each `sync-under` to its video items (TP4), and collect the distinct item keys.
4. Run the deletes, then `syncItemTranscripts` for each item, at most 5 at a time.

Any error fails the batch, and the queue retries it. A caption file that isn't found (deleted between the read and the fetch) counts as "this track has no passages" and is logged, not thrown: the item's next record corrects it.

## `syncItemTranscripts(deps, key)`: `packages/events/src/search/transcript-sync.ts`

`deps` is `{ client, coreTable, readCaptionFile }`. `key` is the item's `{ courseId, moduleId, lessonId, contentItemId }`.

1. Read the item, its lesson and its module with `consistent: true`.
2. Wanted documents:
   - none, unless all three exist and are shown (`isShown`), the item is a video, and `playableVersion(item)` gives a version;
   - otherwise, for each track of `tracksForPlayback(item.captionTracks, versionId)`: `readCaptionFile(track.key)`, `parseWebVtt`, `buildPassages`, `toTranscriptDocuments` (validated by `TranscriptDocumentSchema`).
3. Existing ids: TP3 by `contentItemId`.
4. One or more `_bulk` requests of at most 500 actions: `index` every wanted document under its id, `delete` every existing id that isn't wanted. A `_bulk` response with `errors` throws.
5. Re-check: read the item, its lesson and its module again with `consistent: true`, and compare their `syncStateOf` with the one step 2 used. If it differs, go back to step 2 with the new reads. After 3 rounds that each saw a change, throw, so the queue retries the batch.

`syncStateOf(item, lesson, module)` (pure) is what the wanted documents depend on, without reading any caption file: whether all three are shown, the item's type, the version `playableVersion` gives, `captionTracksRev`, and the `trackId`s of `tracksForPlayback`.

Why step 5: two batches can sync the same item at once (`maxConcurrency: 2`, and a lesson's or module's `sync-under` can overlap an item's own record). Without it, a sync that read the table before a change can finish last, delete the newer track's passages and write back the old track's. Search drops those (R-4), so the video would quietly stop being searchable until its next change or a rebuild. With it, the sync whose `_bulk` lands last has confirmed afterwards that the table still matches what it wrote.

Returns `{ indexed, removed }`, summed over the rounds.

**Properties** (each has a test):

- Running it twice leaves the same documents.
- Running the syncs for two changes in either order leaves the documents of the table's current state.
- Two overlapping syncs, where the one that read the older state finishes last, leave the documents of the table's current state.
- A state that keeps changing through 3 rounds throws.
- It writes nothing to the core table.
- Hidden, archived, not a video, not playable, deleted, or no tracks: every document of the item is deleted.

## Lambda and infrastructure

- `EventsTranscriptIndexing`, generated with `ts#lambda-function` like the other `events-*` wrappers, timeout 5 minutes.
- Built in `StreamRouterStack` by `createTranscriptIndexingLambda(coreTable, searchCollection, lessonMediaBucket)`: AppConfig read (`grantAppConfig`), `coreTable.grantReadData`, `searchCollection.grantWrite(role)`, `lessonMediaBucket.grantRead`. Added to `handlers` under `'transcript-indexing'`. `StreamRouterStackProps` gains `lessonMediaBucket`.
- Registered in `HANDLERS` (`packages/events/src/router/handlers.ts`), so the local event runner runs it against local OpenSearch and S3Mock.
- The `StreamRouter` construct builds the queue, failure queue, alarm and event source mapping from the registration.

## Rebuild: `packages/events/src/search/transcript-reindex.ts`

A private Lambda, `EventsTranscriptReindex` (timeout 15 minutes), with the indexer's grants, built beside it.

```ts
// Event
{ courseId?: string; cursor?: string }
// Result
{ courses: number; items: number; indexed: number; removed: number; cursor?: string }
```

- With `courseId`: that course. Without: every course, by `course.query.byStatus` for each status in turn, resuming from `cursor`.
- Per course: read the curriculum, `syncItemTranscripts` for every video item, then delete the documents with that `courseId` whose `contentItemId` isn't one of the curriculum's video items (TP3 by `courseId`).
- When less than 60 seconds of its time remain, it returns a `cursor` naming where to resume.
- `pnpm nx run @discava/tooling-deploy:reindex-transcripts --stage=<stage> [--course=<courseId>]` invokes it with the stage's credentials until no cursor comes back, and prints the totals (`packages/tooling/deploy/src/infra/reindex-transcripts.ts`, beside `reindex-search.ts`). With no `--stage` it runs `transcriptReindex` in-process against the local stack.
- Running it twice leaves the same documents.
