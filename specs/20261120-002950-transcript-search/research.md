# Research: Transcript Panel and Transcript Search

What the code does today, read before deciding:

- A video's caption tracks live on its `contentItem` as `captionTracks` (`packages/databases/core-table/src/helpers/caption-tracks.ts`): up to 10, each `{ trackId, nonce, language, label, source: 'auto' | 'uploaded', key, isDefault }`. `nonce` is the video version the track belongs to, and `key` is a WebVTT file in the lesson media bucket at `…/content-items/<contentItemId>/<nonce>/captions/<trackId>.vtt` (`common-server-utils/captions`). A file is at most 1 MB.
- Three writers change the list, all through `applyCaptionChange` and a conditional write: Transcribe's completion (`packages/events/src/media/transcribe-outcome.ts`, always `en-US`), an instructor's upload or removal (instructor-api `procedures/content-item-captions.ts`), and the version swap when a video is replaced. A replaced track gets a new `trackId`.
- A student plays `playableManifest(item)` (core-api `helpers/playback.ts`): the item's own version once `ready`, otherwise the previous version kept while a replacement transcodes. `tracksForPlayback(item.captionTracks, versionId)` gives that version's tracks, default first.
- `contentItem.videoUrl` (core-api `procedures/content-item.ts`) reads the course, module, lesson, item and enrolment, calls `requireEnrolment`, then requires `isShown(module) && isShown(lesson) && isShown(item)`, a video, and a playable manifest. It returns the manifest URL, signed cookies for the version's folder, and each track's URL.
- The shared player (`common-shadcn` `hls-video.tsx`) already fetches every track's WebVTT **as text** in `useCaptionFiles`, turns it into a blob URL for a `<track>`, and `video-controls.tsx` picks the shown track (`captionChoice`, the remembered `captionLanguage`, else the default) and remembers it in `common-web-utils/video-player` preferences.
- Search: `packages/databases/search` defines one index, `courses`, in `src/indices/`. `INDICES` feeds a generated manifest, and index-sync creates a missing index and calls `putMapping` on an existing one. `resolveIndexName` is the only place a name is resolved. The `search-indexing` stream feature (`packages/events/src/search/search-indexing.ts`) reads a change only to learn which course changed, then reads the course consistently and writes or deletes its document. Search suggestions (#587) added a query on the existing `title` field and changed no mapping.
- The stream router sends each core-table change to the queue of every feature in `STREAM_FEATURES` (`core-table/src/helpers/stream-features.ts`). Filters match on event name and entity only. `progress-stream.ts` notes "a filter can't compare the old and new images, so the recalculation itself checks".
- The Search design page already says more content types come "each as its own index … and its own procedure … Each type has its own visibility rule (a lesson's depends on its module, its course, and the caller's enrolment)".

## R-1: A separate `transcripts` index

**Decision**: Add a second index, `transcripts`, to `packages/databases/search/src/indices/`, in the same collection. One document is one passage of one caption track (R-2). The `courses` index is not touched.

**Rationale**:
- The two have different units (a course, a passage), different lifecycles (a course document exists while the course is published; a passage exists while its video can be watched, in a draft, published or archived course), and opposite visibility: `courses` is public, transcripts are for enrolled learners only. Keeping paid course content out of the index that anonymous callers query means a mistake in a public query can't return it.
- A course's transcripts are megabytes of text. On the course document they would make every course edit rewrite all of it, and every catalogue search would score against it unless each query excluded the field.
- A new index is created by index-sync on deploy with no change to an existing mapping (R-8).
- It is what the Search design page already planned, and it gives the AI tutor (#289) an index whose every document is a retrievable passage (R-9).

**Alternatives considered**:
- **A `transcript` text field on the course document.** Rejected for the reasons above. A hit could also only say "this course", not which video or when.
- **`nested` passages inside the course document.** Keeps one index, but a nested change rewrites the whole course document, so the indexing Lambda would have to load every track of the course to change one, and published-only course documents don't exist for draft or archived courses that enrolled learners still watch.
- **A separate collection.** Rejected on cost: each collection group has its own capacity floor (R-7).

## R-2: The indexing unit is a passage: a window of cues, overlapping by one cue

**Decision**: A caption track is split into passages. Each passage is consecutive cues joined with single spaces, closed when adding the next cue would take it past **30 seconds** from its first cue's start or past **600 characters**. Every passage after the first begins with the previous passage's last cue (a one-cue overlap) and always adds at least one new cue. A document stores the passage's text, its start and end time, and `cues`: for each cue, its start time and its character offset in the text (stored, not indexed).

**How a hit maps to a timestamp**: the query asks for highlighting of the whole passage (`number_of_fragments: 0`) with two private-use characters as the tags. The procedure finds the first tagged match, takes its character offset in the plain text, and looks up the cue that offset falls in. That cue's start is the moment's time (FR-013). The snippet is cut from the same text and returned as `{ text, match }` parts, never as HTML.

**Rationale**:
- **A cue alone is too small.** Transcribe's cues are a line or two, a few seconds each. A phrase regularly straddles two cues, and a phrase query on one-cue documents misses it (FR-014). A single line is also a poor passage for the tutor to ground an answer in.
- **A whole track is too big.** One document per track can say "this video" but not when. Getting a time back would need offsets-based highlighting over up to 1 MB of text per hit, and relevance would favour long videos.
- **A window with the cue offsets gets both**: phrases match across cue boundaries inside a passage, the one-cue overlap covers a phrase that straddles two passages (it lies wholly inside the next one), and the offsets give cue-level precision for the time. Passages of about 30 seconds are also the size retrieval for a language model usually wants.
- The overlap means a match inside the shared cue is found twice. The procedure drops repeats by video, track and cue start, which is why it asks for 40 hits to return 20.

**Size**: speech runs near 150 words a minute, about 55 KB of text an hour. Thirty-second passages with overlap give about 130 documents an hour of video per track, each under 1 KB with its offsets.

**Alternatives considered**:
- **One document per cue, with neighbours' text copied in as context.** Three times the text, and the same dedupe problem on every match.
- **Sentence-based passages.** Caption files have no reliable sentence marks (uploaded tracks least of all), and it adds a language-dependent splitter.
- **Fixed windows with no overlap.** Simpler, but a phrase across two passages is never found.
- **Term vectors with offsets and the `fvh` highlighter over a track document.** Larger index, and support on OpenSearch Serverless would need checking for no gain.

## R-3: Keeping the index in step: a stream feature that re-reads the item

**Decision**: A new stream feature, `transcript-indexing`, registered in `STREAM_FEATURES` with its own queue, failure queue and handler (`packages/events/src/search/transcript-indexing.ts`). Like `search-indexing`, it uses a record only to learn what changed, then reads the item as the table holds it now and makes the index match:

| Record | What it does |
|--------|--------------|
| `contentItem` INSERT or MODIFY | If the item is a video and the two images differ in `captionTracks`, `captionTracksRev`, `status`, `s3Key`, `previousS3Key`, `visibility` or `archivedAt`: sync that item. Otherwise nothing, with no read. |
| `contentItem` REMOVE | Delete every document of that `contentItemId`. |
| `lesson` or `module` MODIFY | If `isShown` differs between the images: sync every video item under it (a key-range query on the curriculum partition). Otherwise nothing. |
| `lesson` or `module` REMOVE | Delete every document of that `lessonId` or `moduleId`. |

**Sync one item** (`syncItemTranscripts`, shared with the rebuild): read the item, its lesson and its module consistently. If all three are shown, the item is a video and it has a playable version, the wanted documents are the passages of each of that version's tracks (`tracksForPlayback`), built from the WebVTT files read from the lesson media bucket. Otherwise none are wanted. Then list the ids the index holds for the item, `_bulk` index the wanted ones and delete the rest. Finally, read the three records again and, if what the documents depend on (shown, version, `captionTracksRev`, track ids) has changed, sync once more, up to 3 rounds before throwing for a retry.

**Overlapping syncs.** The queue's event source mapping can't go below 2 concurrent batches, and a lesson's or module's change can sync an item while its own record is in another batch, so two syncs of one item can overlap. Without the re-read, a sync that read track T1 can finish after one that read its replacement T2: it deletes T2's passages and writes T1's back, search drops T1's (R-4), and the video stops being searchable until it changes again. With it, whichever `_bulk` lands last was followed by a read that matched it, so the index ends on the current state. Alternatives considered: a scheduled rebuild (repairs it, but only hours later), and routing one item to one handler at a time (a FIFO queue grouped by item, which the shared `StreamRouter` doesn't build and which would hold up unrelated items behind a slow one).

**Rationale**:
- Every case in the issue is one of these records: captions generated, uploaded, replaced or removed (`captionTracks` changes), the video replaced (`s3Key`, `status`), hidden or archived (`visibility`, `archivedAt` on the item, lesson or module), deleted (REMOVE; lesson and module deletes also delete their items in the same transaction).
- A document id is `<contentItemId>.<trackId>.<seq>`, built only from the record, so a duplicate, late or reordered delivery writes the same documents (FR-026). A replaced track has a new `trackId`, so its passages can't be mistaken for the old one's.
- It needs nothing from the writers: Transcribe's handler, instructor-api and the version swap stay as they are, and a failure here can't fail them (FR-027). The queue retries.
- Its own feature rather than more work in `search-indexing`: it needs to read the lesson media bucket, which the course indexer shouldn't be able to, it reacts to different entities, and a bad caption file landing in its failure queue must not hold up course indexing.
- Comparing the images first matters for cost: a `contentItem` is modified by counters as students use it (`studentActivityCount`), and none of those changes should cost a table read.

**Known limit: leftovers after two quick changes.** OpenSearch Serverless shows a write to searches a few seconds later, and has no `refresh=wait_for`. If a track is added and replaced within seconds, the second sync may not yet see the first one's documents when it lists ids, and leaves them behind. They are never shown: the procedure only returns hits whose track and version the table lists now (R-4). The rebuild (R-6) removes them. `_delete_by_query` isn't relied on at all: deletes are "list ids with `search_after`, then `_bulk` delete", the operations `search-reindex.ts` already uses.

**Alternatives considered**:
- **Index from the writers** (Transcribe's completion, the caption procedures). Three writers in two packages would each need search access, and visibility changes come from other procedures again. It would also tie captioning's success to search being up.
- **React to S3 object events on `*.vtt`.** Sees files, not which tracks are current or whether the item is shown, and has no local equivalent.
- **Keep every item's passages in the index whatever its visibility, and filter only at query time.** Simpler sync (no lesson and module records), and R-4 would still keep hidden text from learners. Rejected because the issue asks for hidden content to leave the index, because the design page's rule is to enforce visibility twice, and because the tutor (#289) will retrieve from the same index.
- **An attribute-aware matcher in the router**, so unrelated item changes never reach the queue. Every other feature filters on entity only and checks the images itself. A batch of skipped records costs one short Lambda run.

## R-4: Access is decided from the table on every search

**Decision**: `transcript.search` is a signed-in procedure. For each call it:

1. Reads the course's curriculum (one partition, every page, as `course.view` does) and the caller's enrolment, and calls `requireEnrolment`, the same function `contentItem.videoUrl` uses.
2. Builds the **watchable set** from the table: `filterEffectivelyVisible`, then video items with a playable version, each with its `versionId` and that version's `trackId`s. A new core-api helper, `watchableVideos`, does this, and is the one place the rule is written for search (and later the tutor).
3. Queries the index with filters it builds itself: `courseId` from the checked input, `contentItemId` in the watchable set, and the language rule (R-5). With an empty set it returns no results without querying.
4. Drops any hit whose `versionId` or `trackId` isn't in the watchable set for its item.
5. Takes the titles it returns from the curriculum it read, not from the index.

**Rationale**:
- The index is a few seconds behind the table and can hold leftovers (R-3). A filter that trusted an indexed "shown" flag would return a just-hidden video's text for those seconds. Building the filter from the table closes that gap completely (spec Story 3, scenario 4; SC-005).
- The browser sends only `courseId`, the text and a language. `courseId` is checked by the enrolment read. Nothing sent can add a video to the filter (FR-022).
- Visibility is enforced twice, as the design page requires: the indexer keeps only watchable items' passages, and the query admits only watchable items.
- The cost is one curriculum query per search, which `course.view` already pays on every page of the course player.

**Alternatives considered**:
- **Filter on indexed flags only** (`shown: true`). Rejected: stale for seconds, and wrong for ever if an update is lost.
- **Check each hit with a `videoUrl`-style read** (4 gets per hit). More reads than one curriculum query, and it wastes the top-N on hits that are then dropped.
- **Document-level security in OpenSearch.** Serverless authorises by IAM principal, not by end user.

## R-5: Language: index every track, search one per video

**Decision**: Passages are built for **every** track of the version students play (up to 10). Each document carries its `language`, `isDefault`, and `trackLanguages` (all the languages that version has). A search looks, per video, in the track for the language the browser sends (the learner's remembered caption language) when the video has one, otherwise in the default track:

```text
language == L  OR  (isDefault AND L not in trackLanguages)        # L sent
isDefault                                                         # no language sent
```

`text` is analysed with `standard` and has an `english` sub-field. Every query matches both.

**Rationale**:
- One track per video means a moment is never listed twice in two languages, and the result matches the transcript the learner will see when they open it.
- Indexing all tracks means changing the caption language needs no re-indexing, and the machine-translated tracks of #593 become searchable the day they exist.
- `standard` is language-neutral, so Spanish or German tracks match on whole words. The `english` sub-field gives English tracks the same stemming course search has ("designing" finds "design"). Running both on every query avoids choosing an analyzer per request, and a stem that matches nothing costs nothing.
- `trackLanguages` and `isDefault` change only when the item's track list changes, which re-syncs the item's documents anyway.

**Known limit**: Chinese, Japanese and Thai are split per character by `standard`. Phrases are still found, with weaker ranking. Per-language analyzers (`text.<lang>` sub-fields) are additive mapping changes for later.

**Alternatives considered**:
- **Index only the default track.** A learner reading Spanish captions would search English text and open a transcript where the words aren't.
- **Search all languages at once.** Shared words (names, code, "Kubernetes") list the same moment once per language.
- **One index per language.** Up to as many indices as languages, for the same documents.

## R-6: A rebuild Lambda

**Decision**: `packages/events/src/search/transcript-reindex.ts`, a private Lambda like `search-reindex.ts`, run by `pnpm nx run @discava/tooling-deploy:reindex-transcripts --stage=<stage> [--course=<courseId>]`. For each course (one, or every course by `course.query.byStatus` for each status, which is a keyed query, not a scan) it reads the curriculum, runs `syncItemTranscripts` for every video item, then deletes the documents of that course whose item isn't in the curriculum. It stops with a cursor when its time is nearly up, and the script calls it again until there is none. With no `--stage` the script runs the same function in-process against the local stack, as `rebuild-analytics` does.

**Rationale**: the index starts empty on every stage and only learns of later changes, so videos captioned before the deploy need one run. It is also the repair for R-3's leftovers, for a recreated index, and for a future analyzer change (R-8). Idempotent for the same reason the stream handler is.

**Alternatives considered**: no rebuild, re-saving captions by hand (constitution VII would allow it for development data, but #270 and #289 both need a rebuild path, and the function it runs already exists for the stream). A Step Functions fan-out: more moving parts than a cursor.

## R-7: Cost on OpenSearch Serverless

**Decision**: Reuse the existing NextGen collection and its per-stage capacity limits. No stage config changes.

- **Capacity (the cost that matters)**: a collection group is billed for the OCUs it uses, with the per-stage floor in `stages.config.ts` (0 on `discava-development`, 1 indexing and 1 search on `discava-production`, ceilings 2 and 8). A second index adds no floor. Indexing happens in short bursts when a video is captioned or an instructor changes a track: one `_bulk` of about 130 small documents per hour of video per track. Searches are submitted (not per keystroke), filtered to one course, return 40 small hits, and run no aggregations.
- **Storage**: about 130 documents and 150 KB of source per hour of video per track, before index overhead. A 20-hour course with two tracks is about 5,000 documents and 6 MB. A thousand such courses is about 5 million documents and single-digit gigabytes, well inside one shard. Storage is billed per GB-month and is small beside capacity.
- **Around it**: one SQS message per routed `contentItem`, `lesson` or `module` change and one batched Lambda run per 100 records or 5 seconds, most of which return after comparing images. One S3 GET per track per sync (files of at most 1 MB). One extra curriculum query per search.
- **Cold start**: on a stage with a floor of 0 the first search after a quiet spell can time out. The procedure maps that to the same `TIMEOUT` message course search uses.

**To check on the development stage** (task T042): that a stage's first transcript writes after idle don't hit the failure queue (the queue's five receives should outlast a cold start), and the indexing OCU-hours a 1-hour video costs, from the collection's CloudWatch metrics.

**Alternatives considered**: a collection of its own (a second floor); keeping transcripts in DynamoDB and scanning (no full-text search, and constitution V forbids the scan); Bedrock Knowledge Bases for the tutor's sake (its own vector collection with a classic floor, see R-9).

## R-8: How this fits #270 (changing an existing index's mapping)

**Decision**: Nothing here needs #270, and nothing here gets in its way.

- **Adding the index** is the case index-sync already handles: `INDICES` gains an entry, the manifest hash changes, the custom resource runs on deploy and creates the missing index. No existing mapping changes, so nothing can conflict. Locally the `opensearch` target's index sync does the same.
- **Every caller uses `resolveIndexName('transcripts')`**, so when #270 turns logical names into aliases over versioned physical indices, this index follows with no change to its callers.
- **Later additive changes** (a `text.<lang>` sub-field, an embedding field if R-9's check allows) go through `putMapping` in place.
- **A breaking change** (the analyzer of `text`, a field's type) is #270's case. This index is the easy one for it: every document is derived from the table and S3, and R-6's rebuild Lambda is the "rebuild job" #270 describes. Its stale-write guard (external versioning) should use the item's `captionTracksRev` together with its version; the documents carry `versionId`, and `captionTracksRev` can be added as a field when #270 is built.
- Before launch, a breaking change is still "delete the index, deploy, run the rebuild".

Because the mapping is cheap to add to and expensive to change, the choices that can't be changed in place were made carefully: `standard` plus an `english` sub-field for `text` (R-5), `keyword` for every identifier, `float` seconds.

## R-9: What the AI tutor (#289) can rely on

**Decision**: The index is designed so the tutor can retrieve passages without re-processing captions, and the tutor itself is out of scope.

- A document **is** a passage: about 30 seconds of speech with its course, module, lesson, video, version, track, language and time span, so a retrieval can be scoped to a lesson (`lessonId`), a video or a course, and can cite "lesson X at 12:40".
- `watchableVideos` and `buildTranscriptSearchRequest` (core-api helpers) take the scope and the text and return the filtered request. The tutor calls the same two, so it can't retrieve what the learner can't watch.
- Retrieval is lexical (BM25) today. That is enough for #289's first phase (hints grounded in the lesson's transcript).

**Open for #289, not decided here**: whether it wants vector retrieval. That needs an embedding per passage (a Bedrock call when a track is indexed) and a `knn_vector` field, and whether a NextGen **search** collection accepts one, or needs the index created with `index.knn` or a vector collection, has to be verified first. If the setting must be present at creation, the index is recreated and rebuilt with R-6, which costs nothing before launch. Adding it now would mean paying for embeddings nobody reads.

## R-10: The panel is built in the browser from the caption file

**Decision**: No API for the panel. `useCaptionFiles` in `hls-video.tsx` already has each track's WebVTT text. It is parsed once into cues with a new shared module, `@discava/common-web-utils/webvtt` (`parseWebVtt`, `activeCueIndex`), and `TranscriptPanel` (new, in `common-shadcn`) renders the cues of the track `VideoControls` has chosen. `HlsVideo` gets two opt-in props, `transcript` and `startAt`, which only the student lesson player passes.

**Rationale**:
- Access is exactly the captions overlay's: the files come from `contentItem.videoUrl` under its checks and the signed cookies (FR-008). There is no second path to get wrong.
- The parser is pure text handling, so it works in jsdom tests (which have no `TextTrack` cues) and in the indexing Lambda, which needs the same cues to build passages. `packages/events` already imports from `common-web-utils` (`caption-languages`), so one parser serves both and the panel and the index can't disagree about what a cue is.
- Cue text is reduced to plain text in the parser: cue settings, `<v>`, `<c>`, `<i>` and timestamp tags are dropped and the five WebVTT entities decoded. The panel renders text nodes only.
- The whole transcript is rendered (no virtual list), so the browser's find-in-page and a screen reader's reading commands work on it. A two-hour video is a few thousand short rows.

**Alternatives considered**:
- **Read `video.textTracks[i].cues`.** Cues load only for tracks whose mode isn't `disabled`, differ between browsers, and aren't available in jsdom.
- **Serve the transcript from the index** (`transcript.get`). A second copy of the access rule, a dependency on search for a feature that needs none, and passages aren't lines.
- **A virtualised list.** Breaks find-in-page and makes the keyboard pattern and "scroll the current line into view" harder to get right for assistive technology.

## R-11: Keyboard and screen-reader pattern for the panel

**Decision**:
- The toggle is a text button, "Transcript", in the control bar, with `aria-expanded` and `aria-controls`.
- The panel is a `<section>` labelled "Transcript (<language label>)", outside the player's shortcut container, so arrow keys and Space in it never reach `keyToAction`.
- The lines are an `<ol>` of `<button>`s. One has `tabIndex=0` (the current line, or the last focused), the rest `-1` (roving tabindex). Up, Down, Home and End move focus. Enter and Space are the button's own activation.
- Each button's text is the time then the line, with the time also given as words for screen readers ("12 minutes 40 seconds"). The current line has `aria-current="true"`. There is no live region for it: the captions overlay and the audio already carry the live content.
- Following: the panel sets its own `scrollTop` to keep the current line in view (never `scrollIntoView`, which can scroll the page). A scroll, wheel, touch or focus inside the panel pauses following and shows a "Jump to current line" button. Choosing a line or that button resumes it. With `prefers-reduced-motion` the scroll isn't animated.
- Layout: a grid that puts the panel beside the player from the `lg` breakpoint, at the player's height, and below it otherwise, at most `20rem` or half the viewport high.

**Rationale**: a listbox would be the other pattern for a single-tab-stop list, but its options are "selected", not "activated", and screen readers switch to a forms mode in it, which stops the reading commands people use to read a transcript. A list of buttons keeps the content readable as text and every line operable. A single tab stop keeps several hundred lines from standing between the player and the rest of the lesson.

**Alternatives considered**: every line a tab stop (hundreds of Tab presses to get past), `role="listbox"` (above), a live region announcing each line (talks over the lecture).

## R-12: Opening a lesson at a moment

**Decision**: The lesson route gains two optional search params, `item` (a `contentItemId`) and `t` (whole seconds). `LessonPage` scrolls to that item and passes `startAt={t}` to its `HlsVideo`, which seeks there once loaded, stays paused and shows "Starting at m:ss". `startAt` takes the place of `resumeAt` for that visit and is given to the position reporter as its initial position, so the seek itself saves nothing (FR-016).

**Rationale**: an address is the simplest thing that works from a result link, a bookmark and a shared link (FR-017), and it reuses the resume mechanics the player already has (seek on load, clamp to the duration, stay paused, a dismissible notice). The params grant nothing: the lesson page still loads through `course.view` and `videoUrl`.

**Alternatives considered**: router state instead of the address (lost on reload, not shareable). Autoplay at the moment (blocked with sound by browsers unless the visit began with a gesture, and startling from a shared link).

## R-13: Where the search box and results live

**Decision**: A labelled search form in `CoursePlayerLayout`'s header ("Search transcripts"), on the course home and every lesson. Submitting goes to a new route, `/learn/$courseId/search?q=…`, which renders inside the same layout and lists the moments. The language sent is the player's remembered `captionLanguage`.

**Rationale**: a results page has an address (back works, results can be reopened), needs no popover focus management, and has room for the snippet at phone width. Results as plain links are the most accessible list there is. A dropdown under the box, like course suggestions, suits picking one title, not reading twenty sentences.

**Alternatives considered**: a dialog over the lesson (focus trap, no address). Results in the transcript panel (search is across the course, the panel is one video's).
