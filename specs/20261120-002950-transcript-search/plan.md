# Implementation Plan: Transcript Panel and Transcript Search

**Branch**: `20261120-002950-transcript-search` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261120-002950-transcript-search/spec.md`

## Summary

Two things for a learner, built on the caption tracks every video already has.

**A transcript panel.** The shared player already downloads each caption file as text. A new shared parser turns it into cues, and a new `TranscriptPanel` beside the player lists them, highlights the one being spoken, keeps it in view and seeks when one is chosen. It follows the caption track chosen in the player. No API, index or stored data is involved, so it ships first.

**Search across a course's transcripts.** A new `transcripts` index in the existing OpenSearch collection holds 30-second passages of every caption track of every watchable video. A new stream feature, `transcript-indexing`, keeps it in step by re-reading an item whenever its captions, version or visibility change, or its lesson's or module's visibility does. A new signed-in core-api query, `transcript.search`, checks the caller's enrolment, builds the set of videos they can watch from the table, and queries only those. Results are moments (lesson, video, time, marked text) on a new results page in the course player, and a result opens the lesson at that video and time through two new address params.

Nothing is written to the core table.

## Technical Context

**Language/Version**: TypeScript (Node 24 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC and zod (`@discava/core-api`), `@opensearch-project/opensearch` through `@discava/search`, ElectroDB through `@discava/core-table`, `@aws-sdk/client-s3` (already in `packages/events`), Powertools and middy (stream handler), TanStack Router and Query (student portal), `@discava/common-shadcn` (`HlsVideo`, `VideoControls`), `@discava/common-web-utils` (`video-player`, new `webvtt`). No new runtime library: the WebVTT parser is about a hundred lines of our own (R-10).

**Storage**: One new OpenSearch index, `transcripts` ([data-model.md](./data-model.md)), in the existing collection. No core-table change. Caption files are read from the lesson media bucket.

**Testing**: vitest unit tests (parser, passage builder, stream actions, item sync with OpenSearch, S3 and the table mocked as `search-indexing.test.ts` does, the query builder, the snippet builder, the procedure's every refusal), component tests in jsdom (`common-shadcn`, student portal with `renderWithCoreApi`), CDK assertions and `synth`, and a new Playwright scenario, `packages/e2e/src/scenarios/transcript.e2e.ts`, with `screenshot()`.

**Target Platform**: AWS Lambda (core-api behind API Gateway; an SQS-fed stream feature handler; a private rebuild Lambda), OpenSearch Serverless (NextGen), S3. Locally, `pnpm dev` with the OpenSearch container, S3Mock, ElasticMQ and the event runner.

**Project Type**: Web application: a serverless backend plus React portals.

**Performance Goals**: Search results within 2 s for 95% of searches with search warm, in a course of 200 videos (SC-004). A caption or visibility change searchable within 1 minute for 95% of changes (SC-006). The highlighted line no more than one line behind speech (SC-002).

**Constraints**:
- Transcript text reaches a caller only after `requireEnrolment` and only for videos in the watchable set built from the table on that request (R-4).
- The indexer reads the table and S3 and writes only OpenSearch. It never writes the table and never fails a writer.
- Every sync is idempotent and order-insensitive.
- No change to the `courses` mapping, so no stage's course index is touched (R-8).
- Keyboard and screen-reader operable, and no horizontal scrolling at 375 px (R-11).
- Works under `pnpm dev`.

**Scale/Scope**: One index definition, one stream feature with its handler, wrapper and stack wiring, one rebuild Lambda and script, one procedure with three helpers, one shared parser, one shared panel component with changes to two player components, one portal route with two components and changes to three, one e2e scenario, and sections on three design pages. About 130 documents per hour of video per track.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | The existing OpenSearch Serverless collection, DynamoDB stream, SQS, Lambda and S3. No new service |
| II. Generators first | Pass | The two new Lambda wrappers (`EventsTranscriptIndexing`, `EventsTranscriptReindex`) are made with `ts#lambda-function`, as every `events-*` wrapper is. The index definition is hand-written with `createIndex`, as `courses` is: `@aws/nx-plugin` has no OpenSearch generator yet (the Search design page tracks awslabs/nx-plugin-for-aws#1267). A tRPC procedure, a React component and a route have no generator |
| III. Everything runs locally | Pass | Local OpenSearch gets the index from the `opensearch` target's index sync. The handler joins `HANDLERS`, so the event runner runs it against S3Mock and ElasticMQ. The rebuild script runs in-process locally. Real Transcribe output stays deployed-only, as today |
| IV. Layered tests | Pass, planned | Unit tests for every new function and every refusal of `transcript.search`. Duplicate and reordered delivery tests for the feature, as the stream router page requires. Component tests for the panel and the results. A new e2e scenario for a learning flow. Invariants: none applies, see the impact check |
| V. Single-table via ElectroDB | Pass | No entity, attribute or index. Access patterns are in [data-model.md](./data-model.md): keys and key ranges only. The one walk over every course is `byStatus` in the rebuild, which is admin tooling. `STREAM_FEATURES` gains a feature and no existing registration changes |
| VI. Secure by default | Pass | `transcript.search` is behind the Cognito authorizer and the default throttle, not in `PUBLIC_OPERATIONS`. Access is re-derived from the table per request. Query text is never parsed as syntax. Snippets and panel lines are plain text. The indexer's role gets read-only access to the table and the lesson media bucket. The index lives in the collection's existing encryption and network policies |
| VII. Change freely before launch | Pass | `playableManifest` moves to `common-server-utils` with its import sites changed outright. The lesson route gains params with no redirect. The new index is filled on a stage by one rebuild run, not a migration |
| VIII. Repo conventions | Pass | Helpers in `helpers/` (`core-api/src/helpers/transcript-*.ts`), handlers beside `search-indexing.ts`, the shared parser as a `common-web-utils` module, the panel in `common-shadcn`, route-private components in `-components/`. Text-only buttons. Screenshots in e2e. English docs, with translations noted as pending |

**Impact check (constitution IV).** The feature writes no shared record. It reads these in a new way:

| Record | New read | Existing checks that cover what it relies on | Extended? |
|--------|----------|----------------------------------------------|-----------|
| `contentItem` (`captionTracks`, `status`, `s3Key`, `previousS3Key`, `visibility`, `archivedAt`) | The indexer and `transcript.search` decide what is watchable and which tracks are current | `caption-tracks.test.ts` (`applyCaptionChange`, `tracksForPlayback`), the `caption-tracks-valid` invariant (`helpers/invariants/media.ts`), `content-item.test.ts` (`videoUrl`'s refusals) | No change to what any attribute means. `playableManifest`'s tests move with it (T012) |
| `lesson`, `module` (`visibility`, `archivedAt`) | Same | `curriculum.test.ts` (`isShown`, `filterEffectivelyVisible`), the `curriculum` invariants | No |
| `enrolment` | `transcript.search` calls `requireEnrolment` | `enrolment.test.ts`, the enrolment invariants | No |
| `course` | Curriculum read; `byStatus` in the rebuild | none needed | No |

No invariant is added: an invariant checks the core table, and the index isn't in it. What stands in for one is the sync's own tests (the index equals the watchable state after any order of changes), `transcript.search`'s refusal tests, and the rebuild, whose second run must remove nothing. `stream-features.test.ts` gains the routing cases for the new feature, and asserts the existing features' routing is unchanged (T019). `entity-writers.json` doesn't change, since nothing new writes the table.

**Weakened or changed tests (constitution IV).** None is weakened. Three existing test files change because code moves or a prop is added, with their assertions kept:
- `packages/apis/core-api/src/helpers/playback.test.ts`: the `playableManifest` cases move to `common-server-utils/src/media-keys.test.ts` unchanged (T012).
- `packages/common/web-utils/src/video-player.test.ts`: the expected default preferences gain `transcriptOpen: false` (T002).
- `packages/infra` and `common-constructs` snapshots gain the new queue, functions and grants (T020, T034).

Each task names its change, and the PR repeats it.

## Design Decisions (detail in [research.md](./research.md))

1. **A separate `transcripts` index** in the same collection (R-1). The public `courses` index is untouched.
2. **A document is a passage**: cues windowed to 30 s or 600 characters, overlapping by one cue, with each cue's offset stored so a hit maps to a cue's start time through whole-passage highlighting (R-2).
3. **A stream feature re-reads the item** on caption, version and visibility changes and makes the index match, with ids built from the record so any delivery order converges (R-3).
4. **Access from the table on every search**: enrolment, then the watchable set as the query's filter, then a version and track check on each hit (R-4).
5. **Every track indexed, one searched per video**: the learner's caption language, else the default (R-5). `standard` text with an `english` sub-field.
6. **A rebuild Lambda** for the first fill, repairs and later mapping changes (R-6).
7. **No new capacity**: the existing NextGen collection and stage limits (R-7).
8. **#270 isn't needed and isn't blocked**: a new index is index-sync's create path, and every caller resolves the name in one place (R-8).
9. **The tutor (#289) gets passages and the access helpers**, and vector retrieval is left for it to decide (R-9).
10. **The panel is built in the browser** from the caption text the player already has, with one parser shared with the indexer (R-10).
11. **A list of buttons with a roving tab stop**, outside the player's shortcut scope, that pauses following when the learner takes over (R-11).
12. **A moment is an address**: `?item=…&t=…` on the lesson route, opened paused (R-12).
13. **A results page in the course player**, searched on submit (R-13).

## Project Structure

### Documentation (this feature)

```text
specs/20261120-002950-transcript-search/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-1 to R-13
├── data-model.md        # Phase 1: the transcripts index, the records read, access patterns
├── quickstart.md        # Phase 1: how to check it by hand
├── contracts/
│   ├── core-api-transcript-search.md   # transcript.search input, output, steps, request
│   ├── transcript-indexing.md          # the stream feature, the item sync, the rebuild
│   ├── transcript-panel-ui.md          # HlsVideo props, panel states, keyboard, ARIA
│   └── transcript-search-ui.md         # search box, results route, opening a moment
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/common/web-utils/src/
├── webvtt.ts                         # new: parseWebVtt, activeCueIndex, TranscriptCue (+ ./webvtt export)
├── webvtt.test.ts                    # new
├── video-player.ts                   # + transcriptOpen preference
└── video-player.test.ts              # + its cases

packages/common/shadcn/src/components/
├── transcript-panel.tsx              # new
├── transcript-panel.test.tsx         # new
├── hls-video.tsx                     # + transcript, startAt; cues on loaded captions; layout wrapper
├── hls-video.test.tsx                # + cases
├── video-controls.tsx                # + "Transcript" button, reports the track to show
└── video-controls.test.tsx           # + cases

packages/common/server-utils/src/
├── media-keys.ts                     # + playableManifest (moved), playableVersion
└── media-keys.test.ts                # + their cases (moved)

packages/databases/search/src/indices/
├── transcripts.ts                    # new: TranscriptDocumentSchema, mapping
├── transcripts.test.ts               # new
└── index.ts                          # INDICES += transcriptsIndex

packages/databases/core-table/src/helpers/
├── transcript-stream.ts              # new: TRANSCRIPT_STREAM_FILTERS, matcher
├── transcript-stream.test.ts         # new
├── stream-features.ts                # + the transcript-indexing registration and matcher
└── stream-features.test.ts           # + routing cases

packages/events/src/search/
├── transcript-document.ts            # new: buildPassages, toTranscriptDocuments
├── transcript-document.test.ts       # new
├── transcript-actions.ts             # new: transcriptActionOf(record)
├── transcript-actions.test.ts        # new
├── transcript-sync.ts                # new: syncItemTranscripts, deleteTranscriptsBy, indexed ids
├── transcript-sync.test.ts           # new
├── transcript-indexing.ts            # new: the feature's handler
├── transcript-indexing.test.ts       # new, with duplicate and reordered delivery
├── transcript-reindex.ts             # new: the rebuild Lambda
└── transcript-reindex.test.ts        # new
packages/events/src/router/handlers.ts          # HANDLERS += 'transcript-indexing'
packages/events/src/local/transcript-feature.test.ts   # new: the feature through the local runner
packages/events/rolldown.config.ts              # + the two bundles (written by the generator)

packages/common/constructs/src/app/lambda-functions/
├── events-transcript-indexing.ts     # new, generated
├── events-transcript-reindex.ts      # new, generated
└── index.ts                          # exports them

packages/infra/src/stacks/
├── stream-router-stack.ts            # + createTranscriptIndexingLambda, createTranscriptReindexLambda, lessonMediaBucket prop
packages/infra/src/stages/application-stage.ts   # passes lessonMediaBucket to StreamRouterStack

packages/tooling/deploy/
├── src/infra/reindex-transcripts.ts  # new
└── project.json                      # + reindex-transcripts target

packages/apis/core-api/src/
├── init.ts                           # + courseSearchProcedure
├── schema/transcript.ts              # new: input and output schemas (exported from schema/index.ts)
├── helpers/transcript-access.ts      # new: watchableVideos
├── helpers/transcript-query.ts       # new: buildTranscriptSearchRequest
├── helpers/transcript-snippet.ts     # new: transcriptSnippet
├── helpers/transcript-*.test.ts      # new, one per helper
├── helpers/playback.ts               # playableManifest removed (moved)
├── procedures/transcript.ts          # new: searchTranscripts
├── procedures/transcript.test.ts     # new
├── procedures/search.ts              # mapSearchError exported
├── procedures/content-item.ts        # imports playableVersion from common-server-utils
├── helpers/course-preview.ts         # imports playableManifest from common-server-utils
└── router.ts                         # transcript: { search }

packages/websites/student-portal/src/routes/learn/$courseId/
├── search.tsx                                    # new route
├── -search.test.tsx                              # new
├── lesson/$lessonId.tsx                          # + validateSearch { item, t }
├── -components/transcript-search-box.tsx         # new
├── -components/transcript-search-results.tsx     # new
├── -components/transcript-search-*.test.tsx      # new
├── -components/course-player.tsx                 # header renders the search box
├── -components/lesson-page.tsx                   # scrolls to the item, passes startAt
└── -components/content-item.tsx                  # VideoPlayer passes transcript and startAt

packages/e2e/src/
├── helpers/captions.ts               # + a multi-cue WebVTT builder
├── helpers/student-portal.ts         # + openTranscript, searchTranscripts
└── scenarios/transcript.e2e.ts       # new

docs/src/content/docs/en/design/
├── video-player.mdx                  # + "Transcript" section, second "Spec" link
├── search.mdx                        # + "Transcript search" section, scope and packages tables
└── stream-event-router.mdx           # + the feature's queue in the metrics list
```

**Structure Decision**: The parser goes in `common-web-utils` because the player (`common-shadcn`) and the indexer (`packages/events`, which already imports `caption-languages` from there) both need it and it is plain text handling. The panel goes in `common-shadcn` beside the player it belongs to, behind an opt-in prop, so the instructor preview is untouched and can turn it on later with one prop. The passage builder stays in `packages/events`, its only user. The access helpers stay in core-api, the only API that serves learners. The rebuild Lambda is built in `StreamRouterStack` beside the indexer, not in `CoreApiStack` beside `SearchReindex`, because it needs the same bucket grant and that stack is the one with resource headroom. The search box, results and deep link stay in the student portal: no other portal has a course player.

## Rollout

Each implementation PR leaves `main` working ([tasks.md](./tasks.md)):

1. The parser and the panel (no backend).
2. Keyboard, screen-reader and following refinements to the panel.
3. The index and the indexer. Nothing reads the index yet.
4. `transcript.search`, the results page and opening a moment. Safe without step 5: access never depends on the index being current.
5. Lesson and module visibility in the indexer, and the rebuild.
6. Docs and the reviewer's manual checks.

After step 3 deploys to a stage, existing videos aren't in the index until step 5's rebuild is run once on that stage (or a caption is re-saved).

## Complexity Tracking

No violations to justify.
