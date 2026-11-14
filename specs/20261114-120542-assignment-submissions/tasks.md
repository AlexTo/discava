---

description: "Task list for student submissions for upload assignments"
---

# Tasks: Student Submissions for Upload Assignments

**Input**: Design documents from `/specs/20261114-120542-assignment-submissions/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: unit tests for each procedure and helper, an invariant check with a test that breaks it for the rule that spans records, and a `packages/e2e` scenario plus a concurrency test for the resubmit race. Write each story's tests first and see them fail. Never weaken an existing test to make it pass (constitution IV); the refactor in Phase 2 must keep instructor-api's existing tests green without changing them.

**Organization**: Grouped by user story so each can be built and tested on its own. Paths are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 submit (P1), US2 resubmit (P2), US3 view and download (P2), US4 outline (P3)

---

## Phase 1: Setup

- [ ] T001 Add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `@aws-sdk/client-scheduler` as direct dependencies of `packages/common/server-utils/package.json` and `packages/apis/core-api/package.json` (versions matching `packages/apis/instructor-api/package.json`), then `pnpm i`

---

## Phase 2: Foundational (blocks every story)

**Purpose**: shared S3 code moved out of instructor-api, the core-api read-path fix, the shared write helper with its invariants, and the infra for the new functions.

**⚠️ CRITICAL**: no user story work starts until this phase is done.

### Shared S3 code (plan R-2)

- [ ] T002 Move `LESSON_FILE_TYPES` and `LESSON_FILE_MAX_BYTES` (100 × 1024 × 1024) from `packages/apis/instructor-api/src/schema/content-item.ts` into `packages/common/server-utils/src/lesson-files.ts` (new); keep the allowlist identical (pdf, docx, xlsx, pptx, odt, ods, odp, txt, csv, md, png, jpg, jpeg, gif, webp, zip). No re-export from instructor-api: change its imports outright.
- [ ] T003 Move the S3 client and bucket-name resolution (`getS3Client`, `resolveBucketName`, `resolveLessonMediaBucketName`, `resolveLessonMediaUploadBucketName`) from `packages/apis/instructor-api/src/lib/s3-client.ts` into `packages/common/server-utils/src/lesson-media-bucket.ts` (new), together with the AppConfig value resolver they use from `packages/apis/instructor-api/src/lib/runtime-config.ts` (read it first; move only what these functions need). Leave the video-specific helpers in instructor-api.
- [ ] T004 Move `packages/apis/instructor-api/src/lib/transcode-cleanup-scheduler.ts` to `packages/common/server-utils/src/cleanup-scheduler.ts` unchanged in behavior (local dev still calls the event runner's `/schedules/transcode-cleanup`).
- [ ] T005 Move the file helpers from `packages/apis/instructor-api/src/lib/lesson-files.ts` into `packages/common/server-utils/src/lesson-files.ts` (`lessonFileType`, `storedFileName`, `presignLessonFileUpload`, `headLessonFileUpload`, `contentDisposition`, `copyLessonFileUpload`, `bestEffortDeleteLessonFileCopy`, key builders). Add generic helpers the submission code needs: `copyWithinLessonMedia(sourceKey, destKey, …)`, `deleteLessonMediaFolder(prefix)` (best effort), and submission key builders: upload `…/content-items/<id>/submissions/<userId>/<uploadId>/<storedName>` in the upload bucket, stored `…/content-items/<id>/submissions/<userId>/<version>-<attemptId>/<storedName>` in the lesson media bucket.
- [ ] T006 Switch every instructor-api import of the moved code to `@discava/common-server-utils/<module>` (including `procedures/content-item-file.ts`, `lib/s3-client.ts`, `lib/course-lifecycle.ts` and the video code) and add the matching `exports` entries to `packages/common/server-utils/package.json`. Run `pnpm nx run @discava/instructor-api:test -- --run`: it MUST pass with no test file edited, apart from import paths.
- [ ] T007 [P] Move the matching unit tests (`s3-client.test.ts`, lesson-file tests) beside the moved code in `packages/common/server-utils/src/` and add tests for the new submission key builders (upload and stored key shapes, the `<version>-<attemptId>` folder, URL-safe stored names) in `packages/common/server-utils/src/lesson-files.test.ts`.

### Existing bug: students can't read a course with an assignment (plan Summary 1)

- [ ] T008 Add `kind: 'lesson' | 'assignment'` to `LessonSchema` and an `{ type: 'assignment', body, dueAt?, maxPoints }` member (no storage keys) to the `ContentItemSchema` union in `packages/apis/core-api/src/schema/course.ts`; update `asStudentContentItem` and the lesson mapping in `packages/apis/core-api/src/procedures/course.ts`. Test first in `packages/apis/core-api/src/procedures/course.test.ts`: a course holding an upload assignment and a quiz assignment passes output validation and exposes `kind`, `dueAt`, `maxPoints`, and never any key or `answerKey`.
- [ ] T009 In `packages/apis/core-api/src/procedures/completion.ts`, make `completeContentItem` return an existing completion for an `assignment` item but never create one: without a completion it throws `PRECONDITION_FAILED` "Submit your work to complete it". Test first in `completion.test.ts` (both cases).

### Shared write helper and invariants (constitution IV; impact check, data-model Invariants)

- [ ] T010 Test first, then implement `assignmentSubmissionWrites` in `packages/databases/core-table/src/helpers/assignment-submission.ts` (new, one file per topic, exported from `src/index.ts`): it builds on `studentActivityWrites` with `firstRecord` true only when no submission exists; first submission = submission `create` (condition: not exists) + `itemCompletion` `create` (condition: not exists); resubmission = submission `patch` conditioned on `version = <read>` AND `status = 'submitted'`, with no completion write. Test in `helpers/assignment-submission.test.ts`: count incremented once, completion written once, a stale version or a `returned` status cancels the transaction, an archived course or hidden item cancels it.
- [ ] T011 Add `assignmentSubmissions` to `TableSnapshot` and load them in the snapshot scan (`entities.assignmentSubmission.scan.go(all)`) in `packages/databases/core-table/src/helpers/invariants.ts` (around lines 29–120 and 1075–1090); confirm `packages/e2e/src/helpers/table-invariants.ts` runs the same checks without change, and edit it only if it builds its own snapshot.
- [ ] T012 Extend the existing checks to cover `assignmentSubmission` in `packages/databases/core-table/src/helpers/invariants.ts`: `studentRecords` (so targets-exist, enrolled and placed-with-item apply) and `checkActivityCountMatchesStudents` (count students with a submission as well as completions and quiz summaries). Add a breaking test for each in `invariants.test.ts`: a submission whose item is gone, whose student isn't enrolled, and a count that omits a submission-only student.
- [ ] T013 Add `checkAssignmentSubmissionShape` to `invariants.ts` and register it in `checkTableInvariants`: "1–5 files; `version ≥ 1`; every file key under the record's own `…/submissions/<userId>/` folder, in a folder starting `<version>-`; the item is an `assignment` item; a matching `itemCompletion` exists; `late` is false when the item has no `dueAt`". Add the invariant name to the invariant-name list near line 150, and a breaking test per rule in `invariants.test.ts`.

### Infra (plan R-7, R2, R3)

- [ ] T014 In `packages/common/constructs/src/app/apis/core-api.ts` add to `CORE_API_DEDICATED_FUNCTIONS`: `AssignmentSubmit: ['assignment.uploadUrl', 'assignment.submit']`, and add `'assignment.submissionFileUrl'` to `MediaUrl`.
- [ ] T015 In `packages/infra/src/stacks/core-api-stack.ts` give `AssignmentSubmit` (through `privilegedHandler`): upload bucket put and read, lesson media bucket put, read and delete, and `mediaPipeline.grantScheduleCleanup`; grant `submissionFileUrl` the CloudFront signing key like the other `MediaUrl` operations. Pass the upload bucket and media pipeline into `CoreApiStackProps` and wire them in `packages/infra/src/stages/application-stage.ts` (as InstructorApi already does). Extend `application-stage.test.ts`: the new function holds those grants and the shared router holds none of them.
- [ ] T016 Run `pnpm nx synth @discava/infra` and `pnpm nx run @discava/infra:checkov`: confirm the CoreApi stack stays well under 500 resources and has no dependency cycle (plan risks R2, R3). Record the resource count in the PR description.

**Checkpoint**: foundation ready. instructor-api tests unchanged and green, `course.view` serves assignment courses, the helper and invariants exist, infra synths.

---

## Phase 3: User Story 1 - Submit work to an upload assignment (P1) 🎯 MVP

**Goal**: an enrolled student attaches 1–5 files to a shown upload assignment and submits; it is stored, flagged late if needed, counted once, and marks the item done.

**Independent Test**: enrol a student in a published course with an upload assignment, submit one file, and check the stored submission, the done mark and `studentActivityCount` of 1.

### Tests for User Story 1 (write first, see them fail)

- [ ] T017 [P] [US1] Unit tests for `assignment.uploadUrl` and `assignment.submit` (first submission) in `packages/apis/core-api/src/procedures/assignment.test.ts`, following `packages/apis/instructor-api/src/procedures/course.test.ts` (`t.createCallerFactory`, `vi.mock`) and the `resolve.alias` for `@discava/core-table` in `vitest.config.mts`: only enrolled students; only shown assignments in published courses (hidden, archived, archived course → refused); disallowed types, 0 or more than 5 files, a file over 100 MB, a zero-size file, duplicate names and a foreign or missing `objectKey` → `BAD_REQUEST`; late is false at exactly `dueAt` and true after; no `dueAt` is never late; the student is counted once and the completion written in the same transaction; files land under `…/submissions/<userId>/1-<attemptId>/`; a failed transaction deletes that folder.
- [ ] T018 [P] [US1] Component tests for the submit screen states in `packages/websites/student-portal/src/routes/learn/$courseId/-components/assignment-item.test.tsx`: no submission, files chosen, each refusal message from [contracts/student-portal-ui.md](./contracts/student-portal-ui.md), uploading with progress, submitting, submitted with and without the late notice, past-due note, archived course, unavailable.
- [ ] T019 [P] [US1] Helpers in `packages/e2e/src/helpers/` for creating an upload assignment (through instructor-api, as other helpers do) and submitting files, then the scenario `packages/e2e/src/scenarios/assignment.e2e.ts`: submit one file, see the done mark, the late notice after the due date, each refusal (101 MB, `.exe`, sixth file, duplicate name), a non-enrolled user refused. Own users and uniquely named data; no local data reset; the table-invariants fixture runs after each test.

### Implementation for User Story 1

- [ ] T020 [US1] Zod schemas in `packages/apis/core-api/src/schema/assignment.ts` (exported from `schema/index.ts`): `ref`, `UploadUrlInput`/`Output`, `SubmitInput` (a `files` array of 1 to 5 `new` or `kept` entries), `Submission` (`version`, `status`, `submittedAt`, `late`, `files` with `fileName`, `fileSize`, `mimeType` and no keys), per [contracts/core-api-assignment.md](./contracts/core-api-assignment.md). `fileSize` is "a positive integer up to `LESSON_FILE_MAX_BYTES` (100 MB)".
- [ ] T021 [US1] `assignment.uploadUrl` in `packages/apis/core-api/src/procedures/assignment.ts`: common checks, published course, caller's submission not `returned`, extension in `LESSON_FILE_TYPES`, presigned PUT (15 minutes) bound to the content type and exact length, key from the T005 builder.
- [ ] T022 [US1] `assignment.submit`, first-submission path, in the same file: read chain, enrolment, submission and completion; validate each new upload (key issued for this item, user and name; `HeadObject` type and size); compute `late`; copy into the attempt folder in parallel; run `assignmentSubmissionWrites`; on cancellation delete the attempt folder and retry up to 3 times, then `CONFLICT`. Use the `MAX_COMPLETE_TRIES` pattern in `completion.ts`.
- [ ] T023 [US1] Register the `assignment` router in `packages/apis/core-api/src/router.ts`; extend `router.test.ts` and any operation lists that pin dedicated functions so `assignment.uploadUrl` and `assignment.submit` resolve to `AssignmentSubmit`.
- [ ] T024 [US1] `assignment-item.tsx` in `packages/websites/student-portal/src/routes/learn/$courseId/-components/`: instructions (read-only Tiptap), due date, limits line, file picker, per-file client checks (type, size, count, duplicate name), presigned PUT with progress, **Submit**, the submitted confirmation with the "Late" notice; text-only buttons, keyboard and live-region support, phone width. Render it from `lesson-page.tsx` for a lesson of kind `assignment` holding an upload item.
- [ ] T025 [US1] Run the US1 unit, component and e2e tests and `pnpm nx e2e @discava/e2e` locally against `pnpm dev`; fix until green and the invariant check passes.

**Checkpoint**: a student can submit; the MVP is usable on its own.

---

## Phase 4: User Story 2 - Resubmit until the work is returned (P2)

**Goal**: a student replaces the file set, keeping, removing or adding files; the version goes up, nobody is counted twice, old files are retired later, a returned submission is locked, and racing resubmits resolve to one winner.

**Independent Test**: submit, resubmit with a different set, and check version 2, the activity count still 1, only the new set current, and the old folder gone after the delay.

### Tests for User Story 2 (write first)

- [ ] T026 [P] [US2] Extend `assignment.test.ts`: resubmit with kept, removed and added files gives version +1; a kept key not in the current submission → `BAD_REQUEST`; the count and completion don't change; a `returned` submission → `PRECONDITION_FAILED`; retirement of the old folder is scheduled with `RETIRED_VERSION_DELAY_MINUTES` and the schedule failing is only logged; a lost race deletes only the loser's own folder and never the winner's; late is recomputed (on time → late after the due date; late → on time after an extension).
- [ ] T027 [P] [US2] Extend `assignment-item.test.tsx` for the resubmit form prefilled with current files (remove, add), the conflict state with **Try again** keeping the chosen files, the locked state with no **Resubmit**, and the failed-request state.
- [ ] T028 [P] [US2] Concurrency test in `packages/e2e/src/concurrency/` (beside `concurrent-writes.e2e.ts`, same `race` helper and fixture): several resubmits at once from one student leave exactly one winner, one version step, one activity count, and no folders left by the losers. Extend `assignment.e2e.ts`: resubmit with kept files, kept file still downloads, late flag recomputed.

### Implementation for User Story 2

- [ ] T029 [US2] `assignment.submit`, resubmission path, in `packages/apis/core-api/src/procedures/assignment.ts`: validate kept keys against the record read in the same pass; copy kept files with `copyWithinLessonMedia` into the new attempt folder; the version-conditioned patch via `assignmentSubmissionWrites`; on success schedule the old folder with `scheduleTranscodeCleanup` using nonce `submissions/<userId>/<oldVersion>-<oldAttemptId>` and `RETIRED_VERSION_DELAY_MINUTES`; on a lost race delete only this attempt's folder, re-read and retry up to 3 times, then `CONFLICT`.
- [ ] T030 [US2] Resubmit form and the conflict, locked and failed states in `assignment-item.tsx`; keep the chosen files across a conflict.
- [ ] T031 [US2] Run the US2 tests and the concurrency test; confirm the retirement runs through the local event runner and leaves nothing under the replaced folder.

**Checkpoint**: US1 and US2 both work on their own.

---

## Phase 5: User Story 3 - See and download my own submission (P2)

**Goal**: a student reopens the assignment, sees their files, submitted time, late flag and version, and downloads their own files; never anyone else's.

**Independent Test**: submit, reload, check the details and a working download; then a second student requesting the first's submission is refused.

### Tests for User Story 3 (write first)

- [ ] T032 [P] [US3] Extend `assignment.test.ts` for `assignment.mySubmission` and `assignment.submissionFileUrl`: only the caller's own record (found by `ctx.user.sub`, never an input id); `null` with no submission; hidden or archived assignment, module or lesson → refused; an archived course still works; `index` out of range → `NOT_FOUND`; the output carries no storage keys; the URL is signed for 5 minutes (`FILE_URL_LIFETIME_SECONDS`) and local dev returns the unsigned S3Mock URL.
- [ ] T033 [P] [US3] Extend `assignment-item.test.tsx` for the submitted view with downloads, the unavailable state and the archived-course state; extend `assignment.e2e.ts`: the download works, a second student can't read the first student's submission, hiding the assignment hides the submission and showing it brings it back.

### Implementation for User Story 3

- [ ] T034 [US3] `assignment.mySubmission` and `assignment.submissionFileUrl` in `packages/apis/core-api/src/procedures/assignment.ts`, using `getSignedCloudFrontFileUrl` and `localObjectUrl` as `contentItem.fileUrl` does in `procedures/content-item.ts`.
- [ ] T035 [US3] The submitted view in `assignment-item.tsx`: file names and sizes, submitted time, late flag, "Version <n>", **Download** per file (calls `submissionFileUrl`), the locked and archived-course texts; show it on load via `mySubmission`.
- [ ] T036 [US3] Run the US3 tests.

**Checkpoint**: students can see and download their own work.

---

## Phase 6: User Story 4 - Find assignments in the course outline (P3)

**Goal**: assignments stand out in the outline and open straight to their item.

**Independent Test**: a module with lessons and an assignment with a due date shows the marking; opening it lands on the submit form.

### Tests for User Story 4 (write first)

- [ ] T037 [P] [US4] Extend `packages/websites/student-portal/src/routes/learn/$courseId/-components/lesson-player.test.tsx` and `course-page.test.tsx`: an assignment shows an icon, the "Assignment" label and "Due <date>" when set, none when not; opening one goes straight to the submit form (upload) or the existing quiz view (quiz assignment), with no list of content.
- [ ] T038 [P] [US4] Extend `packages/e2e/src/scenarios/assignment.e2e.ts` (or `learn.e2e.ts`) to assert the outline marking and the direct open.

### Implementation for User Story 4

- [ ] T039 [US4] Outline marking in `course-player.tsx`, `course-page.tsx` and `use-course-player.ts` under `packages/websites/student-portal/src/routes/learn/$courseId/-components/`: icon, label, due date in the student's time zone; text only, no arrow icons.
- [ ] T040 [US4] Direct open in `lesson-page.tsx`: a lesson of kind `assignment` renders its single item, the quiz view for a quiz assignment and `assignment-item.tsx` for an upload assignment.
- [ ] T041 [US4] Run the US4 tests.

**Checkpoint**: all four stories work.

---

## Phase 7: Polish and cross-cutting

- [ ] T042 [P] Update the docs site (`docs/`) where it describes lesson content or assignments, and `CONTRIBUTING.md` only if it lists the moved `lib/` helpers.
- [ ] T043 Run `pnpm lint`, `pnpm test` and `pnpm build`; fix every failure in the code, not the tests.
- [ ] T044 Run [quickstart.md](./quickstart.md) by hand against `pnpm dev`, saving numbered screenshots of the key steps, including any failure, to `tmp/screenshots/pr-<number>/`.
- [ ] T045 Measure the submit time for five 100 MB files locally and note it in the PR (plan risk R1); if it nears API Gateway's 29 s limit, raise it before merging.
- [ ] T046 Update issue #102's body: part 2 is done, decisions 2, 3, 4 and 6 are recorded as settled, and the PR says "Refs #102", never a closing keyword, because part 3 (grading) is still to come.

---

## Dependencies and order

- Phase 1 → Phase 2 → stories. Within Phase 2: T002–T007 (shared code) are sequential except T007; T008 and T009 are independent of them; T010 → T013 are sequential (same helper, then the same invariants file); T014 → T016 are sequential.
- **US1** depends only on Phase 2. **US2** extends US1's `submit` and form, so it follows US1. **US3** needs a submission to exist, so it follows US1 (it can run alongside US2: different procedures). **US4** needs only T008, so it can start after Phase 2, in parallel with US1.
- Tests in each story come before its implementation.

## Parallel examples

- Phase 2: T007 with T008 and T009 once T002–T006 are done.
- US1: T017, T018 and T019 together; then T020 to T023 (backend) alongside T024 (portal) once the schemas exist.
- After Phase 2: US1 backend, US4 portal work, and the US2/US3 test writing in parallel.

## Implementation strategy

- **MVP**: Phase 1, Phase 2 and US1. A student can submit and see it counted. Resubmitting, viewing and the outline follow as separate, reviewable increments.
- Deliver in the order US1 → US2 → US3 → US4; each checkpoint leaves the table passing the invariant check.
- The Phase 2 refactor and the `course.view` fix are the riskiest changes to existing behavior: land and verify them before building on them.
