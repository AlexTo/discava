# Research: Student Submissions for Upload Assignments

No `NEEDS CLARIFICATION` remained after clarify. This records what the codebase showed and the decisions that follow.

## R-1: What #294 already provides

- **Decision**: build on it, add nothing parallel.
- **Found**: the `assignmentSubmission` entity exists (primary key `courseId` + `contentItemId` / `userId`, `byUser` GSI, `files`, `status`, `submittedAt`, `late`, `version`). Content items have `type: 'assignment'` with `body`, `dueAt`, `maxPoints`. Lessons have `kind`. Invariant `assignment-lesson-shape` exists. instructor-api has the authoring procedures.
- **Gap**: core-api's `course.view` schema (`schema/course.ts`) has no lesson `kind` and no `assignment` item in its discriminated union. A student opening a course with an upload assignment would fail output validation, and `kind` would be silently stripped. Fixed in this feature.

## R-2: Where the S3 code lives

- **Decision**: move `lib/lesson-files.ts`, the S3 client and bucket resolution, and `transcode-cleanup-scheduler.ts` from instructor-api into `common-server-utils` modules; add `LESSON_FILE_TYPES` and `LESSON_FILE_MAX_BYTES` there too. instructor-api imports from the new modules.
- **Rationale**: CLAUDE.md puts runtime code used by two or more Lambdas in `common-server-utils`. core-api now needs presign, head, copy, delete and scheduling.
- **Alternatives**: duplicate in core-api (rejected: two copies of upload rules drift); call instructor-api from core-api (rejected: students would depend on an instructor-only API).
- **Constraint**: existing instructor-api tests must pass without assertion changes.

## R-3: Folder layout and cleanup reuse

- **Decision**: submission files live at `courses/<c>/modules/<m>/lessons/<l>/content-items/<id>/submissions/<userId>/<version>-<attemptId>/<storedName>`, where `attemptId` is a random id made per submit attempt. Uploads use the same prefix with an upload id in the upload bucket: `…/submissions/<userId>/<uploadId>/<storedName>`.
- **Deviation from the issue text** (`submissions/<userId>/<version>/`): a folder named only by version could be written by two racing attempts at once, and the loser's copies could overwrite the winner's files of the same name. A per-attempt folder means an attempt only ever writes and deletes its own folder. The version number stays in the folder name and in the record.
- **Rationale**: it sits under the item prefix, so existing whole-item deletion covers it. The `transcode-cleanup` handler deletes `content-items/<id>/<submissionNonce>/`, and its `submissionNonce` is just a string, so passing `submissions/<userId>/<version>-<attemptId>` retires one folder with no handler change. The schedule name hashes `contentItemId:nonce`, which is unique per attempt.
- **Delay**: `RETIRED_VERSION_DELAY_MINUTES` (4 h 15 min). Download links last 5 minutes, so the "link keeps working" requirement is met with a wide margin; SC-007's "gone within a day" holds.

## R-4: Kept files (clarify Q3)

- **Decision**: a resubmit sends each file as either a new upload (object key from `uploadUrl`) or a kept file (its key in the student's current submission). Kept files are copied inside the media bucket into the new version folder.
- **Rationale**: the old folder is deleted after the delay, so a reference would dangle. A complete folder per version keeps retirement trivial and every version self-contained.
- **Validation**: a kept key must be one of the files in the student's current record (read in the same pass), never a caller-supplied path.
- **Alternatives**: stable per-file folders with removal of dropped files only (rejected for now: needs file-level deletion bookkeeping; revisit if R1 bites).
- **Names**: duplicate file names within one submission are refused, since they'd collide in the folder.

## R-5: Transaction shape and counting

- **Decision**: new helper `assignmentSubmissionWrites` in `core-table/src/helpers/assignment-submission.ts`, built on `studentActivityWrites` with `firstRecord = no existing submission`. It adds: submission `create` (first) or version- and status-conditioned `patch` (resubmit), and `itemCompletion` create only when no completion exists.
- **Rationale**: constitution IV and CLAUDE.md require cross-record rules to go through a shared helper every writer calls, with an invariant.
- **Race**: two resubmits both read version N and each copies into its own folder (`N+1-<attemptId>`), then tries to patch the record conditioned on `version = N AND status = 'submitted'`. One wins. The loser's transaction is cancelled, it deletes its own folder only (best effort), then re-reads. If it still has a valid case it retries against the new version (up to 3 tries, as `completeContentItem` does) and otherwise returns `CONFLICT`. Nothing the winner wrote can be touched by the loser.
- **Returned**: patch is conditioned on `status = 'submitted'`, so a return landing between read and write cancels the submit (FR-011).

## R-6: Invariants to extend

- `checkActivityCountMatchesStudents` counts only `itemCompletions` and `quizSummaries`. Submissions create a completion in the same transaction, so counts still match, but the check should include submissions so a submission without a completion is caught.
- `checkStudentRecordsHaveTargets`, `checkStudentRecordsEnrolled`, `checkStudentRecordsPlacedWithItem` should cover `assignmentSubmission`.
- New `assignment-submission-shape`: 1–5 files, `version ≥ 1`, every file key under the record's own `…/submissions/<userId>/<version>/`, item is an `assignment` item, a completion exists, `late` false when the item has no `dueAt`.
- The table snapshot loader in `invariants.ts` and the e2e `table-invariants.ts` helper must read the new records.

## R-7: Infra

- **Decision**: add dedicated core-api function `AssignmentSubmit` for `assignment.uploadUrl` and `assignment.submit`; add `assignment.submissionFileUrl` to `MediaUrl`. Grants: upload bucket put and read; lesson media bucket put, read and delete; Scheduler via `mediaPipeline.grantScheduleCleanup`; the CloudFront signing key for `MediaUrl` (already granted).
- **Why dedicated**: the shared router must not hold S3 write rights (`privilegedHandler` fails synth otherwise).
- **New wiring**: `CoreApiStack` receives the upload bucket and media pipeline, as `InstructorApiStack` does. Check dependency order and the 500-resource limit at synth.

## R-8: Local development

- S3Mock handles presigned PUT, HEAD, CopyObject and the download URL; `localObjectUrl` returns the unsigned URL. Retirement uses the local event runner's `/schedules/transcode-cleanup`. core-api's local server already sets `LOCAL_DEV`, so no new local service is needed.

## R-9: Student portal

- core-api exposes `kind` on lessons and the `assignment` item (without keys). The player routes a lesson of kind `assignment` straight to its one item: the existing quiz view for a quiz assignment, a new `assignment-item.tsx` for an upload assignment. The outline gets an icon, an "Assignment" label and the due date.
- Buttons use text labels only (CLAUDE.md); no arrow icons.
