# Data Model: Student Submissions

No new entity and no new index. This feature writes the entities #294 added, with one change to `assignmentSubmission`: its `files` list becomes a single `file`.

## assignmentSubmission (existing)

One record per student per assignment. Primary key: pk `courseId` + `contentItemId`, sk `userId`. `byUser` GSI exists but is not used here.

| Attribute | Notes for this feature |
|-----------|------------------------|
| `courseId`, `moduleId`, `lessonId`, `contentItemId`, `userId` | Copied from the item's key and the caller's token (`ctx.user.sub`) |
| `file` | One `{ key, fileName, fileSize, mimeType }` map, all four required. It replaces #294's untyped `files` list outright, with no fallback for the old shape: no code has written a submission yet, so only a hand-made dev record could have it (reset local data). `key` is under `…/submissions/<userId>/<attemptId>/` in the lesson media bucket |
| `status` | `submitted`; `returned` is set by part 3. Resubmit is conditioned on `submitted` |
| `submittedAt` | Time of the latest submission: `studentActivityAt(enrolment)`, the same time `enrolment.lastActivityAt` moves to |
| `late` | `dueAt !== undefined && submittedAt > dueAt`, set by `assignmentSubmissionWrites` on every submission from the `dueAt` read in the same try. Not recomputed when an instructor later moves or removes the due date, so a record can be `late` on an item that no longer has one |
| `version` | 1 on the first submission, +1 on each resubmission |

State: `submitted` → (part 3) `returned`. A returned record accepts no further submit.

## Writes (all in `assignmentSubmissionWrites`)

| Case | Records written in one transaction |
|------|------------------------------------|
| First submission | `studentActivityWrites` with `firstRecord` true only when the student has no `itemCompletion` for the item either: a completion left from before this feature already counted them, so counting again would double it (increments `contentItem.studentActivityCount`, advances `enrolment.lastActivityAt`, checks course published and ancestors shown), `assignmentSubmission` create (condition: not exists), `itemCompletion` created only if none exists (an existing one with no submission is tolerated) |
| Resubmission | `studentActivityWrites` with `firstRecord: false`, `assignmentSubmission` patch (condition: `version = <read>` and `status = 'submitted'`) |

The completion exists from the first submission, so a resubmission doesn't write one.

## Shared records this feature writes, and what covers them

| Record | How this feature writes it | Existing coverage | Change |
|--------|----------------------------|-------------------|--------|
| `contentItem.studentActivityCount` | +1 on a student's first submission unless a completion already counted them, via `studentActivityWrites` | `checkActivityCountMatchesStudents` | Also counts students with an `assignmentSubmission` |
| `enrolment.lastActivityAt` | Moved forward to the submission time, via `studentActivityWrites` | `checkLastActivityAtCurrent` | Also reads `submittedAt` |
| `itemCompletion` | Created with the first submission (a pre-existing one is tolerated) | `checkProgressMatchesCompletions`, `checkCompletedAtIffCompleted`, `checkStudentRecords*` | None; the new `assignment-submission-shape` check requires a completion |
| Student records (targets exist, enrolled, placed with the item) | A submission is a new kind of student record | `checkStudentRecordsHaveTargets`, `checkStudentRecordsEnrolled`, `checkStudentRecordsPlacedWithItem` | `studentRecords` includes submissions |
| Stream consumers | Completion drives progress as before | `PROGRESS_STREAM_FILTERS` | Test that submission changes don't match them |

## Access patterns

| Request | Key | Index |
|---------|-----|-------|
| Read own submission (`mySubmission`, `submit`, `submissionFileUrl`) | get `courseId` + `contentItemId` + `userId` (from token) | primary |
| Check enrolment, course, module, lesson, item | gets on existing entities | primary |
| Course outline with assignment fields | existing `curriculum` collection query | primary |
| Instructor list of submissions (part 3) | query `courseId` + `contentItemId` | primary |
| Cleanup check before deleting a submission folder (`transcode-cleanup` in `packages/events`, not a user request) | get `courseId` + `contentItemId` + `userId` (from the schedule's payload), consistent read | primary |

No scans. Stream consumers: completion records already drive progress via `PROGRESS_STREAM_FILTERS`; submission records are not read by progress or search, so neither filter changes.

## Files in S3

| Bucket | Key | Lifetime |
|--------|-----|----------|
| Upload | `courses/<c>/modules/<m>/lessons/<l>/content-items/<id>/submissions/<userId>/<uploadId>/<storedName>` | Expires after 2 days if never submitted |
| Lesson media | `…/content-items/<id>/submissions/<userId>/<attemptId>/<storedName>` | Kept while it holds the student's current file. A replaced folder is deleted after `RETIRED_VERSION_DELAY_MINUTES`. A folder from a request that didn't commit is deleted when the request ends, or by its guard after `SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES` if the request crashed. The cleanup never deletes a folder holding a current file |

## Invariants (core-table `helpers/invariants.ts`)

- `activity-count-matches-students` also counts students with an `assignmentSubmission`.
- Student-record checks (targets exist, enrolled, placed with item) also cover `assignmentSubmission`.
- New `assignment-submission-shape`: `file` has a key, name, size and type; `version ≥ 1`; the key is under the record's own `…/submissions/<userId>/` folder; the item is an `assignment` item; a matching `itemCompletion` exists. `late` is deliberately not checked against the item's `dueAt`: the flag describes the due date at submit time, and an instructor may move or remove the due date afterwards.
- Each has a test that builds a violating snapshot and expects the violation.
