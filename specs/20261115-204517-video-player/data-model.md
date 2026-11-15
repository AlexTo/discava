# Data Model: Video Player Upgrades

All records are in the one core table (constitution V). Access patterns first, then the records.

## Access patterns

| # | Pattern | Served by |
|---|---------|-----------|
| 1 | A student's saved position for one video | `videoPosition` primary key get (`userId`; `courseId`, `lessonId`, `contentItemId`). Done inside `videoUrl`, alongside the item reads it already makes |
| 2 | Save a student's position | `videoPosition` put/upsert on the same key |
| 3 | A video's tracks and caption status | Already read with the `contentItem` in `videoUrl` (core-api and instructor-api): no extra read |
| 4 | Find the item a finished Transcribe job belongs to | `GetTranscriptionJob` tags give course, module and lesson ids; `contentItem` primary key (existing) |
| 5 | Change a video's tracks | `contentItem` conditional patch (existing key) |

No scans, no new index.

## videoPosition (new entity, `entities/video-position.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `userId` | string, key | pk. From the caller's token, never from input |
| `courseId`, `lessonId`, `contentItemId` | string, key | sk composite, as `itemCompletion` |
| `moduleId` | string | Not part of the key; copied from the item |
| `positionSeconds` | number | Whole seconds, 0 to the cap (86,400). 0 means "start over" |
| `versionId` | string | The nonce of the manifest the student played (`manifestNonce`) |
| `savedAt`, `createdAt`, `updatedAt` | string | ISO timestamps |

Rules (in `helpers/video-position.ts`, used by the procedure and the invariant):

- `positionSeconds` is finite, a whole number, at least 0 and at most the cap. The client's value is floored.
- `videoPositionToStore(positionSeconds, durationSeconds)` returns 0 when `durationSeconds - positionSeconds <= 10` or `positionSeconds / durationSeconds >= 0.95`; a video of 10 seconds or less is "finished" only at its end.
- `resumeAt(record, playedVersionId)` returns the stored seconds when `record.versionId === playedVersionId`, else 0.

Lifecycle: created on the first save; overwritten by each save (last write wins); never deleted by this feature. It does not touch `studentActivityCount`, `itemCompletion` or progress, and it is not in `studentRecords`.

## contentItem (video), new attributes

| Attribute | Type | Notes |
|-----------|------|-------|
| `captionTracks` | list of map, at most 5 | Each: `trackId` (uuid), `nonce` (the version it belongs to), `language` (BCP 47 tag from the shared list), `label`, `source` (`auto` or `uploaded`), `key` (S3 key in the media bucket), `isDefault` |
| `captionTracksRev` | number | Starts 0, incremented by every write to `captionTracks`; the condition that serialises writers |
| `captionsStatus` | `pending`, `ready`, `failed` | For the played version's automatic captioning. Absent on a video not yet ready and on non-video items |
| `captionsPendingSince` | string | Set with `pending`, removed with it |

Rules (in `helpers/caption-tracks.ts`, `applyCaptionChange(current, change)`; every writer calls it):

- At most 5 tracks; at most one per language per nonce. Adding for an occupied language replaces that track.
- An `auto` track never replaces an `uploaded` track of the same language (an instructor's upload may land before Transcribe finishes); the late auto result is dropped and logged, and the status still becomes `ready`. An `uploaded` track always replaces an `auto` one.
- Exactly one `isDefault` when the list for a nonce is non-empty: the auto track when it exists; a replacement inherits the replaced track's flag; removing the default promotes the oldest remaining track.
- A change names the nonce it is for and is refused (`STALE_VERSION`) unless that is the item's current ready version (`status: ready`, `manifestNonce(s3Key)`).
- The version swap (`applyTranscodeOutcome`) drops every track whose nonce is not the new one, and resets status, in the same patch that sets `status: ready`.
- Writes use `where captionTracksRev = <read value>` and the version's nonce; a lost race is `CONFLICT` (events handlers re-read and retry once).

State of `captionsStatus` for a version: (absent) -> `pending` (set when the version becomes ready and Transcribe is started) -> `ready` (a track was added) or `failed`. An instructor upload while `pending` or `failed` is allowed and does not change the status except `failed` -> `ready` if it becomes the default. The API reports `pending` older than 2 hours as `failed` (research R-11).

Existing items hold none of these attributes, and the code treats absence as "no tracks, status unknown"; no migration (constitution VII: fix development data by hand).

## Invariants (`helpers/invariants.ts`)

| New or extended | Rule | Breaking test |
|-----------------|------|---------------|
| Extend 6 (video transcode state) | Caption attributes appear only on `video` items; `captionsStatus: pending` only with `captionsPendingSince` and only on a `ready` video | A text item with `captionTracks`; a pending status on a pending video |
| `caption-tracks-valid` (new) | At most 5; unique language; one default when non-empty; every track's nonce equals the item's current manifest nonce (the version swap drops all other tracks in the same patch as `status: ready`, so no other nonce can exist); every key starts with the item's folder plus `<nonce>/captions/` | Six tracks; a track of another nonce; two with one language; no default; a key outside the folder |
| `video-position-valid` (new) | `positionSeconds` finite, whole, within 0 to the cap; `versionId` present | A negative position; a fractional position |

## Entities not changed

`assignmentSubmission`, `itemCompletion`, `quizAttempt`, `quizSummary`, `enrolment`, `progress`, `course`, `module`, `lesson`.

## Stream consumers

`PROGRESS_STREAM_FILTERS` selects entities by name; `videoPosition` is not among them, and a caption write to `contentItem` is already outside the progress recalculation's reads (it keys on completions and visibility). A test asserts neither triggers it. `SEARCH_STREAM_FILTERS` covers `course` only.
