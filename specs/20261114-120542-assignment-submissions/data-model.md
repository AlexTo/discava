# Data Model: Student Submissions

No new entity and no new index. This feature writes the entities #294 added.

## assignmentSubmission (existing)

One record per student per assignment. Primary key: pk `courseId` + `contentItemId`, sk `userId`. `byUser` GSI exists but is not used here.

| Attribute | Notes for this feature |
|-----------|------------------------|
| `courseId`, `moduleId`, `lessonId`, `contentItemId`, `userId` | Copied from the item's key and the caller's token (`ctx.user.sub`) |
| `files` | 1–5 of `{ key, fileName, fileSize, mimeType }`; `key` is under `…/submissions/<userId>/<version>-<attemptId>/` in the lesson media bucket |
| `status` | `submitted`; `returned` is set by part 3. Resubmit is conditioned on `submitted` |
| `submittedAt` | Time of the latest submission |
| `late` | Recomputed on every submission from the item's `dueAt` (no `dueAt` means false) |
| `version` | 1 on the first submission, +1 on each resubmission |

State: `submitted` → (part 3) `returned`. A returned record accepts no further submit.

## Writes (all in `assignmentSubmissionWrites`)

| Case | Records written in one transaction |
|------|------------------------------------|
| First submission | `studentActivityWrites` with `firstRecord: true` (increments `contentItem.studentActivityCount`, advances `enrolment.lastActivityAt`, checks course published and ancestors shown), `assignmentSubmission` create (condition: not exists), `itemCompletion` created only if none exists (an existing one with no submission is tolerated) |
| Resubmission | `studentActivityWrites` with `firstRecord: false`, `assignmentSubmission` patch (condition: `version = <read>` and `status = 'submitted'`) |

The completion exists from the first submission, so a resubmission doesn't write one.

## Shared records this feature writes, and what covers them

| Record | How this feature writes it | Existing coverage | Change |
|--------|----------------------------|-------------------|--------|
| `contentItem.studentActivityCount` | +1 on a student's first submission, via `studentActivityWrites` | `checkActivityCountMatchesStudents` | Also counts students with an `assignmentSubmission` |
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

No scans. Stream consumers: completion records already drive progress via `PROGRESS_STREAM_FILTERS`; submission records are not read by progress or search, so neither filter changes.

## Files in S3

| Bucket | Key | Lifetime |
|--------|-----|----------|
| Upload | `courses/<c>/modules/<m>/lessons/<l>/content-items/<id>/submissions/<userId>/<uploadId>/<storedName>` | Expires after 2 days if never submitted |
| Lesson media | `…/content-items/<id>/submissions/<userId>/<version>-<attemptId>/<storedName>` | Kept while it is the current version; a replaced folder, or one a lost race left behind, is deleted (after `RETIRED_VERSION_DELAY_MINUTES` for a replaced version, at once for a lost race) |

## Invariants (core-table `helpers/invariants.ts`)

- `activity-count-matches-students` also counts students with an `assignmentSubmission`.
- Student-record checks (targets exist, enrolled, placed with item) also cover `assignmentSubmission`.
- New `assignment-submission-shape`: 1–5 files; `version ≥ 1`; every key under the record's own `…/submissions/<userId>/` folder, in a folder starting `<version>-`; the item is an `assignment` item; a matching `itemCompletion` exists; `late` is false when the item has no `dueAt`.
- Each has a test that builds a violating snapshot and expects the violation.
