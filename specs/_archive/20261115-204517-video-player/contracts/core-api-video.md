# Contract: core-api video procedures (student portal)

Router: `packages/apis/core-api/src/router.ts`, `contentItem`. All require a signed-in user (`courseProcedure`). The ref input is the existing `ContentItemRefSchema` (`courseId`, `moduleId`, `lessonId`, `contentItemId`).

## contentItem.videoUrl (query, existing, output extended)

Access rule unchanged: enrolled (archived courses included), module, lesson and item shown, a playable version exists. Dedicated function (holds the CloudFront signing key).

Output adds:

| Field | Type | Meaning |
|-------|------|---------|
| `versionId` | string | The played manifest's nonce. Echoed back by `saveVideoPosition` |
| `resumeAt` | integer, seconds | The student's saved position for this version, else 0 |
| `captions` | array | The tracks of the played version, default first |
| `captions[].trackId` | string | |
| `captions[].language` | string | BCP 47 tag, e.g. `en-US` |
| `captions[].label` | string | Display label, e.g. "English" |
| `captions[].isDefault` | boolean | |
| `captions[].url` | string | Plain CloudFront URL under the version's folder (S3Mock URL locally). Authorised by the signed cookies set with the response |

Never returned: S3 keys, `captionTracksRev`, track `source`, caption status.

Tests: a student with a position for this version gets it; for another version gets 0; tracks of another nonce are omitted; not enrolled, hidden or pending is `NOT_FOUND` as today; no key leaks. `course.view` output for a video item exposes none of the caption attributes.

## contentItem.saveVideoPosition (mutation, new, shared router function)

Input: the ref, `versionId` (string), `positionSeconds` (number, at least 0, at most 86,400), `durationSeconds` (number, greater than 0, at most 86,400).

Output: `{ saved: boolean }` (`false` when ignored because the version changed).

Behavior:

1. Enrolled, module, lesson and item shown, item is a video: else `NOT_FOUND`.
2. The course must be published (not archived): else `PRECONDITION_FAILED` "This course is archived". The player doesn't surface this error.
3. If `versionId` is not the nonce of the version students now play, return `{ saved: false }` and write nothing.
4. Store `videoPositionToStore(positionSeconds, durationSeconds)` with the version, for `ctx.user.sub`. A missing record is created; otherwise overwritten.
5. Writes nothing else: no completion, no activity count, no `lastActivityAt`.

Errors: `BAD_REQUEST` for invalid numbers (zod), `UNAUTHORIZED` unsigned.

Tests: stores the position; floors fractions; stores 0 within 10 s of the end and past 95%; ignores a stale `versionId`; refuses an archived course, an unenrolled student, a hidden item, a non-video item; cannot write another user's record (the key comes from the token); asserts no write to activity count, completion or progress.
