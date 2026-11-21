---

description: "Task list for the transcript panel and transcript search"
---

# Tasks: Transcript Panel and Transcript Search

**Input**: Design documents from `/specs/20261120-002950-transcript-search/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they're included: unit tests for the parser, the passage builder, the stream actions, the item sync, the query and snippet builders and every refusal of the procedure; duplicate and reordered delivery tests for the stream feature; component tests for the panel and the results; and a new `packages/e2e` scenario. No invariant is added, because the feature writes no core-table record (plan, impact check). Write each phase's tests first and watch them fail. Never weaken an existing test to make it pass. A few existing test files change for a named reason (T002's default preferences, T005's caption fixtures, T012's moved cases, T020's and T034's snapshots), and each of those PRs must repeat the reason in its description.

**Who runs what**: An automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The agent writes the e2e tests, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a running local stack, a deployed stage or people, and a reviewer does them before merging.

**Organization**: Seven phases, each one agent PR, merged in order. Each leaves `main` green and working. Phases 1 and 2 form the first PR (the first story's phase ends the first implementation issue).

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Read a video's transcript and jump to any line | P1 |
| US2 | Search what was said in a course and open that moment | P1 |
| US3 | Transcript text only reaches learners who may watch the video | P1 |
| US4 | Search follows what the instructor changes | P2 |
| US5 | Keyboard, screen reader and phone | P2 |

US3 has no phase of its own: search can't ship without its access rule, so its tasks sit in Phase 5 beside US2's. US5 comes straight after US1 because both change the same panel files; US1 already ships real buttons, labels and the phone layout. US4's caption-change cases are delivered by Phase 4's indexer; Phase 6 adds lesson and module changes and the rebuild.

Paths are relative to the repository root. Only the last PR closes #590. Earlier PRs say "Part of #590" and must not use a closing keyword.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - caption cues as data

**Goal**: A WebVTT parser the player and, later, the indexer share, and the saved preference the panel needs. Nothing users see changes.

**Independent test**: `pnpm nx run @discava/common-web-utils:test -- --run webvtt video-player` passes.

- [x] T001 [P] Tests first, then add `packages/common/web-utils/src/webvtt.ts` (new module; add `./webvtt` to the package's exports like `video-player`), per research R-10:
  - `interface TranscriptCue { start: number; end: number; text: string }` (seconds);
  - `parseWebVtt(text: string): TranscriptCue[]`: skips the header, `NOTE`, `STYLE` and `REGION` blocks and cue identifiers; reads `hh:mm:ss.ttt` and `mm:ss.ttt` timings and ignores cue settings after them; joins a cue's lines with a space; drops every tag (`<v Ana>`, `<c.loud>`, `<i>`, `<00:00:01.000>`), decodes `&amp;`, `&lt;`, `&gt;`, `&nbsp;`, `&lrm;`, `&rlm;`, removes U+E000 and U+E001, collapses whitespace; drops cues whose text is empty; returns cues sorted by `start`; never throws (a file with no cue gives `[]`);
  - `activeCueIndex(cues, time): number`: the index of the last cue whose `start` is at or before `time`, or `-1` before the first, by binary search;
  - `spokenTime(seconds): string`: "40 seconds", "12 minutes 40 seconds", "1 hour 2 minutes 5 seconds".

  `webvtt.test.ts` covers: the sample file in [quickstart.md](./quickstart.md) (three cues, the third reading "We start with a random point & a step size."); a byte order mark; CRLF line endings; cue identifiers; a two-line cue; cue settings; a `NOTE` block between cues; overlapping cues; an empty file and one with only the header; `activeCueIndex` before the first cue, inside a cue, in a gap between cues (the earlier cue) and after the last.
- [x] T002 [P] Tests first, then add `transcriptOpen: boolean` (default `false`) to `PlayerPreferences` and `DEFAULT_PREFERENCES` in `packages/common/web-utils/src/video-player.ts`, loaded and validated like `captionsOn` (anything but a boolean is the default) and saved with the others. In `video-player.test.ts`, the expected default preferences gain `transcriptOpen: false`: this is the one intended change to existing assertions, so say so in the PR. Add cases for a saved `true`, a saved non-boolean, and a save that keeps the other fields.
- [x] T003 [P] Add `webVttOf(cues: { start: number; end: number; text: string }[]): string` to `packages/e2e/src/helpers/captions.ts`, beside `webVtt`, writing a valid multi-cue file with `hh:mm:ss.ttt` timings. No scenario uses it yet.

---

## Phase 2: User Story 1 - Read a video's transcript and jump to any line (P1) 🎯 MVP

**Goal**: The student lesson player has a "Transcript" button. The panel lists every line of the chosen caption track, highlights and follows the one being spoken, and a chosen line seeks and plays. It sits beside the video on a wide screen and below it on a phone.

**Independent test**: The component tests in `transcript-panel.test.tsx`, `hls-video.test.tsx` and `video-controls.test.tsx` pass. The e2e test "a learner reads a video's transcript and jumps to a line" passes on PR CI, with screenshots.

- [x] T004 [US1] Tests first, then add `TranscriptPanel` in `packages/common/shadcn/src/components/transcript-panel.tsx`, presentational, per [contracts/transcript-panel-ui.md](./contracts/transcript-panel-ui.md) ("Structure" and "States"). Props: `id`, `cues: TranscriptCue[]`, `activeIndex: number`, `languageLabel: string`, `status: 'ready' | 'failed'`, `onChoose(cue)`, `className`.
  - A `<section aria-label="Transcript (<languageLabel>)">` with a heading "Transcript" and the language.
  - An `<ol>` with one `<button type="button">` per cue: the time from `formatTime` (exported by `video-controls.tsx`) in an `aria-hidden` span, `spokenTime` in an `sr-only` span, then the text as a text node.
  - The active cue's button has `aria-current="true"`, a left border and a heavier weight.
  - `status: 'failed'` shows "This transcript couldn't be loaded.", and no cues shows "This transcript is empty."
  - The panel scrolls inside itself (`overflow-y-auto`), wraps long words, and keeps the active button in view by setting its own `scrollTop` (never `scrollIntoView`, never moving focus).
  - Text labels only, no arrow icons.

  `transcript-panel.test.tsx`: every cue renders with its time; the region's name includes the language; `aria-current` is on `activeIndex` only; clicking a line calls `onChoose` with that cue; the two message states; cue text containing `<b>` is shown literally.
- [x] T005 [US1] Tests first, then change `packages/common/shadcn/src/components/video-controls.tsx`:
  - `LoadedCaption` gains `cues: TranscriptCue[]`;
  - a new optional prop `transcript?: { open: boolean; panelId: string; onToggle(): void; onTrackChange(track: LoadedCaption | undefined): void }`;
  - with it and at least one caption or a `captionNotice` (the condition the captions menu already uses), the control bar shows a text button "Transcript" with `aria-expanded={open}` and `aria-controls={panelId}`, next to the captions menu;
  - `onTrackChange` is called with today's `lastTrack` (the chosen track, else the remembered language, else the default, else the first) whenever it changes, whether captions are on or off.

  Add cases to `video-controls.test.tsx`: no button without the prop, or with neither captions nor a `captionNotice`; the button with only a `captionNotice`; `aria-expanded` follows `open`; clicking calls `onToggle`; `onTrackChange` fires with the default track on mount, with the chosen track after a menu choice, and still with a track when captions are turned off. Existing cases pass unchanged apart from fixtures gaining `cues: []`.
- [x] T006 [US1] Tests first, then wire `packages/common/shadcn/src/components/hls-video.tsx`:
  - `useCaptionFiles` parses each fetched file once with `parseWebVtt` and puts `cues` on the loaded caption;
  - a new prop `transcript?: boolean` (default `false`). Without it the rendered output is exactly today's;
  - with it: the open state starts from `loadPreferences().transcriptOpen` and is saved on toggle (keeping the other preferences); the player and `TranscriptPanel` are wrapped in a `data-slot="hls-video-layout"` grid, one column by default and two from `lg` while the panel is open, with the panel as tall as the player from `lg` and `max-h-[min(20rem,50vh)]` below it; the panel is a sibling of `VideoControls`, outside its keyboard container; it isn't rendered in fullscreen;
  - `activeIndex` is `activeCueIndex(cues, video.currentTime)`, updated on `timeupdate` and `seeked`;
  - choosing a cue sets `video.currentTime = cue.start` and calls `video.play()`, ignoring a rejected promise;
  - `status` is `'failed'` when no track loaded and `useCaptionFiles` reports a notice; otherwise the panel shows the track `VideoControls` reports.

  Add cases to `hls-video.test.tsx` (the file already fakes `fetch` for caption files): no button and no layout wrapper without `transcript`; opening lists the fetched file's cues; a saved `transcriptOpen: true` opens it on mount; `timeupdate` moves `aria-current`; clicking a line sets `currentTime` and calls `play`; choosing another track in the captions menu changes the lines and the region's label; with captions off the default track's lines show; a file with `<v Ana>` and `&amp;` shows plain text; when every caption fetch fails, the button shows and the panel says "This transcript couldn't be loaded."
- [x] T007 [US1] Pass `transcript` to `HlsVideo` in `VideoPlayer` in `packages/websites/student-portal/src/routes/learn/$courseId/-components/content-item.tsx`. Don't pass it in `course-preview.tsx` or in the instructor portal. Add a component test beside the existing content-item tests: a ready video whose `contentItem.videoUrl` handler returns one caption shows a "Transcript" button, and a video with no captions shows none.
- [x] T008 [US1] Add `openTranscript(video)` and `transcriptLines(page)` to `packages/e2e/src/helpers/student-portal.ts` (find the button by role and name "Transcript", the region by name starting "Transcript", and lines by role `button` inside it). Add `packages/e2e/src/scenarios/transcript.e2e.ts` with the test "a learner reads a video's transcript and jumps to a line":
  - make a course with a captioned video with `createCaptionedVideoViaApi`, upload an English track built with `webVttOf` (three cues with a uniquely named phrase, the third starting at 9 s) through the instructor API, publish, and enrol a new student;
  - open the lesson, open the transcript, expect the three lines, and take `screenshot(page, 'transcript-panel-open')`;
  - choose the third line and expect the video's `currentTime` to be at least 9;
  - set the viewport to 375 px wide, expect the panel below the video and `document.documentElement.scrollWidth <= clientWidth`, and take `screenshot(page, 'transcript-panel-phone')`.

---

## Phase 3: User Story 5 - Keyboard, screen reader and phone (P2)

**Goal**: The transcript is one Tab stop with arrow-key movement. It stops following playback when the learner scrolls or moves focus in it, and offers "Jump to current line".

**Independent test**: The keyboard and following cases in `transcript-panel.test.tsx` and `hls-video.test.tsx` pass. The e2e test drives the panel by keyboard only.

- [x] T009 [US5] Tests first, then add the keyboard pattern of [contracts/transcript-panel-ui.md](./contracts/transcript-panel-ui.md) ("Pointer and keyboard") to `packages/common/shadcn/src/components/transcript-panel.tsx`:
  - a roving tab stop: exactly one line has `tabIndex={0}` (the last focused line, else the active one, else the first) and the rest `-1`;
  - Down, Up, Home and End move focus to the next, previous, first and last line and call `preventDefault`;
  - Enter and Space stay the button's own activation, and focus stays on the line after `onChoose`.

  Component tests: one `tabIndex=0`; each of the four keys; Down on the last line stays there; Enter calls `onChoose` and keeps focus. In `hls-video.test.tsx`: with focus on a line, ArrowUp and ArrowRight change neither `video.volume` nor `video.currentTime`.
- [x] T010 [US5] Tests first, then add following control to `packages/common/shadcn/src/components/transcript-panel.tsx` (research R-11):
  - `wheel`, `touchmove`, a `pointerdown` on the scroll area's own scrollbar, or `focusin` on a line pauses following;
  - while paused, a text button "Jump to current line" shows above the list. Choosing it, or choosing a line, resumes following and scrolls the active line to the centre;
  - scrolling uses `behavior: 'smooth'` only when `matchMedia('(prefers-reduced-motion: reduce)')` doesn't match;
  - no live region is added.

  Component tests: a `wheel` event shows the button and a later `activeIndex` change doesn't change `scrollTop`; choosing the button hides it; choosing a line hides it; with reduced motion matched the scroll call has no smooth behavior; the panel contains no `aria-live` or `role="status"` element.
- [x] T011 [US5] Extend the Phase 2 test in `packages/e2e/src/scenarios/transcript.e2e.ts` with a keyboard-only step: focus the "Transcript" button and press Enter to open, Tab to the list, press Down twice then Enter, and expect the video at the third line and focus still on it; press Tab once and expect focus outside the transcript region. Take `screenshot(page, 'transcript-panel-keyboard')`.

---

## Phase 4: Foundational - the transcripts index and its indexer

**Goal**: A `transcripts` index that holds the passages of every watchable video's caption tracks, kept in step when an item's captions, version or own visibility change or it is deleted. Nothing reads it yet, so nothing users see changes.

**Independent test**: `pnpm nx run @discava/search:test -- --run transcripts`, `pnpm nx run @discava/core-table:test -- --run transcript-stream stream-features`, `pnpm nx run @discava/events:test -- --run transcript handlers`, `pnpm nx run @discava/common-server-utils:test -- --run media-keys` and `pnpm nx run @discava/core-api:test -- --run content-item playback course-preview` pass, and `pnpm nx run @discava/infra:synth` succeeds.

- [x] T012 [P] Move `playableManifest` from `packages/apis/core-api/src/helpers/playback.ts` to `packages/common/server-utils/src/media-keys.ts`, unchanged, and add `playableVersion(item): { manifest: string; versionId: string } | undefined` beside it (`versionId` from `manifestNonce`, `undefined` when there is nothing to play or the manifest has no nonce). Move the `playableManifest` cases from `helpers/playback.test.ts` to `media-keys.test.ts` with their assertions unchanged (this is a move, not a weakening: say so in the PR), and add cases for `playableVersion`. Change the importers outright, with no re-export: `packages/apis/core-api/src/procedures/content-item.ts` (use `playableVersion` for the manifest and `versionId`, keeping `videoUrl`'s behavior and tests as they are) and `packages/apis/core-api/src/helpers/course-preview.ts`.
- [ ] T013 [P] Tests first, then add `packages/databases/search/src/indices/transcripts.ts` with `createIndex`, exactly as [data-model.md](./data-model.md) lists it: name `transcripts`; settings `number_of_shards: 1`, `number_of_replicas: 0`; `keyword` for `courseId`, `moduleId`, `lessonId`, `contentItemId`, `versionId`, `trackId`, `language`, `source` and `trackLanguages`; `boolean` `isDefault`; `integer` `seq`; `float` `startSeconds` and `endSeconds`; `text` as `{ type: 'text', analyzer: 'standard', fields: { english: { type: 'text', analyzer: 'english' } } }`; `cues` as `{ type: 'object', enabled: false }`; `date` `indexedAt`. `TranscriptDocumentSchema` (zod) enforces: "every identifier non-empty, `seq >= 0`, `endSeconds >= startSeconds`, `text` 1 to 2,000 characters, `cues` non-empty with `o` ascending from 0 and `s` ascending, `trackLanguages` containing `language`", with `source` one of `auto` and `uploaded`. Export `ITranscriptDocument` and `transcriptDocumentId(contentItemId, trackId, seq)` (`<contentItemId>.<trackId>.<seq padded to 5 digits>`). Add the index to `INDICES` in `indices/index.ts` and export it. `transcripts.test.ts` follows `courses.test.ts`: the schema accepts a valid document and refuses each broken rule, the mapping has a property for every schema key, and `resolveIndexName('transcripts')` works. Run the package's `generate-indices-manifest` target and commit the manifest if it is a tracked file.
- [ ] T014 [P] Tests first, then add `packages/databases/core-table/src/helpers/transcript-stream.ts`, shaped like `search-stream.ts` and exported from `src/index.ts`: `TRANSCRIPT_STREAM_FILTERS` with INSERT and MODIFY (`NewImage`) and REMOVE (`OldImage`) for `contentItem` only in this phase, and `matchesTranscriptStreamFilters`. `transcript-stream.test.ts`: a `contentItem` INSERT, MODIFY and REMOVE match; a `lesson`, `module`, `course`, `enrolment` and `itemCompletion` record don't. Don't register the feature yet (T019 does, with its handler).
- [ ] T015 [P] Tests first, then add `packages/events/src/search/transcript-document.ts`:
  - `buildPassages(cues: TranscriptCue[]): { seq; startSeconds; endSeconds; text; cues: { s; o }[] }[]`, by the passage rule in [data-model.md](./data-model.md): "A passage takes cues while the next one keeps it within 30 seconds of its first cue's start and within 600 characters. Every passage after the first starts with the previous passage's last cue, and adds at least one new cue. A single cue longer than either limit is a passage on its own, cut at 2,000 characters." `PASSAGE_SECONDS = 30` and `PASSAGE_CHARACTERS = 600` are exported constants with a comment pointing to research R-2;
  - `toTranscriptDocuments({ item, versionId, track, trackLanguages, cues, now })`, returning `{ id, document }[]` validated by `TranscriptDocumentSchema`.

  `transcript-document.test.ts`: no cues gives no passages; cues spanning 90 s give passages each within 30 s that overlap by exactly one cue; the 600-character limit closes a passage; one 700-character cue is its own passage; each `o` is the offset at which that cue's text starts in `text`; two words in neighbouring cues are both inside at least one passage, for every neighbouring pair; ids are `transcriptDocumentId` of the item, track and seq; `trackLanguages` and `isDefault` come through.
- [ ] T016 [P] Tests first, then add `packages/events/src/search/transcript-actions.ts` with `transcriptActionOf(record)`, pure, per the action table in [contracts/transcript-indexing.md](./contracts/transcript-indexing.md), for `contentItem` records in this phase:
  - INSERT of a video with `captionTracks`: `{ type: 'sync-item', key }`;
  - MODIFY of a video where `captionTracks`, `captionTracksRev`, `status`, `s3Key`, `previousS3Key`, `visibility` or `archivedAt` differs between the images (compare the raw attribute values): `sync-item`;
  - REMOVE: `{ type: 'delete-by', field: 'contentItemId', value }`;
  - anything else: `undefined`;
  - a `contentItem` record missing `courseId`, `moduleId`, `lessonId` or `contentItemId` throws.

  `transcript-actions.test.ts` covers each row, plus: a MODIFY that only changes `studentActivityCount` or `title` gives `undefined`; a non-video item gives `undefined`; a video becoming hidden gives `sync-item`.
- [ ] T017 Tests first, then add `packages/events/src/search/transcript-sync.ts` (after T012, T013 and T015), per [contracts/transcript-indexing.md](./contracts/transcript-indexing.md):
  - `indexedTranscriptIds(client, field, value)`: every `_id` with that term, `_source: false`, sorted by `_id`, paged with `search_after` (as `indexedCourseIds` in `search-reindex.ts`);
  - `deleteTranscriptsBy(client, field, value)`: those ids removed with `_bulk`, at most 500 actions a request;
  - `syncItemTranscripts({ client, coreTable, readCaptionFile }, key)`: consistent reads of the item, lesson and module; wanted documents only when all three are shown (`isShown`), the item is a video and `playableVersion` gives a version, from `tracksForPlayback`, `readCaptionFile(track.key)`, `parseWebVtt`, `buildPassages` and `toTranscriptDocuments`; then `_bulk` index the wanted ones and delete existing ids that aren't wanted; then the re-check: read the three records again and, if `syncStateOf` differs from the one used, sync again with the new reads, throwing after 3 rounds that each saw a change; a `_bulk` response with `errors` throws; a caption file that isn't found counts as no passages for that track and is logged;
  - `syncStateOf(item, lesson, module)`: pure, what the wanted documents depend on (all three shown, the item's type, the playable version, `captionTracksRev`, the `trackId`s of `tracksForPlayback`);
  - `readCaptionFileFromS3(key)`: a `GetObject` on `resolveLessonMediaBucketName()` with `s3ClientConfig()`, as `transcribe-outcome.ts` reads.

  `transcript-sync.test.ts`, with the OpenSearch client, the table and `readCaptionFile` mocked as `search-indexing.test.ts` mocks them: a shown video with two tracks indexes both tracks' passages with `trackLanguages` holding both; each of hidden item, archived item, hidden lesson, hidden module, non-video, no playable version, no tracks and missing item deletes every existing id and indexes nothing; a replaced track (new `trackId`) deletes the old track's ids; an item being replaced indexes the previous version's tracks only; running it twice sends the same index actions and no deletes the second time; **overlapping syncs**: sync A reads the item with track T1, sync B then reads it with T2 and finishes, A's `_bulk` lands last (hold A's `_bulk` on a deferred promise until B is done), and the index ends with only T2's documents because A's re-check sees T2 and syncs again; a state that changes on every re-read throws after 3 rounds; `syncStateOf` changes for each of a visibility, version, `captionTracksRev` or track change and not for a counter change; a `_bulk` error throws; nothing calls a table write.
- [ ] T018 Tests first, then add the handler `packages/events/src/search/transcript-indexing.ts` (after T016 and T017), with the middleware of `search-indexing.ts` and the namespace `TranscriptIndexing`: map records to actions, return without creating a client when there are none, run `delete-by` actions, then `syncItemTranscripts` for each distinct item key, at most 5 at a time, and record `ItemsSynced`, `PassagesIndexed`, `PassagesRemoved` and `RecordsSkipped`. `transcript-indexing.test.ts`: a batch of unrelated `contentItem` changes creates no client; two records for one item sync it once; a REMOVE deletes by `contentItemId`; **duplicate delivery** (the same batch twice leaves the same documents); **reordered delivery** (the records of "track added" then "track replaced" handled in either order leave the replaced track's documents, because each sync reads the table's current state); a failing sync rejects the batch.
- [ ] T019 Register the feature (after T014 and T018), following the stream router page's "Adding a feature":
  - generate the wrapper with the `ts#lambda-function` generator (read its guide with the `nx-plugin-for-aws` MCP server first) for `packages/events/src/search/transcript-indexing.ts`, giving `EventsTranscriptIndexing` in `packages/common/constructs/src/app/lambda-functions/events-transcript-indexing.ts`, exported from that folder's `index.ts`, with its bundle entry in `packages/events/rolldown.config.ts`. Keep the handler file T018 wrote and set the wrapper's timeout to 5 minutes;
  - add the `transcript-indexing` entry to `STREAM_FEATURES` and `matchesTranscriptStreamFilters` to `MATCHERS` in `packages/databases/core-table/src/helpers/stream-features.ts`, exactly as [contracts/transcript-indexing.md](./contracts/transcript-indexing.md) gives it;
  - add the handler to `HANDLERS` in `packages/events/src/router/handlers.ts`.

  Tests: in `stream-features.test.ts`, a `contentItem` MODIFY is routed to `transcript-indexing` and still to every feature it reached before, and a `course` or `enrolment` record's routing is unchanged; `handlers.test.ts` passes with the new registration; add `packages/events/src/local/transcript-feature.test.ts`, modelled on `earnings-feature.test.ts`, running a `contentItem` change through the local feature runner to the handler.
- [ ] T020 Wire the Lambda in `packages/infra/src/stacks/stream-router-stack.ts` (after T019): `StreamRouterStackProps` gains `lessonMediaBucket`; `createTranscriptIndexingLambda(coreTable, searchCollection, lessonMediaBucket)` creates `EventsTranscriptIndexing`, calls `grantAppConfig`, `coreTable.grantReadData`, `searchCollection.grantWrite(role)` and `lessonMediaBucket.grantRead`, with a comment that it reads the table and the caption files and writes only the search collection; add it to `handlers` under `'transcript-indexing'`. Pass `lessonMediaBucket` from `packages/infra/src/stages/application-stage.ts`. Add a stack test: the function's role can read the table and the bucket and has no table write action. Run `pnpm nx run @discava/infra:synth`, and update `infra` and `common-constructs` snapshots with `-u` only for the new queue, failure queue, alarm, function, grants and the indices manifest hash. List those differences in the PR description.
- [ ] T021 [P] Add `transcript-indexing` to `docs/src/content/docs/en/design/stream-event-router.mdx`: in the opening list of features and as a row in the metrics table (`TranscriptIndexingQueue`, `TranscriptIndexingFailures`, matching the construct's naming for the other features). Note in the PR that translations are pending.

---

## Phase 5: User Story 2 - Search what was said in a course and open that moment (P1)

**Goal**: An enrolled learner searches the course's transcripts from the course player, sees up to 20 moments with the lesson, video, time and marked text, and opens one at that video and time. Nobody else gets any transcript text (US3).

**Independent test**: `pnpm nx run @discava/core-api:test -- --run transcript` and `pnpm nx run @discava/student-portal:test -- --run transcript lesson` pass. The e2e tests "a learner searches a course's transcripts and opens the moment" and "transcript search is refused to someone not enrolled, and hides a hidden lesson at once" pass on PR CI, with screenshots.

- [ ] T022 [P] [US2] Tests first, then add `packages/apis/core-api/src/schema/transcript.ts`, exported through `schema/index.ts`, with `TranscriptSearchInputSchema` and `TranscriptSearchOutputSchema` exactly as in [contracts/core-api-transcript-search.md](./contracts/core-api-transcript-search.md): `courseId: z.string().min(1)`, `q: z.string().trim().min(2).max(200)`, `language: z.string().min(2).max(35).optional()`; `items` at most 20, `startSeconds` a non-negative integer, `snippet` parts `{ text, match }`, and `hasMore`. Schema tests: `" a "` is refused, `"ab"` accepted, 201 characters refused.
- [ ] T023 [P] [US3] Tests first, then add `watchableVideos(curriculum)` in `packages/apis/core-api/src/helpers/transcript-access.ts` (research R-4): from a course's modules, lessons and content items, `filterEffectivelyVisible`, keep `type === 'video'` items with a `playableVersion`, and return for each `{ contentItemId, moduleId, lessonId, versionId, trackIds }` from `tracksForPlayback`, leaving out items with no track. `transcript-access.test.ts`: a shown captioned video is in; each of hidden item, archived item, hidden lesson, archived lesson, hidden module, archived module, non-video, transcoding first upload and no tracks is out; a video being replaced gives the previous version's id and tracks only.
- [ ] T024 [P] [US2] Tests first, then add `buildTranscriptSearchRequest({ courseId, contentItemIds, q, language })` in `packages/apis/core-api/src/helpers/transcript-query.ts`, returning the body in [contracts/core-api-transcript-search.md](./contracts/core-api-transcript-search.md): `size: 40`, `track_total_hits: false`, the `_source` list, the three filters, the `multi_match` on `text` and `text.english` with `operator: 'and'`, the `match_phrase` `should` with `slop: 2`, whole-field highlighting with U+E000 and U+E001, and the sort. `transcript-query.test.ts` pins the whole body with a language and without one, and asserts for every input that the `courseId` and `contentItemId` filters are present and that `q` is passed as a plain string.
- [ ] T025 [P] [US2] Tests first, then add `transcriptSnippet(highlighted, cues)` in `packages/apis/core-api/src/helpers/transcript-snippet.ts`, per the contract's "Snippet": plain text and match ranges from the tagged text, `startSeconds` as the floor of the `s` of the last cue whose `o` is at or before the first match, and at most 240 characters around the first match, cut at word boundaries with "…", as `{ text, match }` parts. `transcript-snippet.test.ts`: a match in the third cue gives the third cue's start; a match at offset 0; two matches both marked; a long passage is cut on both sides; joining the parts and removing "…" is a substring of the plain text; no tags gives the first cue's start and one unmarked part; no part contains U+E000 or U+E001.
- [ ] T026 [US2] [US3] Tests first, then add the procedure (after T022 to T025):
  - `courseSearchProcedure` in `packages/apis/core-api/src/init.ts`: `protectedProcedure` with `createSearchPlugin()` and `createCoreTablePlugin()`, with a comment like `publicSearchProcedure`'s;
  - export `mapSearchError` from `procedures/search.ts`;
  - `searchTranscripts` in `packages/apis/core-api/src/procedures/transcript.ts`, following the contract's nine steps with an 8 s request timeout;
  - `transcript: { search: searchTranscripts }` in `packages/apis/core-api/src/router.ts`. Do **not** add it to `PUBLIC_OPERATIONS`.

  `procedures/transcript.test.ts`, with the table and `getOpenSearchClient` mocked as `search.test.ts` and `content-item.test.ts` do, covers every row of the contract's behavior table, and in particular (SC-005):
  - not enrolled and dropped give `FORBIDDEN` on a published course and `NOT_FOUND` on a draft or archived one, and OpenSearch is never called;
  - an enrolled learner of an archived course gets results;
  - the request sent has `courseId` and exactly the watchable ids, and a hidden video's id isn't among them;
  - a hit for a hidden item, a hit with an old `versionId` and a hit with a removed `trackId` are each dropped even though the index returned them;
  - an empty watchable set returns `{ items: [], hasMore: false }` without calling OpenSearch;
  - two hits with the same item, track and cue start give one item;
  - 40 hits give 20 items and `hasMore: true`;
  - titles come from the curriculum; no `trackId`, `versionId` or key is in the output;
  - a caller with no session is refused with `UNAUTHORIZED`, as every `protectedProcedure` is;
  - a `TimeoutError` gives `TIMEOUT`.

  `router.test.ts`'s public-operations check must pass unchanged. FR-023: `course.view` must keep returning no caption attribute or transcript text; its existing test for that stays as it is, and nothing in this task touches `withoutCaptionAttributes`. Check `packages/infra/src/stacks/core-api-stack.ts` already gives the handler serving `transcript.search` read access to the table and the search collection (the shared router handler has both); add a grant only if `pnpm nx run @discava/infra:synth` or a construct test shows it is missing, and update snapshots only for the new route.
- [ ] T027 [US2] Tests first, then add `startAt?: number` to `HlsVideo` in `packages/common/shadcn/src/components/hls-video.tsx`, per [contracts/transcript-panel-ui.md](./contracts/transcript-panel-ui.md): when set it is used in place of `resumeAt` for the seek on load (clamped the same way, staying paused), the notice reads "Starting at m:ss" with no "Start over" button, and it is the position reporter's `initialPosition`. Cases in `hls-video.test.tsx`: `startAt` 760 with `resumeAt` 30 seeks to 760; the notice text; `onPositionChange` isn't called by the seek; `startAt` past the duration is clamped; without `startAt` the resume cases pass unchanged.
- [ ] T028 [US2] Tests first, then open a lesson at a moment (after T027), per [contracts/transcript-search-ui.md](./contracts/transcript-search-ui.md) ("Opening a moment"):
  - `validateSearch` on `packages/websites/student-portal/src/routes/learn/$courseId/lesson/$lessonId.tsx` giving `{ item?: string; t?: number }`, with `t` kept only when it is a whole number of seconds from 0;
  - `LessonPage` and `ContentItem` (`-components/lesson-page.tsx`, `-components/content-item.tsx`) take the two values; the item named by `item`, when it is a video in the lesson, is scrolled into view once rendered, focus moves to its player, and its `VideoPlayer` passes `startAt={t}`; other items and an unknown `item` are unaffected.

  Component tests: `?item=<video id>&t=760` gives that player `startAt` 760 and the lesson's other video none; an unknown `item`, a non-video `item`, `t=-5` and `t=abc` are ignored; the existing lesson tests pass unchanged.
- [ ] T029 [US2] Tests first, then add `TranscriptSearchBox` in `packages/websites/student-portal/src/routes/learn/$courseId/-components/transcript-search-box.tsx` and render it in `CoursePlayerLayout`'s header (`-components/course-player.tsx`) when the learner has an enrolment, per the contract's "The search box": a `<form role="search" aria-label="Search this course's transcripts">`, a labelled input "Search transcripts" with `maxLength={200}`, a text "Search" button, navigation to `/learn/$courseId/search` with `{ q }` on submit, the "Type at least 2 characters" hint under 2 characters, and full width under the title at phone width. Tests: submit navigates with the trimmed text; one character doesn't navigate and shows the hint; typing calls no procedure; the box isn't rendered without an enrolment. Add a `transcript.search` handler to existing course-player tests only where one now fails for lack of it, without changing their assertions.
- [ ] T030 [US2] Tests first, then add the results route `packages/websites/student-portal/src/routes/learn/$courseId/search.tsx` (`validateSearch` `{ q?: string }`, `beforeLoad: requireSignIn`, inside `CoursePlayerLayout` with the crumb "Search") and `-components/transcript-search-results.tsx`, per the contract's states table and "A result": the query with `language: loadPreferences().captionLanguage`, `staleTime` 60 s and `retry: false`; one `<Link>` per moment to the lesson with `{ item, t }`; module, lesson and item titles; the time with `formatTime` and `spokenTime`; snippet parts as text with matches in `<mark>`; the `hasMore` hint; the empty state; `ErrorAlert` with a "Try again" button for `TIMEOUT` and other errors; and a visually hidden `role="status"` region. `-search.test.tsx` with `renderWithCoreApi` covers every test listed in the contract's "Tests" for the results. Regenerate the route tree if the portal commits it.
- [ ] T031 [US2] [US3] Add `searchTranscripts(page, text)` to `packages/e2e/src/helpers/student-portal.ts` and two tests to `packages/e2e/src/scenarios/transcript.e2e.ts`, each with its own course, captioned video, uploaded track (`webVttOf`, with a uniquely named two-word phrase split across two neighbouring cues, the first starting at 4 s) and students:
  - "a learner searches a course's transcripts and opens the moment": search the phrase with `expectAfterReloads` (indexing lags a few seconds), expect one result naming the lesson with "0:04", take `screenshot(page, 'transcript-search-results')`, choose it, expect the lesson page, the video's `currentTime` at 4 and "Starting at 0:04", and take `screenshot(page, 'transcript-search-opened')`; then search a unique nonsense string and expect "No moments match", with `screenshot(page, 'transcript-search-empty')`;
  - "transcript search is refused to someone not enrolled, and hides a hidden lesson at once": a second student who isn't enrolled calls `transcript.search` through the API client and gets `FORBIDDEN`; after the enrolled student has found the phrase, the instructor hides the lesson through the API and the enrolled student's very next search (no waiting, no reloads) has no result.

---

## Phase 6: User Story 4 - Search follows what the instructor changes (P2)

**Goal**: Hiding, archiving, showing or deleting a lesson or module updates the index, and an operator can rebuild every transcript for a course or a stage.

**Independent test**: `pnpm nx run @discava/core-table:test -- --run transcript-stream stream-features` and `pnpm nx run @discava/events:test -- --run transcript` pass, `pnpm nx run @discava/infra:synth` succeeds, and the e2e test "transcript search follows caption and lesson changes" passes on PR CI.

- [ ] T032 [US4] Tests first, then extend the feature to lessons and modules:
  - `TRANSCRIPT_STREAM_FILTERS` in `packages/databases/core-table/src/helpers/transcript-stream.ts` gains `lesson` and `module` for MODIFY and REMOVE, as the table in [contracts/transcript-indexing.md](./contracts/transcript-indexing.md) has it;
  - `transcriptActionOf` in `packages/events/src/search/transcript-actions.ts` gains `{ type: 'sync-under', key }` for a `lesson` or `module` MODIFY whose `isShown` differs between the images, and `delete-by` `lessonId` or `moduleId` for their REMOVE;
  - `transcript-indexing.ts` expands each `sync-under` to its video items with a `contentItem` primary-index query by `courseId`, `moduleId` and, for a lesson, `lessonId`, every page.

  Tests: the filter and routing cases in `transcript-stream.test.ts` and `stream-features.test.ts` (a `lesson` title edit is routed, and the routing of every other feature is unchanged); in `transcript-actions.test.ts`, a lesson hidden, shown, archived and restored each give `sync-under`, a title or order edit gives `undefined`, and a REMOVE gives `delete-by`; in `transcript-indexing.test.ts`, hiding a module with two videos syncs both and leaves no document, showing it again indexes both, and a lesson REMOVE deletes by `lessonId`.
- [ ] T033 [US4] Tests first, then add the rebuild `packages/events/src/search/transcript-reindex.ts`, per [contracts/transcript-indexing.md](./contracts/transcript-indexing.md) ("Rebuild"): `transcriptReindex({ courseId?, cursor? }, context)` returning `{ courses, items, indexed, removed, cursor? }`; one course, or every course by `course.query.byStatus` for each status in turn; per course the curriculum (every page), `syncItemTranscripts` for each video item, then the documents with that `courseId` whose `contentItemId` isn't a video item of the curriculum removed; a `cursor` returned when `context.getRemainingTimeInMillis()` is under 60,000. The handler has `search-reindex.ts`'s middleware and the namespace `TranscriptReindex`. `transcript-reindex.test.ts`: one course is rebuilt and a document of an item no longer in the curriculum is removed; all courses across two statuses and two pages; a second run indexes the same and removes nothing; low remaining time returns a cursor and the next call resumes after it.
- [ ] T034 [US4] Build the rebuild Lambda (after T033): generate `EventsTranscriptReindex` with `ts#lambda-function` as in T019 (timeout 15 minutes), and create it in `packages/infra/src/stacks/stream-router-stack.ts` beside the indexer with the same grants (`grantAppConfig`, table read, search write, lesson media bucket read) and no event source. Add a stack test for its grants, run `pnpm nx run @discava/infra:synth`, and update snapshots with `-u` only for the new function and its grants, listing them in the PR.
- [ ] T035 [US4] Add `packages/tooling/deploy/src/infra/reindex-transcripts.ts` and a `reindex-transcripts` target in `packages/tooling/deploy/project.json`, modelled on `reindex-search.ts` and its target: `--stage=<stage>` invokes that stage's rebuild Lambda with the stage's credentials, passing `--course=<courseId>` when given, and calls again while a `cursor` comes back, then prints the totals; with no `--stage` it sets `LOCAL_DEV=true` and runs `transcriptReindex` in-process against the local stack, as `rebuild-analytics` does. Add a line for it to `packages/tooling/deploy/CLAUDE.md` and `README.md`. Unit-test the cursor loop with the invoke function injected.
- [ ] T036 [US4] Add the test "transcript search follows caption and lesson changes" to `packages/e2e/src/scenarios/transcript.e2e.ts`, with its own course, video, tracks and student, each step checked with `expectAfterReloads`:
  - replace the English track with one holding a different unique phrase: the old phrase finds nothing and the new one is found;
  - upload a Spanish track, set the student's caption language to Spanish in the player, and find a Spanish-only phrase; remove the track and it finds nothing;
  - hide the lesson, then show it again: the phrase is found again;
  - delete the video: nothing is found, and `GET <local OpenSearch>/transcripts/_count` for that `contentItemId` is 0 (resolve the endpoint the way the search scenario's helpers reach local OpenSearch, or add `transcriptDocumentCount` to `packages/e2e/src/helpers/` if none does).

  Take `screenshot(page, 'transcript-search-after-replace')` after the first step.

---

## Phase 7: Polish - docs and manual checks

**Goal**: The design pages describe the panel and transcript search. Reviewers confirm what tests can't: timing, screen reader output, real Transcribe tracks and a deployed stage.

- [ ] T037 [P] Add a "Transcript" section to `docs/src/content/docs/en/design/video-player.mdx` after "Captions": what the panel shows and which track it follows, choosing a line, following and "Jump to current line", the keyboard keys (a table like the shortcuts one, noting the player's shortcuts don't apply inside the panel), that it's built in the browser from the caption file with no extra request (research R-10), the remembered open state, and opening a lesson at a moment with `?item=…&t=…` (R-12). Add a second "Spec" link to `specs/20261120-002950-transcript-search/` in the page's existing link style. Note in the PR that translations are pending.
- [ ] T038 [P] Add a "Transcript search" section to `docs/src/content/docs/en/design/search.mdx` and update its "Scope" and "Packages" tables for the second index:
  - why a separate `transcripts` index (R-1), what a passage is and how a hit becomes a time (R-2);
  - the `transcript-indexing` feature, what it reacts to, the item sync and the known leftover case (R-3), and the rebuild command (R-6);
  - `transcript.search` and how access is decided from the table on every search (R-4), with the "enforced twice" rule restated for transcripts;
  - which track is searched (R-5);
  - cost (R-7), how the index fits #270 (R-8), and what #289 can rely on (R-9).

  Add a "Spec" link. Note in the PR that translations are pending.
- [ ] T039 (human) Run [quickstart.md](./quickstart.md) steps 1 to 9 and 11 to 17 against `pnpm dev`, saving screenshots to `tmp/screenshots/pr-<number>/`. Confirm the highlighted line keeps up with speech at 1x and 2x (SC-002), that results appear within 2 s (SC-004), and that nothing scrolls sideways at 375 px (SC-008).
- [ ] T040 (human) Run quickstart step 10 with VoiceOver or NVDA, and open a search result with it: the panel's name and language, each line's time and text, the current line, silence while playing, the result count and each result's name are announced as the spec says (FR-029 to FR-033, SC-007).
- [ ] T041 (human) Run quickstart steps 18 to 26 against `pnpm dev`: the refusals, hide and show, archive, replace, remove, delete, the queue's empty failure queue, and the rebuild run twice (SC-005, SC-009).
- [ ] T042 (human) On `discava-development`, after the last PR deploys: run `pnpm nx run @discava/tooling-deploy:reindex-transcripts --stage=discava-development` once; search a phrase from a real Transcribe track and open it; time how long a replaced track takes to show (SC-006); after the stage has been idle, upload a track and confirm the `transcript-indexing` failure queue stays empty; note the indexing OCU-hours a 1-hour video cost from the collection's CloudWatch metrics (research R-7). Record the figures in the PR.

---

## Dependencies

- Phase 1 → Phase 2 (the panel uses the parser and the preference) → Phase 3 (keyboard and following on the Phase 2 panel).
- Phase 4 needs only Phase 1's parser (T001). It can be built while Phase 3 is in review, and merges after it.
- Phase 4 → Phase 5 (the procedure queries the index; `startAt` and the deep link need Phase 2's `HlsVideo` changes) → Phase 6 (extends Phase 4's feature; its e2e test uses Phase 5's search).
- Phase 7's T037 can start after Phase 3 and T038 after Phase 6. T039 to T042 come after Phase 6.
- Within Phase 1: T001, T002 and T003 in parallel.
- Within Phase 2: T004, then T005, then T006, then T007, then T008.
- Within Phase 4: T012, T013, T014, T015 and T016 in parallel, then T017, T018, T019, T020. T021 any time.
- Within Phase 5: T022, T023, T024 and T025 in parallel, then T026. T027, then T028. T029 and T030 after T026. T031 last.
- Within Phase 6: T032 and T033 in parallel (different files), then T034, T035, T036.

## Parallel examples

```text
Phase 1:  T001 (WebVTT parser)  ║  T002 (preference)  ║  T003 (e2e caption helper)
Phase 4:  T012 (playableVersion)  ║  T013 (index)  ║  T014 (stream filters)  ║  T015 (passages)  ║  T016 (actions)
Phase 5:  T022 (schema)  ║  T023 (watchable set)  ║  T024 (query)  ║  T025 (snippet)
Phase 7:  T037 (video player page)  ║  T038 (search page)
```

## Implementation strategy

- **MVP**: Phases 1 and 2, one PR. Learners read a video's transcript and jump to any line. No backend change.
- **Then**: Phase 3 (keyboard and following), a small PR on the same files.
- **Search**: Phase 4 (the index and indexer, invisible to users), then Phase 5 (search, the results page and opening a moment). Access is decided from the table in Phase 5, so it is correct before Phase 6 lands.
- **Then**: Phase 6 (lesson and module changes, the rebuild), and Phase 7's docs and the reviewer's manual checks before the last PR merges. Run the rebuild once per stage after Phase 6 deploys.
