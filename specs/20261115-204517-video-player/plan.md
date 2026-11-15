# Implementation Plan: Video Player Upgrades

**Branch**: `spec/video-player` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261115-204517-video-player/spec.md`

## Summary

Four additions to the lesson video player, delivered as separate PRs (see [tasks.md](./tasks.md)):

1. **Player**: a custom, accessible control bar in `@discava/common-shadcn` replaces the native controls of `HlsVideo`, with speed, volume, shortcuts and a captions menu. Its pure logic (shortcut map, speed steps, preference storage, save throttle, caption languages) lives in `@discava/common-web-utils/video-player`, which both portals share.
2. **Resume**: a new `videoPosition` entity (one per student per video item) written by a core-api mutation, and read back inside `contentItem.videoUrl` as `resumeAt`. No instructor-side write is needed when a video is replaced: the record names the version it was saved for, and a mismatch is ignored.
3. **Captions pipeline**: after a transcode completes, an Amazon Transcribe job is started on an audio-only copy the MediaConvert job already wrote, and writes WebVTT beside the video's HLS output. A new `transcribe-complete` event handler records the track on the content item. Tracks live on the content item, keyed to a video version.
4. **Instructor captions**: instructor-api procedures to upload (presigned PUT into the upload bucket, server-side validated copy into the version's folder), replace and remove tracks, plus caption status in the portal.

Three things the code showed that the spec could not:

1. **The raw upload is deleted when the transcode completes** (`applyTranscodeOutcome`), and Transcribe cannot read HLS `.ts` output. So Transcribe needs its own input. The plan adds an audio-only MP4 output group to the same MediaConvert job (written to the private upload bucket, which already expires objects after 2 days), instead of a second job or keeping the raw file longer. This is the plan's main risk (research R-2).
2. **CloudFront access already covers captions.** The signed cookies for a video are scoped by a custom policy to `courses/…/content-items/<id>/<nonce>/*`, and the distribution's CORS policy already allows credentialed GET from the portal origins (for hls.js). Captions stored under `<nonce>/captions/` are therefore authorised by the cookies `videoUrl` already sets. No new cookie scope, no new distribution behavior.
3. **`checkStudentRecordsHaveTargets` assumes a student record can't outlive its item**, because deletion is refused while a student has activity. A resume position is deliberately not student activity (spec Clarifications), so a deleted video can leave positions behind. They are harmless and are not added to the student-record lists; the invariant for them checks only their own shape (data-model.md).

## Technical Context

**Language/Version**: TypeScript (Node 24 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `hls.js` (existing), `@aws-sdk/client-transcribe` (new, in `packages/events`), `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/cloudfront-signer`, TanStack Router/Query, shadcn, Testing Library, CDK

**Storage**: the core table (new `videoPosition` entity; new caption attributes on `contentItem`); lesson media bucket (captions); lesson media upload bucket (audio for Transcribe, instructor caption uploads); browser `localStorage` for preferences

**Testing**: vitest (units, with the `@discava/core-table` alias per project), Testing Library in jsdom for the player (media element mocked), core-table invariants, Playwright e2e in `packages/e2e`

**Target Platform**: AWS Lambda + API Gateway + CloudFront + MediaConvert + Transcribe (deployed); `pnpm dev` with Docker (local)

**Project Type**: web application: serverless backend + two React portals

**Performance Goals**: a position save is one small keyed write about every 10 s per watching student; API Gateway's default throttle (100 req/s per method) covers about 1,000 students watching at once, and the save is best effort so a throttled save only loses resume accuracy. Captions appear within 15 minutes of a video becoming ready (Transcribe typically takes a fraction of the video's length).

**Constraints**: no second table; keys or a declared index only; CloudFormation 500-resource cap (new resources go in the `MediaPipeline` stack, a rule, a Lambda and a few policies); captions never gate readiness; no backward compatibility code

**Scale/Scope**: one position record per student per video watched; at most 5 tracks per video, 1 MB each

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Transcribe, MediaConvert, EventBridge, Lambda, S3, CloudFront |
| II. Generators first | Pass | The new events handler `transcribe-complete` is created with the repo's Lambda-function generator for `packages/events` (the one behind `transcode-complete`, listed in `packages/events/project.json`), which also writes the `EventsTranscribeComplete` wrapper in `constructs/lambda-functions/`. Confirm the generator and its options with the `nx-plugin-for-aws` MCP (`generator-guide`) at task time. No new project. The player control bar is added to existing packages by hand: shadcn components are copied in, not generated |
| III. Everything runs locally | Pass, with a justified stand-in limit | The event runner gains a transcription stand-in (`POST /transcription-jobs`) that writes a placeholder WebVTT to S3Mock and reports completion through the same code the real event uses. Real speech recognition does not run locally (it would need a speech model image); quickstart and CONTRIBUTING list it under "what only runs on dev" |
| IV. Layered tests | Pass, planned | Unit tests per procedure, helper and handler; two new invariants with breaking tests; the existing video-state invariant extended; a `video.e2e.ts` extension; component tests for the controls. Concurrency: see research R-8 |
| V. Single-table via ElectroDB | Pass | One new entity (`videoPosition`) and new attributes on `contentItem`; every access is a keyed get or a keyed query (data-model.md). No new index. `PROGRESS_STREAM_FILTERS` and `SEARCH_STREAM_FILTERS` are checked, with tests that a position write or a caption write does not trigger them (search reacts to `course` only) |
| VI. Secure by default | Pass | Captions served only under the video's own signed-cookie prefix; instructor uploads presigned, bound to size and type, then re-validated server side; Transcribe and handler policies are scoped to the prefixes they use; the new Lambda gets its own least-privilege role |
| VII. Change freely before launch | Pass | `videoUrl`'s output and the content item schemas change outright; no fallbacks. The player drops the native controls outright. Development data is fixed by hand |
| VIII. Repo conventions | Pass | Non-UI shared code in `common-web-utils`; core-table logic in `helpers/video-position.ts` and `helpers/caption-tracks.ts`; shared server code in `common-server-utils`; text-only buttons (no arrow icons; the seek and skip controls use text or non-arrow icons); English docs only, translations noted pending |

No violations, so Complexity Tracking is empty.

**Re-check after design:** still passing. The judgment calls are research R-2 (an extra MediaConvert output instead of a second job) and R-4 (fetching caption files with credentials and attaching them as blob tracks).

## Impact check (constitution IV)

Shared records this feature writes or reads in a new way:

| Record | How | Existing invariants and tests that cover it | Added or extended |
|--------|-----|---------------------------------------------|-------------------|
| `contentItem` (video) | Written by `transcode-complete`, the reconciler, `transcribe-complete` and instructor-api: `captionTracks`, `captionTracksRev`, `captionsStatus`, `captionsPendingSince`. Read by core-api and instructor-api `videoUrl` | Invariant 6 (a video's transcode state is consistent, in `helpers/invariants.ts`) and its test; `content-item.test.ts`; `transcode-complete.test.ts` | Extend invariant 6 so caption fields exist only on video items and `captionsStatus: pending` only on a ready one (task and breaking test); new invariant `caption-tracks-valid` (at most 5, one per language, exactly one default when non-empty, keys inside the item's own folder for the track's nonce) with a breaking test; `transcode-complete` tests extended for the swap discarding old-version tracks |
| `videoPosition` (new) | Written by core-api only; read by core-api only | None yet | New invariant `video-position-valid` (finite, non-negative, whole seconds, within the cap, has a version) with a breaking test. Not added to `studentRecords`, `checkStudentRecordsHaveTargets` or `checkStudentRecordsPlacedWithItem` (research R-6) |
| `studentActivityCount`, `itemCompletion`, progress | Not written, not read in a new way | Invariants 2 and 4 | None. A test in core-api asserts `saveVideoPosition` writes neither, and `progress-stream.test.ts` asserts a `videoPosition` stream record matches no progress filter |

## Design Decisions (detail in [research.md](./research.md))

1. **Resume record carries the version.** `videoPosition` holds `versionId` (the played manifest's nonce). `videoUrl` returns `resumeAt` only when the stored `versionId` matches the version being played, so replacing a video resets everyone's position with no write. `core-table`'s `helpers/video-position.ts` owns the rules (validity, start-over threshold, cap) so the API procedure and the invariant agree.
2. **Start-over rule runs on write.** The client sends `positionSeconds` and `durationSeconds`; within 10 s of the end or past 95% the stored position is 0. The server trusts neither beyond validity (finite, whole seconds, caps), since the position is only ever the student's own.
3. **Preferences stay in the browser.** `common-web-utils/video-player` reads and writes `localStorage` inside try/catch and falls back to defaults.
4. **Captions are attached to a video version.** Each track holds the `nonce` of the version it belongs to. `videoUrl` returns the tracks whose nonce matches the played manifest. A replacement's swap (in `applyTranscodeOutcome`) removes the tracks of other nonces in the same write that makes the new version ready; the old folder, files and all, is deleted by the existing delayed cleanup.
5. **All caption writes go through one helper.** `core-table`'s `helpers/caption-tracks.ts` is a pure function `applyCaptionChange(current, change)` plus the conditional-write builder (conditioned on `captionTracksRev` and the version's nonce). The events handlers and instructor-api's three procedures all call it, so the one-per-language, five-track and default rules cannot drift.
6. **Transcribe input is an audio-only output of the same MediaConvert job**, written to `transcribe-input/<nonce>.mp4` in the upload bucket, so nothing depends on keeping the raw upload. After `COMPLETE`, `applyTranscodeOutcome` sets `captionsStatus: pending` (conditionally on the version) and starts the Transcribe job, best effort: a failure to start sets `failed` and never undoes readiness.
7. **Transcribe writes to a scratch folder outside the cookie prefix** (`…/<id>/transcribe-output/<nonce>/`), because it also writes a JSON transcript that students must not fetch. `transcribe-complete` copies the VTT to `…/<nonce>/captions/<trackId>.vtt`, authorised by the cookies the video already uses, and deletes both scratch files. The job's tags carry course, module and lesson ids, so `transcribe-complete` can find the item from the event's job name.
8. **Player fetches captions with credentials and attaches them as blob tracks.** The caption URLs are plain CloudFront URLs under the cookie prefix; the player `fetch`es them with `credentials: 'include'` (the distribution already allows credentialed CORS) and adds `<track>` elements pointing at blob URLs, which removes any doubt about how browsers send cookies for `<track>` requests.
9. **Uploaded tracks get a random file name** (`<trackId>.vtt`) per upload, so a replaced track is a new URL and caches can't serve stale text.
10. **No new API Gateway function.** `saveVideoPosition` needs only the table, so it joins the shared core-api router; `videoUrl` stays a dedicated function and gains only a table read it already has. Instructor-api gets three procedures; the attach procedure needs S3 on both buckets, so it joins instructor-api's existing media-capable functions (confirmed at task time against `INSTRUCTOR_API_DEDICATED_FUNCTIONS`-style config).

## Player states

The full state table is in [contracts/player-ui.md](./contracts/player-ui.md). Summary: loading, pending/failed (existing alerts), ready, resumed notice, captions available/none/loading, error loading a track (video unaffected).

## Project Structure

### Documentation (this feature)

```text
specs/20261115-204517-video-player/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-video.md
│   ├── instructor-api-captions.md
│   └── player-ui.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (touched, repository root)

```text
packages/common/web-utils/src/video-player.ts (+ .test.ts)         # new: shortcuts, speeds, preferences, throttle, languages
packages/common/shadcn/src/components/hls-video.tsx                # rebuilt: HlsVideo gains the control bar
packages/common/shadcn/src/components/video-controls.tsx (+ test)  # new: the control bar
packages/databases/core-table/src/entities/video-position.ts       # new entity (+ index.ts, service.ts)
packages/databases/core-table/src/entities/content-item.ts         # caption attributes
packages/databases/core-table/src/helpers/video-position.ts (+test)
packages/databases/core-table/src/helpers/caption-tracks.ts (+test)
packages/databases/core-table/src/helpers/invariants.ts (+test)    # new and extended checks
packages/databases/core-table/src/helpers/progress-stream.test.ts  # position records match no filter
packages/apis/core-api/src/procedures/content-item.ts              # videoUrl output, saveVideoPosition
packages/apis/core-api/src/schema/content-item.ts, lib/playback.ts
packages/apis/instructor-api/src/procedures/content-item-captions.ts (+test)   # new
packages/apis/instructor-api/src/procedures/content-item-video.ts  # createVideoUrl output
packages/apis/instructor-api/src/schema/content-item.ts, router.ts
packages/common/server-utils/src/captions.ts (+test)               # key builders, WebVTT validation, language list
packages/events/src/media/transcode-outcome.ts                     # start captions, swap discards tracks
packages/events/src/media/transcribe-complete.ts, transcribe-outcome.ts (+tests)  # new handler
packages/events/src/lib/transcribe-client.ts                       # start job, local stand-in switch
packages/events/src/local/transcriber.ts, event-runner-server.ts   # local stand-in
packages/common/server-utils/src/local-dev.ts                      # LocalTranscriptionJobRequest
packages/apis/instructor-api/src/lib/mediaconvert-client.ts        # audio output destination
packages/common/constructs/src/app/media-convert/video-transcode-pipeline.ts   # audio group in the template
packages/common/constructs/src/app/lambda-functions/events-transcribe-complete.ts  # generator-owned
packages/infra/src/stacks/media-pipeline-stack.ts                  # rule, Lambda, Transcribe and S3 policies
packages/websites/student-portal/.../content-item.tsx, use-course-player.ts
packages/websites/instructor-portal/.../attach-lesson-video-dialog.tsx and the video row/preview, new captions dialog
packages/e2e/src/scenarios/video.e2e.ts
docs/src/content/docs/en/…, CONTRIBUTING.md, CLAUDE.md
```

**Structure Decision**: no new package. Shared pure code goes to `common-web-utils`, shared server code to `common-server-utils`, table code to `core-table/helpers`.

## Complexity Tracking

None.
