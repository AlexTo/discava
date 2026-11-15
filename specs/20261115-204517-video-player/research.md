# Research: Video Player Upgrades

Each item: decision, rationale, alternatives. "Verify" items are what an implementer must confirm against the code or AWS docs before relying on them; a failed check changes the plan, so stop and report instead of improvising.

## R-1. Where the resume position lives

**Decision**: a new `videoPosition` entity in the core table, keyed `pk: userId`, `sk: courseId, lessonId, contentItemId` (as `itemCompletion`), with `positionSeconds`, `versionId`, `savedAt`. `videoUrl` reads it with one keyed get and returns `resumeAt`.

**Rationale**: per student, follows across devices, one keyed get on a request that already runs (no extra round trip from the browser). The version id makes replacement a read-time rule, so instructor-api never writes student records.

**Alternatives**: a field on `enrolment` (a hot, shared record that progress and other writers touch, with a 400 KB growth risk); `localStorage` (not across devices, fails the spec); a separate `getPosition` query (extra round trip before playback).

## R-2. Transcribe input (the main risk)

**Decision**: add an audio-only output group to the MediaConvert job template (`FILE_GROUP_SETTINGS`, MP4 container, one AAC audio description from `Audio Selector 1`, no video). `submitTranscodeJob` gives it a destination `s3://<uploadBucket>/transcribe-input/<nonce>` so the file is `transcribe-input/<nonce>.mp4`. The upload bucket is private, never behind CloudFront, and already expires objects after 2 days, so nothing extra to clean.

**Rationale**: the raw upload is deleted on completion and Transcribe reads only whole media files (MP4, WebM, WAV, MP3, FLAC, Ogg, AMR, M4A), not HLS segments. The raw upload may be a container Transcribe doesn't accept. One job means one event and one `ClientRequestToken`.

**Alternatives**: (a) keep the raw upload until captioning completes: couples deletion to a second event, and raw containers (MOV, MKV) may be unsupported by Transcribe; (b) a second audio-only MediaConvert job from `transcode-outcome` before deleting raw: isolates failure but needs a second event cycle and delays raw deletion; this is the fallback if verification below fails; (c) ffmpeg in Lambda: needs a layer and 100 MB inputs, against the managed-service direction.

**Verify (blocks the pipeline PR)**:
1. A job whose settings come from the template plus `CreateJob`'s own `Settings.OutputGroups` merges output groups as the plan assumes: how `submitTranscodeJob` supplies the HLS destination today shows the merge is by position or `Name`; the new group's destination must be supplied the same way. Read the AWS docs on job templates and settings overrides, and assert the exact `CreateJobCommand` input in `mediaconvert-client.test.ts`.
2. **A source video with no audio track must still transcode.** If an audio-only output with no audio makes the whole job fail, that regresses silent videos. This can only be proven on a deployed stage: it is a `(human)` task. If it fails, switch to alternative (b), which keeps the HLS job untouched.
3. The service role (`VideoTranscodePipeline.role`) can write to the upload bucket under `transcribe-input/` (it reads that bucket today, so this adds `PutObject`), including the bucket's KMS key when enabled.

## R-3. Who calls Transcribe, with which credentials, and how the event finds the item

**Decision**: `applyTranscodeOutcome` calls `StartTranscriptionJob` after the version is marked ready (best effort). `MediaFileUri` is the audio file; `LanguageCode` is the configured default (`en-US`, from the runtime config's `mediaConvert` entry beside the pipeline ARNs, so it is one place); `OutputBucketName` is the lesson media bucket and `OutputKey` is `courses/…/content-items/<id>/transcribe-output/<nonce>/` (outside `<nonce>/*`, so the signed cookies do not authorise it); `Subtitles: { Formats: ['vtt'] }`; tags `courseId`, `moduleId`, `lessonId`. The job name is `captions-<contentItemId>-<nonce>` (unique per version, within Transcribe's 200 character and character-set limits). Transcribe names the outputs `<jobName>.vtt` and `<jobName>.json` there (an `OutputKey` ending in `/` writes the JSON transcript beside the VTT). Students must not be able to fetch the JSON transcript, so Transcribe never writes under the cookie-authorised prefix: `transcribe-complete` copies the VTT to `<nonce>/captions/<trackId>.vtt` (the key stored on the track) and deletes both scratch objects. The scratch folder lives under the item's folder, so item deletion removes it too; a failed copy leaves it for the retry.

`transcribe-complete` (EventBridge `Transcribe Job State Change`, status `COMPLETED` or `FAILED`) gets only the job name and status, so it calls `GetTranscriptionJob` for the tags and the subtitle file location, then applies the outcome through `captionTracks` helpers, conditioned on the version's nonce.

**Rationale**: for `StartTranscriptionJob`, Transcribe reads input and writes output with the caller's own credentials, so the starting Lambdas (transcode-complete and the reconciler, which share `applyTranscodeOutcome`) get read on `transcribe-input/*`, write on the `transcribe-output/` prefix and the KMS key, plus `transcribe:StartTranscriptionJob` and `TagResource`. No data access role is needed for this API.

**Alternatives**: encoding ids in the job name (4 UUIDs plus a nonce nearly fills the 200 character limit and is brittle); a lookup index by job name (an index with no other user, which constitution V rules out).

**Verify**: the caller-credentials claim and the output naming, in the AWS Transcribe docs, before writing the policies; and the exact fields of the `Transcribe Job State Change` event detail. Then `(human)` on a deployed stage: one real video gets a `.vtt` in its folder.

## R-4. How the player gets captions across origins with cookies

**Decision**: the access answer lists tracks with plain CloudFront URLs under the version's folder. The player `fetch`es each with `credentials: 'include'` and attaches the result to the video as a `<track>` whose `src` is a blob URL.

**Rationale**: the cookies authorise `…/<nonce>/*`, and the distribution's response-headers policy already allows credentialed GET from the portal origins with `Access-Control-Allow-Credentials` and an explicit origin list (`media-bucket.ts`), because hls.js needs it. `fetch` with credentials is the same mechanism hls.js uses. A native `<track src>` cross-origin request needs `crossorigin="use-credentials"` on the video, and browsers differ in applying it to tracks.

**Alternatives**: `<track src>` directly with `crossorigin` on the video (less code, behavior varies); HLS subtitle renditions in `master.m3u8` (rewrites the manifest, and Transcribe doesn't produce them); signed per-file URLs (a second signing path where the cookie scope is enough).

**Local dev**: no cookies; S3Mock refuses credentialed cross-origin requests (see `withCredentials` in `VideoUrlOutputSchema`), so the player uses `credentials: 'include'` only when `withCredentials` is true, as `HlsVideo` does for hls.js.

**Verify**: a track fetch sets no `Range` request header that the policy forbids (the policy allows `range` and `content-type`).

## R-5. Tracks on the content item, not their own entity

**Decision**: `captionTracks` is a list attribute on the `contentItem` (at most 5 entries, each: `trackId`, `nonce`, `language`, `label`, `source`, `key`, `isDefault`), with `captionTracksRev` (a counter) and `captionsStatus` (+ `captionsPendingSince`).

**Rationale**: tracks are read with the item every time `videoUrl` runs, are at most 5, and are replaced as a set along with the version. A separate entity would add a query to every playback for no benefit. A `captionTracksRev` condition makes concurrent writers (Transcribe's completion, two instructors, a version swap) resolve to one winner each time without a transaction.

**Alternatives**: one record per track (a query per playback, and the five-track and one-default rules would then need a transaction); overwriting the whole item without a rev (lost updates).

## R-6. Why positions are not "student records"

**Decision**: `videoPosition` is not added to `studentRecords` or `checkStudentRecordsHaveTargets`/`…PlacedWithItem`, and does not count as student activity.

**Rationale**: those checks assume a student record can't outlive its item, which holds because deleting an item is refused while a student has activity. Making a position count as activity would stop an instructor deleting any video a student had watched, which the spec does not want. Orphan positions after a deletion are harmless, since nothing reads them without the item. The new `video-position-valid` invariant checks their shape only.

**Alternatives**: delete positions with the item (needs every student's key, so a scan or a new index just for this); count as activity (changes what the count means, per the impact check).

## R-7. The control bar

**Decision**: build it from existing shadcn primitives (`Button`, `Slider`, `DropdownMenu`) in `common-shadcn`, with the media element as the single source of truth: component state mirrors `timeupdate`, `volumechange`, `ratechange`, `play` and `pause` events. Keyboard handling is one `onKeyDown` on the player container, using the pure key-to-action map from `video-player.ts`, and ignores events from inputs or with modifier keys.

**Rationale**: the pure map and the reducers are unit-testable without a DOM; the component tests then only check wiring. jsdom has no media playback, so tests replace `HTMLMediaElement`'s `play`, `pause`, `currentTime`, `duration`, `volume`, `playbackRate` and `textTracks` with stubs.

**Alternatives**: a player library (a dependency to keep current, and its own accessibility story); keeping native controls and bolting on a speed menu (no consistent captions or shortcuts across browsers).

**Constraint**: buttons carry text labels only, with no arrow icons: skip and seek controls use "10 s" style text or non-arrow icons with accessible names.

## R-8. Concurrency tests

**Decision**: no `packages/e2e/src/concurrency/` test for positions (one student's own record, last write wins, by design). One concurrency test for captions: two instructors attach a track for the same language at once; exactly one wins, the loser gets `CONFLICT`, and the invariants hold. It is cheap because the rule is a single conditional write on `captionTracksRev`.

**Rationale**: constitution IV says a write two users could race on SHOULD add one; only the track write qualifies.

## R-9. Local stand-in for Transcribe

**Decision**: `POST /transcription-jobs` on the event runner, with the same fields the real call has (job name, output bucket and key, tags). It writes a small placeholder WebVTT (`WEBVTT`, one cue "Captions are generated by Amazon Transcribe when deployed.") to S3Mock at the same output location, then calls the same `applyTranscribeOutcome` function the real handler does, as `trigger-events.ts` does for transcodes. The local transcoder needs no audio output.

**Rationale**: exercises everything except recognition, and lets e2e check the toggle and a default track. A speech model in Docker would add gigabytes and minutes for no coverage the unit tests lack.

## R-10. Replacing and removing a track's file

**Decision**: after the conditional write commits, delete the replaced file best effort, immediately. A player that fetched the track list just before might get a 404 for it and simply shows no captions until reload. Files from a lost race or a crash sit in the version's folder and go with it when the version is retired.

**Rationale**: caption files carry no signed link to honor (unlike submission downloads), so there's no grace period to keep, and the retirement scheduler would add machinery for a harmless leftover.

## R-11. Status when an event never arrives

**Decision**: `captionsPendingSince` is set with `captionsStatus: pending`. APIs report a pending status older than 2 hours as `failed` (computed on read, no write). No reconciler change.

**Rationale**: the instructor can always upload a track by hand (FR-023); a reconciler for a best-effort extra isn't worth its permissions and schedule.

## R-12. Throttle and cost

`saveVideoPosition` is about one write per 10 s per watching student. DynamoDB on-demand cost is small and well under API Gateway's default throttle for typical classes (see Technical Context); a stage can raise `throttleRateLimit` if a course needs more. The client skips a save when the position changed by under a second since the last one.
