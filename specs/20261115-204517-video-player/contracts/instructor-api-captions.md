# Contract: instructor-api caption procedures (instructor portal)

Router: `packages/apis/instructor-api/src/router.ts`, `contentItem`. All require the `instructor` group and that the caller instructs the item's course (as the existing video procedures do). The ref is the existing content item ref.

## contentItem.createVideoUrl (existing, output extended)

Adds to the output the same `versionId` and `captions` as core-api's `videoUrl` (without `resumeAt`: the preview never resumes), plus what the instructor needs to manage tracks:

| Field | Meaning |
|-------|---------|
| `captionsStatus` | `pending`, `ready`, `failed` or absent (pending older than 2 hours is reported `failed`) |
| `captions[].source` | `auto` or `uploaded` |

The instructor's content item output also carries `captionsStatus` and a `captionTrackCount`, for the row badge. S3 keys are not returned.

## contentItem.captionUploadUrl (mutation, new)

Input: the ref. Output: `{ uploadId, url, headers }`, a presigned PUT into the upload bucket at `…/content-items/<id>/captions/<uploadId>.vtt`, bound to `text/vtt` and a maximum of 1 MB (1,048,576 bytes), built with the same presign helper as file items (`common-server-utils/lesson-files`). Refused unless the video is `ready`.

## contentItem.attachCaption (mutation, new)

Input: the ref, `uploadId`, `language` (one of the shared list), `label` (optional, defaults to the language's name, at most 40 characters, plain text).

Steps: check the video is `ready`; `HEAD` the upload (exists, at most 1 MB); read it and validate WebVTT (`common-server-utils/captions`: optional BOM, starts with `WEBVTT` followed by space, tab or newline, valid UTF-8, no NUL bytes, at least one `-->` cue line); copy to the media bucket at `…/<nonce>/captions/<trackId>.vtt` with content type `text/vtt` (`trackId` a fresh uuid); apply `applyCaptionChange` as a conditional write on the revision and the nonce; on success delete the replaced track's file (best effort) and the upload; on any failure delete the copy.

Output: the item's tracks (as above, with `source`).

Errors: `NOT_FOUND`; `FORBIDDEN` (not this course's instructor); `PRECONDITION_FAILED` (video not ready, or replaced meanwhile: "The video changed, try again"); `BAD_REQUEST` (not WebVTT, too large, language not allowed, a sixth track); `CONFLICT` (lost a race, "Try again").

## contentItem.removeCaption (mutation, new)

Input: the ref, `trackId`. Applies `applyCaptionChange` (removing; the default moves to the oldest remaining) conditionally, then deletes the file best effort. Output: the remaining tracks. Errors: `NOT_FOUND` (no such track), `FORBIDDEN`, `PRECONDITION_FAILED`, `CONFLICT`.

## Tests

For each: instructor of another course, a student, and a non-instructor are refused; the happy path; the five-track and one-per-language rules; replacing the auto track makes the upload default; removing the default promotes the next; invalid WebVTT (no header, binary, over 1 MB, no cue); a replaced video (stale nonce) is refused and leaves no file; a lost race leaves no orphan copy; no S3 key in any output.
