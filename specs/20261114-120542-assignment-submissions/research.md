# Research: Student Submissions for Upload Assignments

No `NEEDS CLARIFICATION` remained after clarify. This records what the codebase showed and the decisions that follow.

## R-1: What #294 already provides

- **Decision**: build on it, add nothing parallel.
- **Found**: the `assignmentSubmission` entity exists (primary key `courseId` + `contentItemId` / `userId`, `byUser` GSI, `files`, `status`, `submittedAt`, `late`, `version`). Content items have `type: 'assignment'` with `body`, `dueAt`, `maxPoints`. Lessons have `kind`. Invariant `assignment-lesson-shape` exists. instructor-api has the authoring procedures.
- **Gap**: core-api's `course.view` schema (`schema/course.ts`) has no lesson `kind` and no `assignment` item in its discriminated union. A student opening a course with an upload assignment would fail output validation, and `kind` would be silently stripped. Fixed in this feature.

## R-2: Where the S3 code lives

- **Decision**: move `lib/lesson-files.ts`, the S3 client and bucket resolution, and `transcode-cleanup-scheduler.ts` from instructor-api into `common-server-utils` modules; add `LESSON_FILE_TYPES` and `LESSON_FILE_MAX_BYTES` there too. instructor-api imports from the new modules. `packages/events` has its own copy of the scheduler (`lib/transcode-cleanup-scheduler.ts`, which exists only because events can't import instructor-api) and of the bucket and cleanup-config resolvers (`lib/runtime-config.ts`); those are replaced by the shared modules as well. The shared scheduler exports today's two behaviors under their current names: `scheduleTranscodeCleanup` (best effort, logs) and `scheduleTranscodeCleanupOrThrow` (throws, except that an existing schedule is a no-op), built on one implementation of the name, the time and the local-runner call.
- **Rationale**: CLAUDE.md puts runtime code used by two or more Lambdas in `common-server-utils`. core-api now needs presign, head, copy, delete and scheduling.
- **Alternatives**: duplicate in core-api (rejected: two copies of upload rules drift); call instructor-api from core-api (rejected: students would depend on an instructor-only API).
- **Constraint**: existing instructor-api and events tests must pass without assertion changes.

## R-3: Folder layout and cleanup reuse

- **Decision**: a submission's file lives at `courses/<c>/modules/<m>/lessons/<l>/content-items/<id>/submissions/<userId>/<attemptId>/<storedName>`, where `attemptId` is a random id made per submit request. Uploads use the same prefix with an upload id in the upload bucket: `…/submissions/<userId>/<uploadId>/<storedName>`.
- **Why not a folder per version**: a folder named by version could be written by two racing attempts at once, and the loser's copy could overwrite the winner's file of the same name. A per-request folder means a request only ever writes and deletes its own folder. The version is in the record only: with it in the folder name, a retry after a cancelled transaction would have to delete and re-copy the file under a new name.
- **Rationale**: it sits under the item prefix, so existing whole-item deletion covers it. The `transcode-cleanup` handler deletes `content-items/<id>/<submissionNonce>/`, and its `submissionNonce` is just a string, so passing `submissions/<userId>/<attemptId>` names one folder.
- **Conditional cleanup**: the handler's delete is unconditional today, which is safe for video output but not here: a cleanup firing for a folder that turned out to hold the student's current file would lose their work. The handler gains an optional `keepIfCurrentFor: <userId>`; with it, it reads that student's submission and deletes nothing when the record's file is in the folder.
- **Crashed requests**: cleanup that runs only inside the request leaves the copied file behind forever when the Lambda times out or crashes (the lesson media bucket has no expiry). So each request schedules a guard cleanup of its own folder before copying, after `SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES` (60), far longer than the function's 25 s timeout. Because the cleanup is conditional there is nothing to cancel on success. Alternative: schedule and cancel on success (rejected: a failed cancel would delete a committed file).
- **Schedule names**: the name hashes `contentItemId:nonce`; a guard and a later retirement of the same folder would collide within the hour, so the hash also includes a purpose.
- **Delay**: `RETIRED_VERSION_DELAY_MINUTES` (4 h 15 min) for a replaced folder. Download links last 5 minutes, so the "link keeps working" requirement is met with a wide margin; SC-007's "gone within a day" holds for both delays.

## R-4: One file per submission (clarify)

- **Decision**: a submission holds exactly one file of at most 100 MB. A resubmit sends one new upload (object key from `uploadUrl`), which replaces the previous file; nothing is carried over from the earlier version. This is the issue's decision 4. A student whose work has several parts combines them into one document or PDF, or a zip (`zip` is in `LESSON_FILE_TYPES`).
- **Rationale**: with one file there are no kept files to address or re-copy, no file names to collide in one folder, and the copy inside the submit request is at most 100 MB instead of 500 MB (risk R1). One folder per submitted file keeps retirement trivial and every version self-contained.
- **Alternatives**: 1–5 files with kept, removed and added files on resubmit (rejected for now: kept files need addressing without exposing storage keys, re-copying on every version and duplicate-name handling). The record's `files` list from #294 becomes a single `file` map outright (CLAUDE.md: change data shapes freely before launch); nothing has written a submission yet.

## R-5: Transaction shape and counting

- **Decision**: new helper `assignmentSubmissionWrites` in `core-table/src/helpers/assignment-submission.ts`, built on `studentActivityWrites` with `firstRecord = no existing submission and no existing completion`. Today `completeContentItem` can complete an assignment item and count the student, so a first submission by such a student must not count them again (`checkActivityCountMatchesStudents` would fail and instructor-api's delete guard would see an inflated count). The helper also sets `late` from `submittedAt` and the item's `dueAt`, so every writer agrees. It adds: submission `create` (first) or version- and status-conditioned `patch` (resubmit), and `itemCompletion` create only when no completion exists.
- **Rationale**: constitution IV and CLAUDE.md require cross-record rules to go through a shared helper every writer calls, with an invariant.
- **Race**: two resubmits both read version N and each copies into its own folder (`<attemptId>`), then tries to patch the record conditioned on `version = N AND status = 'submitted'`. One wins. The loser's transaction is cancelled and it re-reads: the version has moved, so it returns `CONFLICT` and deletes its own folder. It does not retry against the new version, because that would let both requests commit one after the other, and the spec wants exactly one winner with the other told to retry (FR-012). Nothing the winner wrote can be touched by the loser. A try cancelled for another reason (an unrelated write moved the enrolment's `lastActivityAt`) does retry, with the copy it already made, up to 3 tries as `completeContentItem` does.
- **Returned**: patch is conditioned on `status = 'submitted'`, so a return landing between read and write cancels the submit (FR-011).

## R-6: Invariants to extend

- `checkActivityCountMatchesStudents` counts only `itemCompletions` and `quizSummaries`. Submissions create a completion in the same transaction, so counts still match, but the check should include submissions so a submission without a completion is caught.
- `checkStudentRecordsHaveTargets`, `checkStudentRecordsEnrolled`, `checkStudentRecordsPlacedWithItem` should cover `assignmentSubmission`.
- New `assignment-submission-shape`: `file` has a key, name, size and type, `version ≥ 1`, the key is under the record's own `…/submissions/<userId>/` folder, item is an `assignment` item, a completion exists. No rule ties `late` to the item's current `dueAt`: the spec keeps the flag as it was at submit time when an instructor moves or removes the due date.
- The table snapshot loader in `invariants.ts` and the e2e `table-invariants.ts` helper must read the new records.

## R-7: Infra

- **Decision**: add dedicated core-api function `AssignmentSubmit` for `assignment.uploadUrl` and `assignment.submit`; add `assignment.submissionFileUrl` to `MediaUrl`. Grants: upload bucket put and read; lesson media bucket put, read and delete; Scheduler via `mediaPipeline.grantScheduleCleanup`; the CloudFront signing key for `MediaUrl` (already granted). `AssignmentSubmit`'s timeout is 25 s. The `transcode-cleanup` Lambda gains read on the core table for its `keepIfCurrentFor` check.
- **Why dedicated**: the shared router must not hold S3 write rights (`privilegedHandler` fails synth otherwise).
- **New wiring**: `CoreApiStack` receives the upload bucket and media pipeline, as `InstructorApiStack` does. Check dependency order and the 500-resource limit at synth.

## R-8: Local development

- S3Mock handles presigned PUT, HEAD, CopyObject and the download URL; `localObjectUrl` returns the unsigned URL. Retirement and the attempt guard use the local event runner's `/schedules/transcode-cleanup`. The runner's fixed delay of a few seconds is too short for the guard, which could fire while its own request is still running, so `LocalScheduleRequest` gains an optional `delaySeconds` and the guard asks for 60. core-api's local server already sets `LOCAL_DEV`, so no new local service is needed.

## R-9: Student portal

- core-api exposes `kind` on lessons and the `assignment` item (without keys). The player routes a lesson of kind `assignment` straight to its one item: the existing quiz view for a quiz assignment, a new `assignment-item.tsx` for an upload assignment. The outline gets an icon, an "Assignment" label and the due date.
- Buttons use text labels only (CLAUDE.md); no arrow icons.
