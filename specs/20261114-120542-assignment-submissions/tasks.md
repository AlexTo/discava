---

description: "Task list for student submissions for upload assignments"
---

# Tasks: Student Submissions for Upload Assignments

**Input**: Design documents from `/specs/20261114-120542-assignment-submissions/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: unit tests for each procedure and helper, an invariant check with a test that breaks it for the rule that spans records, and a `packages/e2e` scenario plus a concurrency test for the resubmit race. Write each story's tests first and see them fail. Never weaken an existing test to make it pass (constitution IV); the refactor in Phase 2 must keep instructor-api's existing tests green without changing them.

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The e2e scenarios and the concurrency test are written by the agent but run on PR CI (`pr-checks.yml`'s `E2E tests` job, which runs `nx affected --target e2e`); a CI failure is the feedback for those. Tasks marked **(human)** need a running local stack or people, and are done by a reviewer before merging.

**Organization**: Grouped by user story so each can be built and tested on its own. Paths are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 submit (P1), US2 resubmit (P2), US3 view and download (P2), US4 outline (P3)

---

## Phase 1: Setup

- [ ] T001 Add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `@aws-sdk/client-scheduler` as direct dependencies of `packages/common/server-utils/package.json` and `packages/apis/core-api/package.json` (versions matching `packages/apis/instructor-api/package.json`), plus, in `packages/common/server-utils/package.json`, whatever the AppConfig resolver moved in T003 imports (`@aws-lambda-powertools/parameters` and its AppConfig client), then `pnpm i`

---

## Phase 2: Foundational (blocks every story)

**Purpose**: shared S3 code moved out of instructor-api, the core-api read-path fix, the shared write helper and its invariants.

**⚠️ CRITICAL**: no user story work starts until this phase is done.

### Shared S3 code (plan R-2)

- [ ] T002 Move `LESSON_FILE_TYPES` and `LESSON_FILE_MAX_BYTES` (100 × 1024 × 1024) from `packages/apis/instructor-api/src/schema/content-item.ts` into `packages/common/server-utils/src/lesson-files.ts` (new); keep the allowlist identical (pdf, docx, xlsx, pptx, odt, ods, odp, txt, csv, md, png, jpg, jpeg, gif, webp, zip). No re-export from instructor-api: change its imports outright.
- [ ] T003 Move the S3 client and bucket-name resolution (`getS3Client`, `resolveBucketName`, `resolveLessonMediaBucketName`, `resolveLessonMediaUploadBucketName`) from `packages/apis/instructor-api/src/lib/s3-client.ts` into `packages/common/server-utils/src/lesson-media-bucket.ts` (new), together with the AppConfig value resolver they use from `packages/apis/instructor-api/src/lib/runtime-config.ts` (read it first; move only what these functions need). Leave the video-specific helpers in instructor-api. `packages/events/src/lib/runtime-config.ts` has its own `resolveLessonMediaBucketName` and cleanup-config resolver: replace them with imports of the shared ones, so there is one of each.
- [ ] T004 Make `packages/common/server-utils/src/cleanup-scheduler.ts` (new) the one cleanup scheduler, replacing both `packages/apis/instructor-api/src/lib/transcode-cleanup-scheduler.ts` and `packages/events/src/lib/transcode-cleanup-scheduler.ts` (delete both). Export today's two behaviors under their current names, on one shared implementation of the schedule name, the run time and the local-runner call: `scheduleTranscodeCleanup` (best effort: logs a failure) and `scheduleTranscodeCleanupOrThrow` (throws, except that an existing schedule is a no-op). Add what submissions need: an optional `keepIfCurrentFor` (a user id) passed through in the payload, an optional `purpose` that goes into the schedule-name hash (without one the name is exactly today's), and an optional `delaySeconds` on `LocalScheduleRequest` in `local-dev.ts`, honored by `packages/events/src/local/event-runner.ts` (default: today's `cleanupDelaySeconds`). Merge both existing test files into `packages/common/server-utils/src/cleanup-scheduler.test.ts`: the module paths their mocks name will change, but no assertion may, and no mock may be widened. Add tests for the three options.
- [ ] T005 Move the file helpers from `packages/apis/instructor-api/src/lib/lesson-files.ts` into `packages/common/server-utils/src/lesson-files.ts` (`lessonFileType`, `storedFileName`, `presignLessonFileUpload`, `headLessonFileUpload`, `contentDisposition`, `copyLessonFileUpload`, `bestEffortDeleteLessonFileCopy`, key builders). Add what the submission code needs: `deleteLessonMediaFolder(prefix)` (best effort) and submission key builders: upload `…/content-items/<id>/submissions/<userId>/<uploadId>/<storedName>` in the upload bucket, stored `…/content-items/<id>/submissions/<userId>/<attemptId>/<storedName>` in the lesson media bucket.
- [ ] T006 Switch every instructor-api import of the moved code to `@discava/common-server-utils/<module>` (including `procedures/content-item-file.ts`, `lib/s3-client.ts`, `lib/course-lifecycle.ts` and the video code) and add the matching `exports` entries to `packages/common/server-utils/package.json`. Switch `packages/events`' imports of its removed scheduler and resolvers the same way. Run instructor-api's and events' tests once (`pnpm nx run @discava/instructor-api:test -- --run`, and the same for the events project): they MUST pass with no assertion changed; only import paths and the location of tests for moved code may change.
- [ ] T007 [P] Move the unit tests for the moved code (the bucket-resolution and lesson-file cases; the scheduler's tests move in T004; leave `s3-client.test.ts`'s video-upload and cleanup cases in instructor-api, since those helpers stay) beside the moved code in `packages/common/server-utils/src/` and add tests for the new submission key builders (upload and stored key shapes, the per-request `<attemptId>` folder, URL-safe stored names) in `packages/common/server-utils/src/lesson-files.test.ts`.

### Existing bug: students can't read a course with an assignment (plan Summary 1)

- [ ] T008 Add `kind: 'lesson' | 'assignment'` to `LessonSchema` and an `{ type: 'assignment', body, dueAt?, maxPoints }` member (no storage keys) to the `ContentItemSchema` union in `packages/apis/core-api/src/schema/course.ts`; update `asStudentContentItem` and the lesson mapping in `packages/apis/core-api/src/procedures/course.ts`. Test first in `packages/apis/core-api/src/procedures/course.test.ts`: a course holding an upload assignment and a quiz assignment passes output validation and exposes `kind`, `dueAt`, `maxPoints`, and never any key or `answerKey`.
- [ ] T009 In `packages/apis/core-api/src/procedures/completion.ts`, make `completeContentItem` return an existing completion for an `assignment` item but never create one: without a completion it throws `PRECONDITION_FAILED` "Submit your work to complete it". Test first in `completion.test.ts` (both cases).

### Shared write helper and invariants (constitution IV; impact check, data-model Invariants)

- [ ] T047 Change `packages/databases/core-table/src/entities/assignment-submission.ts` outright: replace the untyped `files` list with a required `file` map (`key`, `fileName`, `fileSize`, `mimeType`, all required), and correct the comments on `files` and `version` (one file; its folder is named for the request, not the version). No fallback or migration for the old shape: nothing writes submissions yet. Update anything in core-table that names `files`, and add an entity test that a record without a complete `file` is refused.
- [ ] T048 Test first, then add the optional `keepIfCurrentFor` to `CleanupEventSchema` in `packages/events/src/media/transcode-cleanup.ts`: when present, read that user's `assignmentSubmission` for the item (consistent read) and delete nothing when the record's `file.key` starts with the prefix; without it, behave exactly as today. Tests in `transcode-cleanup.test.ts`: the current file's folder is kept, another folder of the same student is deleted, no record means delete, and the existing cases pass unchanged. Add the events project's direct dependencies on `@discava/core-table` if it doesn't have them (CLAUDE.md's TS2883 note).
- [ ] T010 Test first, then implement `assignmentSubmissionWrites` in `packages/databases/core-table/src/helpers/assignment-submission.ts` (new, one file per topic, exported from `src/index.ts`): it builds on `studentActivityWrites` with `firstRecord` true only when the student has neither a submission nor an `itemCompletion` for the item (a completion left from before this feature already counted them); `submittedAt` is that activity's `at` (from `studentActivityAt(enrolment)`), so `enrolment.lastActivityAt` and `submittedAt` agree; `late` is `dueAt !== undefined && submittedAt > dueAt` from the item's `dueAt` passed in by the caller; first submission = submission `create` (condition: not exists) + `itemCompletion` written only if none exists (an existing one is checked to exist, not created, so the first submit can't fail forever); resubmission = submission `patch` conditioned on `version = <read>` AND `status = 'submitted'`, with no completion write. Test in `helpers/assignment-submission.test.ts`: count incremented once and completion written once for a new student; a pre-existing completion with no submission lets the first submit succeed and does NOT increment the count; `late` is false at exactly `dueAt`, true after, false with no `dueAt`, and follows `submittedAt` when `enrolment.lastActivityAt` is ahead of the clock and past `dueAt`; a stale version or a `returned` status cancels the transaction; an archived course or hidden item cancels it.
- [ ] T011 Add `assignmentSubmissions` to `TableSnapshot` and load them in the snapshot scan (`entities.assignmentSubmission.scan.go(all)`) in `packages/databases/core-table/src/helpers/invariants.ts` (around lines 29–120 and 1075–1090); confirm `packages/e2e/src/helpers/table-invariants.ts` runs the same checks without change, and edit it only if it builds its own snapshot.
- [ ] T012 Extend the existing checks to cover `assignmentSubmission` in `packages/databases/core-table/src/helpers/invariants.ts`: `studentRecords` (so targets-exist, enrolled and placed-with-item apply) and `checkActivityCountMatchesStudents` (count students with a submission as well as completions and quiz summaries). Add a breaking test for each in `invariants.test.ts`: a submission whose item is gone, whose student isn't enrolled, and a count that omits a submission-only student. Also extend `checkLastActivityAtCurrent` (invariant 16) so a submission's `submittedAt` counts as activity, with a breaking test (a resubmit that did not advance `enrolment.lastActivityAt`), and assert in `progress-stream.test.ts` that an `assignmentSubmission` record change does not match `PROGRESS_STREAM_FILTERS` (or, if it does, update the filters).
- [ ] T013 Add `checkAssignmentSubmissionShape` to `invariants.ts` and register it in `checkTableInvariants`: "`file` has a key, name, size and type; `version ≥ 1`; the key is under the record's own `…/submissions/<userId>/` folder; the item is an `assignment` item; a matching `itemCompletion` exists". Do not check `late` against the item's `dueAt` (an instructor may move or remove the due date after a submission; data-model Invariants). Add the invariant name to the invariant-name list near line 150, and a breaking test per rule in `invariants.test.ts`, plus one that a `late` record on an item with no `dueAt` is NOT a violation.


**Checkpoint**: foundation ready. instructor-api tests unchanged and green, `course.view` serves assignment courses, the helper and invariants exist. (Infra comes with US1, after the router exists.)

---

## Phase 3: User Story 1 - Submit work to an upload assignment (P1) 🎯 MVP

**Goal**: an enrolled student attaches one file to a shown upload assignment and submits; it is stored, flagged late if needed, counted once, and marks the item done.

**Independent Test**: enrol a student in a published course with an upload assignment, submit one file, and check the stored submission, the done mark and `studentActivityCount` of 1.

### Tests for User Story 1 (write first, see them fail)

- [ ] T014 [P] [US1] Unit tests for `assignment.uploadUrl` and `assignment.submit` (first submission) in `packages/apis/core-api/src/procedures/assignment.test.ts`, following `packages/apis/instructor-api/src/procedures/course.test.ts` (`t.createCallerFactory`, `vi.mock`) and the `resolve.alias` for `@discava/core-table` in `vitest.config.mts`: only enrolled students; only shown assignments in published courses (hidden, archived, archived course → refused); a disallowed type, a file over 100 MB, a zero-size file and a foreign or missing `objectKey` → `BAD_REQUEST`; late is false at exactly `dueAt` and true after; no `dueAt` is never late; the output's `late` and `submittedAt` are the ones the helper stored, not the Lambda clock's; the student is counted once and the completion written in the same transaction; the attempt guard is scheduled before the copy (with `keepIfCurrentFor`, purpose `attempt` and `SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES`), and a scheduling failure stops the request before anything is copied; the file lands under `…/submissions/<userId>/<attemptId>/` and is copied once however many tries the transaction takes; a request that ends without a commit deletes that folder.
- [ ] T015 [P] [US1] Component tests for the submit screen states in `packages/websites/student-portal/src/routes/learn/$courseId/-components/assignment-item.test.tsx`: no submission, file chosen, each refusal message from [contracts/student-portal-ui.md](./contracts/student-portal-ui.md), uploading with progress, submitting, submitted with and without the late notice, past-due note, archived course, unavailable.
- [ ] T016 [P] [US1] Helpers in `packages/e2e/src/helpers/` for creating an upload assignment (through instructor-api, as other helpers do) and submitting a file, then the scenario `packages/e2e/src/scenarios/assignment.e2e.ts`: submit one file, see the done mark, the late notice after the due date, each refusal (101 MB, `.exe`), a non-enrolled user refused. Own users and uniquely named data; no local data reset; the table-invariants fixture runs after each test.

### Implementation for User Story 1

- [ ] T017 [US1] Zod schemas in `packages/apis/core-api/src/schema/assignment.ts` (exported from `schema/index.ts`): `ref`, `UploadUrlInput`/`Output`, `SubmitInput` (`ref` plus the one upload's `objectKey` and `fileName`), `Submission` (`version`, `status`, `submittedAt`, `late`, `file` with `fileName`, `fileSize`, `mimeType` and no key), per [contracts/core-api-assignment.md](./contracts/core-api-assignment.md). `fileSize` is "a positive integer up to `LESSON_FILE_MAX_BYTES` (100 MB)".
- [ ] T018 [US1] `assignment.uploadUrl` in `packages/apis/core-api/src/procedures/assignment.ts`: common checks, published course, caller's submission not `returned`, extension in `LESSON_FILE_TYPES`, presigned PUT (15 minutes) bound to the content type and exact length, key from the T005 builder.
- [ ] T019 [US1] `assignment.submit`, first-submission path, in the same file, following steps 1–8 of [contracts/core-api-assignment.md](./contracts/core-api-assignment.md): read chain, enrolment, submission and completion; validate the upload (key issued for this item, user and name; `HeadObject` type and size); schedule the attempt guard with `scheduleTranscodeCleanupOrThrow` (`keepIfCurrentFor`, purpose `attempt`, `SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES` = 60, a new export beside `RETIRED_VERSION_DELAY_MINUTES` in `packages/common/server-utils/src/media-keys.ts`; 60 s through `delaySeconds` in local dev); copy the file once into the attempt folder; then up to 3 tries of `assignmentSubmissionWrites`, each on a fresh read, passing the item's `dueAt`; a cancelled try re-reads: a submission that appeared or whose version moved means another request won, so stop with `CONFLICT`; a cancellation from an unrelated write retries with the same copy; any exit without a commit deletes the attempt folder (best effort), and 3 cancelled tries end in `CONFLICT`. Use the `MAX_COMPLETE_TRIES` pattern in `completion.ts`.
- [ ] T020 [US1] Register the `assignment` router in `packages/apis/core-api/src/router.ts`; extend `router.test.ts` and any operation lists that pin dedicated functions so `assignment.uploadUrl` and `assignment.submit` resolve to `AssignmentSubmit`.
- [ ] T021 [US1] Now that T020 has registered the operations (the `Operations` type comes from `AppRouter`, so this cannot come earlier), in `packages/common/constructs/src/app/apis/core-api.ts` add to `CORE_API_DEDICATED_FUNCTIONS`: `AssignmentSubmit: ['assignment.uploadUrl', 'assignment.submit']`, and add `'assignment.submissionFileUrl'` to `MediaUrl`.
- [ ] T022 [US1] In `packages/infra/src/stacks/core-api-stack.ts` give `AssignmentSubmit` (through `privilegedHandler`) a 25 s timeout, below API Gateway's 29 s (plan risk R1), and these grants: upload bucket put and read, lesson media bucket put, read and delete, and `mediaPipeline.grantScheduleCleanup`; grant `submissionFileUrl` the CloudFront signing key like the other `MediaUrl` operations. Pass the upload bucket and media pipeline into `CoreApiStackProps` and wire them in `packages/infra/src/stages/application-stage.ts` (as InstructorApi already does). Extend `application-stage.test.ts`: the new function holds those grants and the shared router holds none of them. `AssignmentSubmit` reads the bucket names and the cleanup schedule's config through the AppConfig access every core-api handler already has (the stack's baseline), so it needs no new grant for that: assert it in the stage test. Also, in `packages/infra/src/stacks/media-pipeline-stack.ts`, where the `transcode-cleanup` Lambda is wired, grant that Lambda read-only access to the core table for T048's check, with a stage test, and confirm at synth that it adds no dependency cycle (plan risk R3).
- [ ] T023 [US1] Run `pnpm nx synth @discava/infra` and `pnpm nx run @discava/infra:checkov`: confirm the CoreApi stack stays well under 500 resources and has no dependency cycle (plan risks R2, R3). Record the resource count in the PR description.
- [ ] T024 [US1] `assignment-item.tsx` in `packages/websites/student-portal/src/routes/learn/$courseId/-components/`: instructions (read-only Tiptap), due date, limits line, file picker, client checks (type, size), presigned PUT with progress, **Submit**, the submitted confirmation with the "Late" notice; text-only buttons, keyboard and live-region support, phone width. Render it from `lesson-page.tsx` for a lesson of kind `assignment` holding an upload item.
- [ ] T025 [US1] Run the US1 unit and component tests (`pnpm nx run-many --target test`, run once) plus lint and typecheck locally and fix until green. The US1 e2e scenario (T016) runs on PR CI; read its result and fix any failure, including the invariant check that runs after each test.

**Checkpoint**: a student can submit; the MVP is usable on its own.

---

## Phase 4: User Story 2 - Resubmit until the work is returned (P2)

**Goal**: a student replaces their file with a new one; the version goes up, nobody is counted twice, the old file is retired later, a returned submission is locked, and racing resubmits resolve to one winner.

**Independent Test**: submit, resubmit with a different file, and check version 2, the activity count still 1, only the new file current, and the old folder gone after the delay.

### Tests for User Story 2 (write first)

- [ ] T026 [P] [US2] Extend `assignment.test.ts`: a resubmit gives version +1 and the record holds only the new file; the count and completion don't change; a `returned` submission → `PRECONDITION_FAILED`; retirement of the old folder is scheduled with `RETIRED_VERSION_DELAY_MINUTES` and the schedule failing is only logged; a lost race (the version moved) ends in `CONFLICT` at once, without a second commit, and deletes only its own folder, never the winner's; a try cancelled by an unrelated write retries with the same copy and never copies again; retirement uses `keepIfCurrentFor` and purpose `retire`; late is recomputed (on time → late after the due date; late → on time after an extension).
- [ ] T027 [P] [US2] Extend `assignment-item.test.tsx` for the resubmit form showing the current file and a chosen replacement, the conflict state with **Try again** keeping the chosen file, the locked state with no **Resubmit**, and the failed-request state: it re-reads `mySubmission`, shows the Submitted state when the file did go through (a submission now exists where none was loaded, or its `version` is higher than the one loaded), and otherwise the "not submitted" message.
- [ ] T028 [P] [US2] Concurrency test in `packages/e2e/src/concurrency/` (beside `concurrent-writes.e2e.ts`, same `race` helper and fixture): several resubmits at once from one student leave exactly one winner, one version step, one activity count, and no folders left by the losers; and several first submissions at once from one student leave one record at version 1, the activity count incremented once, one completion, and no folders left by the losers. Extend `assignment.e2e.ts`: resubmit with a replacement file, the download returns the new file, late flag recomputed.

### Implementation for User Story 2

- [ ] T029 [US2] `assignment.submit`, resubmission path, in `packages/apis/core-api/src/procedures/assignment.ts`: the same guard, single copy and tries as T019, with the version-conditioned patch via `assignmentSubmissionWrites`; on success schedule the replaced folder (the one holding the previous record's `file.key`) with `scheduleTranscodeCleanup` using nonce `submissions/<userId>/<oldAttemptId>`, `keepIfCurrentFor`, purpose `retire` and `RETIRED_VERSION_DELAY_MINUTES`, logging only if that fails; on a lost race (the re-read shows the version moved) return `CONFLICT` and delete this attempt's folder; retry, up to 3 times with the same copy, only when an unrelated write cancelled the transaction.
- [ ] T030 [US2] Resubmit form and the conflict, locked and failed states in `assignment-item.tsx`; keep the chosen file across a conflict. After a failed submit, re-read `mySubmission` before choosing what to show.
- [ ] T031 [US2] Run the US2 unit and component tests locally and fix until green. The concurrency test and the resubmit e2e scenario run on PR CI. The unit tests assert that retirement of the replaced folder is scheduled with the right nonce and delay; the local event runner is not run by the agent.

**Checkpoint**: US1 and US2 both work on their own.

---

## Phase 5: User Story 3 - See and download my own submission (P2)

**Goal**: a student reopens the assignment, sees their file, submitted time, late flag and version, and downloads their own file; never anyone else's.

**Independent Test**: submit, reload, check the details and a working download; then a second student requesting the first's submission is refused.

### Tests for User Story 3 (write first)

- [ ] T032 [P] [US3] Extend `assignment.test.ts` for `assignment.mySubmission` and `assignment.submissionFileUrl`: only the caller's own record (found by `ctx.user.sub`, never an input id); `null` with no submission; hidden or archived assignment, module or lesson → refused; an archived course still works; `submissionFileUrl` with no submission → `NOT_FOUND`; the output carries no storage key; the URL is signed for 5 minutes (`FILE_URL_LIFETIME_SECONDS`) and local dev returns the unsigned S3Mock URL.
- [ ] T033 [P] [US3] Extend `assignment-item.test.tsx` for the submitted view with downloads, the unavailable state and the archived-course state; extend `assignment.e2e.ts`: the download works, a second student can't read the first student's submission, hiding the assignment hides the submission and showing it brings it back.

### Implementation for User Story 3

- [ ] T034 [US3] `assignment.mySubmission` and `assignment.submissionFileUrl` in `packages/apis/core-api/src/procedures/assignment.ts`, using `getSignedCloudFrontFileUrl` and `localObjectUrl` as `contentItem.fileUrl` does in `procedures/content-item.ts`.
- [ ] T035 [US3] The submitted view in `assignment-item.tsx`: file name and size, submitted time, late flag, "Version <n>", **Download** (calls `submissionFileUrl`), the locked and archived-course texts; show it on load via `mySubmission`.
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

- [ ] T042 [P] Update the docs site (`docs/`) where it describes lesson content or assignments, and `CONTRIBUTING.md` only if it lists the moved `lib/` helpers. Translate any changed English docs page locally and commit the translations, or note in the PR description that translations are pending (constitution VIII).
- [ ] T043 Run `pnpm lint`, `pnpm test` and `pnpm build`; fix every failure in the code, not the tests.
- [ ] T044 **(human)** Run [quickstart.md](./quickstart.md) by hand against `pnpm dev`, saving numbered screenshots of the key steps, including any failure, to `tmp/screenshots/pr-<number>/`. Also check spec SC-001 (open to confirmed submission in under 2 minutes) and SC-008 (the outline marking is recognisable at a glance) by hand with at least a few people, and record the result in the PR; no automated test covers them.
- [ ] T045 **(human)** Measure the submit time for a 100 MB file locally and note it in the PR (plan risk R1); if it nears the function's 25 s timeout, raise it before merging.
- [ ] T046 Update issue #102's body: part 2 is done, decisions 2, 3 and 6 are recorded as settled (4 already is), and the PR says "Refs #102", never a closing keyword, because part 3 (grading) is still to come.

---

## Dependencies and order

- Phase 1 → Phase 2 → stories. Within Phase 2: T002–T007 (shared code) are sequential except T007; T008 and T009 are independent of them; T047 → T048 → T010 → T013 are sequential (the record's shape, the cleanup check that reads it, the helper, then the invariants file; T047 and T048 were added after the list was numbered, so their numbers are out of order); T021 → T023 are sequential.
- **US1** depends only on Phase 2. **US2** extends US1's `submit` and form, so it follows US1. **US3** needs a submission to exist, so it follows US1 (it can run alongside US2: different procedures). **US4** needs only T008, so it can start after Phase 2, in parallel with US1.
- Tests in each story come before its implementation.

## Parallel examples

- Phase 2: T007 with T008 and T009 once T002–T006 are done.
- US1: T014, T015 and T016 together; then T017 to T023 (backend, infra last) alongside T024 (portal) once the schemas exist.
- After Phase 2: US1 backend, US4 portal work, and the US2/US3 test writing in parallel.

## Implementation strategy

- **MVP**: Phase 1, Phase 2 and US1. A student can submit and see it counted. Resubmitting, viewing and the outline follow as separate, reviewable increments.
- Deliver in the order US1 → US2 → US3 → US4; each checkpoint leaves the table passing the invariant check.
- The Phase 2 refactor and the `course.view` fix are the riskiest changes to existing behavior: land and verify them before building on them.
