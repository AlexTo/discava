---

description: "Task list for grading and feedback for upload assignments"
---

# Tasks: Grading and Feedback for Upload Assignments

**Input**: Design documents from `/specs/20261120-230057-assignment-grading/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they are included:

- unit tests for every helper and procedure, covering authorization, version and revision conflicts, and points bounds;
- invariant checks (five new, one extended), each with a test that breaks it;
- component tests for both portals;
- a `packages/e2e` scenario and concurrency tests.

Write each phase's tests first and see them fail. Never weaken an existing test to make it pass. Two tasks change an existing expectation because the behavior changes on purpose (T005: a resubmit's condition now accepts `resubmission_requested`; T009: `mySubmission` gains fields). Each names the change, and its PR description must repeat it.

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. It writes the e2e scenario and the concurrency tests, and PR CI runs them (`pr-checks.yml`'s `E2E tests` job); a CI failure is the feedback for those. Tasks marked **(human)** need a running local stack, a deployed stage or people, and a reviewer does them before merge.

**Organization**: Eight phases in the order the code needs them, each one agent PR, merged in order. Each PR leaves `main` green and working. Paths are relative to the repository root. Only the last PR closes #102; earlier PRs say "Part of #102" and must not use a closing keyword.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Return a submission with a grade and feedback (includes amending a returned grade) | P1 |
| US2 | Student sees the grade and feedback | P1 |
| US3 | Ask for a resubmission with feedback | P2 |
| US4 | See which work has waited longest | P2 |
| US5 | A grading queue on the instructor home page | P3 |

US1 and US3 share the instructor API (Phase 3) and the review page (Phase 5), so US3's tasks sit in those phases with their own label.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - grading data and its rules (core-table)

**Goal**: The core table can hold a grade, a resubmission request, feedback rounds and the daily notice marker, written only through shared helpers and guarded by invariants. Nothing calls the new helpers yet, so nothing a user sees changes.

**Independent test**: `pnpm nx run @discava/core-table:test -- --run assignment-submission assignment-grading notification-types invariants` passes, and `pnpm nx run @discava/tooling-agent:entity-writers` leaves no diff.

- [x] T001 [P] Tests first, then add three types to `NOTIFICATION_TYPES` in `packages/databases/core-table/src/helpers/notification-types.ts`, per [data-model.md](./data-model.md) (Notification types):
  - `assignment.resubmission_requested`: student, `emailPolicy: 'default-on'`, params `['courseId', 'lessonId', 'assignmentTitle', 'courseTitle']`, title `Resubmission requested: "${assignmentTitle}"`, link `{ portal: 'student', path: '/learn/${courseId}/lesson/${lessonId}' }`.
  - `assignment.grade_updated`: student, `'default-on'`, same params and link, title `Your grade for "${assignmentTitle}" was updated`.
  - `assignment.submissions_received`: instructor, `emailPolicy: 'default-off'`, params `['courseId', 'contentItemId', 'assignmentTitle', 'courseTitle']`, title `New submissions to "${assignmentTitle}"`, body naming the course, link `{ portal: 'instructor', path: '/my-courses/${courseId}/assignments/${contentItemId}/submissions' }`.

  Extend `notification-types.test.ts`'s list of registered ids and policies, and add a `buildNotification` case per new type.
- [x] T002 Tests first, then change `packages/databases/core-table/src/entities/assignment-submission.ts` per [data-model.md](./data-model.md) (`assignmentSubmission`):
  - `status: ['submitted', 'resubmission_requested', 'returned']`;
  - `reviewRevision` (number, required, default 0);
  - optional `points`, `pointsOutOf`, `returnedAt`, `returnedBy`, `gradedAt`, `waitingCourseId`, `waitingSince`;
  - a new sparse `byWaiting` index on `gsi1pk-gsi1sk-index`, with pk template `$assignmentsubmission_waiting#${waitingCourseId}`, sk composites `['waitingSince', 'contentItemId', 'userId']`, and a `condition` that writes the keys only when `waitingCourseId` and `waitingSince` are both present. Copy `discussionPost.byUnanswered` in `entities/discussion-post.ts:161-196`, including its comment about when ElectroDB re-evaluates the condition.

  Update the entity's comment (grading is no longer "still to come"). In `entities/assignment-submission.test.ts`:
  - a `submitted` item with both waiting attributes has `gsi1pk`/`gsi1sk`;
  - an item without them has neither;
  - a patch that removes both clears the keys.
- [x] T003 [P] Tests first, then add `packages/databases/core-table/src/entities/submission-feedback.ts` and `submission-feedback.test.ts`. Attributes and keys come from [data-model.md](./data-model.md) (`submissionFeedback`):
  - pk `[courseId, contentItemId, userId]`, sk `[givenAt, feedbackId]`;
  - `kind: ['resubmission_requested', 'returned', 'amended']`;
  - `feedback` optional string;
  - `points`, `pointsOutOf` optional numbers;
  - `version`, `givenAt`, `givenBy` required.

  Also add `packages/databases/core-table/src/entities/submission-notice.ts` with its test: pk `[courseId, contentItemId]`, sk `[day]`, `ttl` a number. Register both in `entities/index.ts` and `src/service.ts`.
- [x] T004 Tests first, then add `packages/databases/core-table/src/helpers/assignment-grading.ts`. It holds pure `*Writes` functions that return transaction items and run no I/O, as `assignmentSubmissionWrites` does:
  - `FEEDBACK_MAX_LENGTH = 20_000`.
  - `isValidPoints(points, maxPoints)`: a number, `0 ≤ points ≤ maxPoints`, at most two decimal places.
  - `waitingKeys(status, courseId, submittedAt)`: `{ waitingCourseId, waitingSince }` when `status === 'submitted'`, otherwise the two names to remove.
  - `returnSubmissionWrites`: submission patch `status: 'returned'`, grade fields, `gradedAt`, `reviewRevision + 1`, waiting keys removed. The `where` clause is `version = v AND reviewRevision = r AND status IN ('submitted', 'resubmission_requested')`. It also writes a `submissionFeedback` create (`kind: 'returned'`) and `notificationWrites(… 'assignment.returned', dedupeKey: feedbackId)`.
  - `requestResubmissionWrites`: `status: 'resubmission_requested'`, `where version = v AND reviewRevision = r AND status = 'submitted'`, a round with non-empty feedback and no points, and `assignment.resubmission_requested`.
  - `amendGradeWrites`: `where status = 'returned' AND reviewRevision = r`; it sets `points`, `pointsOutOf` and `gradedAt` and leaves `returnedAt`/`returnedBy`; a round of kind `amended`; `assignment.grade_updated`.
  - `submissionsReceivedNotificationWrites(service, { courseId, contentItemId, day, instructorIds, … })`: a `submissionNotice` create with `attribute_not_exists` and `ttl` two days after `day`, plus one `assignment.submissions_received` per de-duplicated instructor (dedupe key `${contentItemId}:${day}`), capped at `MAX_SUBMISSION_NOTICE_INSTRUCTORS = floor((100 - 8) / 2)`. Follow `reviewNotifications` in `helpers/review.ts:162-206`.

  `assignment-grading.test.ts` checks each function's items, conditions, and the exact transaction size of 4 for the three instructor writes (data-model, Transaction contents). It also asserts that none of the three writes touches `itemCompletion` or the content item's `studentActivityCount` (spec FR-013).
- [x] T005 Tests first, then change `assignmentSubmissionWrites` in `packages/databases/core-table/src/helpers/assignment-submission.ts`:
  - the resubmit `where` becomes `version = existing.version AND status IN ('submitted', 'resubmission_requested')`;
  - the patch sets `status: 'submitted'` and `waitingKeys(...)`;
  - the create sets `reviewRevision: 0` and `waitingKeys(...)`.

  In `assignment-submission.test.ts`, change the expected resubmit condition (an intended behavior change; say so in the PR) and add cases:
  - a resubmit from `resubmission_requested` returns to `submitted` with fresh waiting keys;
  - a resubmit of a `returned` submission is still refused by the condition;
  - a resubmit from `resubmission_requested` doesn't add to `studentActivityCount` and leaves the existing completion as it is (spec FR-013, data-model impact check).
- [x] T006 Tests first, then add `packages/databases/core-table/src/helpers/invariants/assignment-grading.ts` with the five checks in [data-model.md](./data-model.md) (Invariants): `submission-grade-shape`, `submission-waiting-keys`, `submission-feedback-has-submission`, `submission-feedback-shape` and `submission-latest-round-matches`.
  - Register them in `helpers/invariants/index.ts`.
  - In `helpers/invariants/snapshot.ts`, add the new `assignmentSubmission` attributes, and add `submissionFeedback` to both `TableSnapshot` (as `Item<typeof createSubmissionFeedbackEntity>`) and `SNAPSHOT_ENTITIES`.
  - Add `'submission-notice'` to `NO_INVARIANTS` in `packages/databases/core-table/src/helpers/invariants-coverage.test.ts`, with the reason "only deduplicates the daily instructor notice; the notifications it guards are checked" (data-model: it holds no rule beyond its key). Without this, `invariants-coverage.test.ts` fails for the new entity file from T003.
  - Widen `checkAssignmentSubmissionShape` (`helpers/invariants/student-activity.ts:399-450`) to the new status and fields.
  - In `assignment-grading.test.ts`, starting from `consistentTable()`, break each clause and expect its violation. Also give `consistentTable()` a returned submission with two rounds (request, then return) so every check runs on real data.
- [x] T007 Run `pnpm nx run @discava/tooling-agent:entity-writers` and commit `packages/databases/core-table/entity-writers.json`.

---

## Phase 2: Foundational - students resubmit on request and read feedback (core-api)

**Goal**: core-api treats `resubmission_requested` as open for submitting, puts a resubmission back to waiting, and returns the grade and feedback rounds. No instructor can set those states yet, so students see no change.

**Independent test**: `pnpm nx run @discava/core-api:test -- --run assignment` passes.

- [x] T008 [P] Tests first, then widen `MySubmissionOutputSchema` (or its equivalent) in `packages/apis/core-api/src/schema/assignment.ts` to [contracts/core-api-assignment.md](./contracts/core-api-assignment.md):
  - `status` gains `'resubmission_requested'`;
  - optional `grade: { points, pointsOutOf, returnedAt, gradedAt }`;
  - `feedback` is an array of `{ kind, feedback?, points?, pointsOutOf?, version, givenAt }`, without `givenBy`.
- [x] T009 Tests first, then change `packages/apis/core-api/src/procedures/assignment.ts`:
  - `requireOpenForSubmitting` (`:138-151`) refuses only `returned`;
  - `toSubmission` maps the grade;
  - `mySubmission` queries `submissionFeedback` for the caller's pk in reverse (newest first) and returns the rounds, with the same visibility rules as today.

  In `assignment.test.ts`, extend the `mySubmission` expectation with `feedback: []` (an intended output change; say so in the PR), and add cases:
  - resubmitting from `resubmission_requested` succeeds and returns `status: 'submitted'`;
  - `returned` is still refused;
  - a returned submission returns its grade and rounds newest first;
  - no `givenBy` leaks.

---

## Phase 3: User Story 1 - Return a submission with a grade and feedback (instructor-api) (P1) 🎯 MVP

**Goal**: The course's instructors can list an assignment's students and submissions, read one with its history, download its file, return it with points and feedback, amend a returned grade, and request a resubmission. Each write notifies the student in the same transaction.

**Independent test**: `pnpm nx run @discava/instructor-api:test -- --run assignment-submission` passes and `pnpm nx run @discava/infra:synth` succeeds.

- [x] T10 [P] [US1] Tests first, then add `packages/apis/instructor-api/src/schema/assignment-submission.ts` from [contracts/instructor-api-assignment-submission.md](./contracts/instructor-api-assignment-submission.md):
  - `FeedbackSchema = z.string().max(20_000).refine(isValidTiptapDocument)`;
  - `PointsSchema = z.number().min(0).multipleOf(0.01)`;
  - inputs for `list` (`cursor` optional), `get`, `fileUrl`, `return` (`version`, `reviewRevision`, `points`, `feedback?`), `requestResubmission` (`feedback` required, refined to non-empty text as `schema/announcement.ts:17-24` does) and `amendGrade`;
  - the output schemas.

  Export them through `schema/index.ts`. Test the bounds: 20 001 characters refused, invalid Tiptap refused, an empty-text request refused, `points: -1` and `points: 1.005` refused.
- [x] T11 [P] [US1] Tests first, then add `packages/apis/instructor-api/src/helpers/submission-list.ts`. It is a pure function that merges enrolments and submissions into rows and sorts them in the order of research R-4 and the contract:
  1. enrolled `submitted` by `submittedAt` ascending;
  2. `resubmission_requested`;
  3. `returned`;
  4. `not_submitted`;
  5. dropped students with a submission, last.

  Ties are broken by `userId`. It returns pages of 50 with an opaque base64 cursor of the last row's sort tuple, and whole-assignment `counts` that exclude dropped students from `waiting`.

  `submission-list.test.ts` covers:
  - every state;
  - a dropped student without a submission (not listed);
  - a dropped student with one (last, `enrolled: false`);
  - the ties;
  - a page boundary staying stable when a row before the cursor changes state.
- [x] T12 [US1] Tests first, then add `listAssignmentSubmissions` and `getAssignmentSubmission` in `packages/apis/instructor-api/src/procedures/assignment-submission.ts`. Register them as `assignmentSubmission.list` and `.get` in `src/router.ts`.
  - Both are `courseInstructorProcedure`.
  - The item must be `type: 'assignment'` in the course (`NOT_FOUND` otherwise); hidden or archived content is allowed.
  - `list` reads access patterns A1, A2 and A9 from data-model and calls `submission-list.ts`.
  - `get` reads A3, A4 and A9. It returns `previewable` (`'pdf'` for `application/pdf`; `'image'` for png, jpeg, gif and webp; otherwise `null`) and `givenBy` display names through `defaultDisplayName`.

  `assignment-submission.test.ts` uses `mockCoreTable` as in `procedures/assignment.test.ts:14-49`. It covers:
  - another course's instructor and a student are `FORBIDDEN`;
  - a quiz item is `NOT_FOUND`;
  - the order and counts;
  - history newest first.
- [x] T13 [US1] Tests first, then add `assignmentSubmission.fileUrl` (`getSignedCloudFrontFileUrl(submission.file.key)`, or `localObjectUrl` when `isLocalDev()`; `NOT_FOUND` without a submission) in the same procedures file. Add it to the `MediaUrl` list in `INSTRUCTOR_API_DEDICATED_FUNCTIONS` (`packages/common/constructs/src/app/apis/instructor-api.ts:61-65`). Then check `pnpm nx run @discava/infra:synth` succeeds.
- [x] T14 [US1] Tests first, then add `returnAssignmentSubmission` and `amendAssignmentGrade` (`assignmentSubmission.return`, `.amendGrade`) to the procedures file. Each one:
  1. reads the item (`maxPoints`, lesson title), course title, submission and enrolment;
  2. refuses `dropped` enrolment with `PRECONDITION_FAILED` "This student has left the course. Their work can be read but not graded.";
  3. refuses points over `maxPoints` with `BAD_REQUEST` "Points must be between 0 and N";
  4. refuses the wrong state with `PRECONDITION_FAILED`;
  5. runs one `transaction.write` of `returnSubmissionWrites` or `amendGradeWrites`, with a new ULID `feedbackId`;
  6. maps a cancelled transaction, after re-reading, to `CONFLICT` with a message naming what changed: "The student submitted a newer version", "Another instructor already returned this", or "The grade was changed by someone else".

  Cases:
  - success writes 4 items;
  - each refusal;
  - stale `version`;
  - stale `reviewRevision`;
  - two returns from one revision (one `CONFLICT`);
  - replaying a return that already committed (same `version` and `reviewRevision`) gets `CONFLICT` and writes no second notification (spec US2 scenario 4);
  - an amend keeps `returnedAt`.
- [x] T15 [US3] Tests first, then add `requestAssignmentResubmission` (`assignmentSubmission.requestResubmission`) to the procedures file with the same reads, enrolment and conflict handling as T014. It is allowed only from `submitted` and uses `requestResubmissionWrites`. Cases:
  - success;
  - from `resubmission_requested` and from `returned` refused;
  - empty feedback refused by the schema;
  - a stale version is `CONFLICT`.

---

## Phase 4: User Story 2 - Student sees the grade and feedback (student portal) (P1)

**Goal**: A student sees points out of the maximum and the feedback once returned, the request's feedback beside an open resubmit form when a resubmission is requested, and earlier rounds of feedback.

**Independent test**: `pnpm nx run @discava/student-portal:test -- --run assignment-item assignment-feedback` passes.

- [ ] T016 [P] [US2] Tests first, then add `packages/websites/student-portal/src/routes/learn/$courseId/-components/assignment-feedback.tsx`.
  - It renders one round with `RichTextView`: kind label ("Resubmission requested", "Returned", "Grade updated"), date, version, and `points / pointsOutOf` when present.
  - It also renders an "Earlier feedback" list, collapsed by default and newest first.
  - `assignment-feedback.test.tsx` covers each kind and the collapsed list.
- [ ] T017 [US2] Tests first, then change `assignment-item.tsx` per [contracts/portal-ui.md](./contracts/portal-ui.md) (Student portal):
  - `locked` stays `status === 'returned'`;
  - `returned` shows "Returned" with points / pointsOutOf, the latest feedback, the returned date, and "updated" with `gradedAt` when an amendment exists;
  - `resubmission_requested` shows the notice "Your instructor asked you to resubmit", the request's feedback, the current file and the resubmit form open by default;
  - earlier rounds go under `AssignmentFeedback`.

  Extend the `submission()` fixture in `assignment-item.test.tsx` with `feedback: []` and add a case per state. Text-only buttons.

---

## Phase 5: User Story 1 - Instructor submissions and review screens (instructor portal) (P1)

**Goal**: From the course editor, an instructor opens an assignment's submissions, sees each student's state and time waited, opens a submission with an in-page preview for PDFs and images, and returns, requests a resubmission or amends. Unsent work survives a reload.

**Independent test**: `pnpm nx run @discava/instructor-portal:test -- --run submissions grading-draft file-preview` passes; CI's E2E job passes `assignment-grading.e2e.ts`.

- [ ] T018 [P] [US1] Tests first, then add `packages/websites/instructor-portal/src/lib/grading-draft.ts`, modelled on `readQuizDraft`/`writeQuizDraft` in `packages/common/web-utils/src/quiz.ts:200-220`:
  - `readGradingDraft(ref)`, `writeGradingDraft(ref, { points?: string, feedback?: string })` and `clearGradingDraft(ref)`;
  - key `discava:grading-draft:${courseId}:${contentItemId}:${userId}`;
  - every storage access in try/catch, and a failure means no draft.

  `grading-draft.test.ts` covers the round trip, clearing, and storage that throws.
- [ ] T019 [P] [US1] Add `react-pdf` 11.x to the `catalog:` in `pnpm-workspace.yaml` (`catalogMode: strict`), with `pdfjs-dist` at least 6.2.108 (CVE-2026-16633), and to `packages/websites/instructor-portal/package.json`.
  - Tests first, then add `-components/file-preview.tsx` and `-components/pdf-preview.tsx` under `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId_/assignments/$contentItemId/submissions/`.
  - `file-preview` chooses by `previewable`: `<img>` for `'image'`; a `React.lazy` import of `pdf-preview` for `'pdf'`; otherwise the file's name, type, size and a "Download" button.
  - `pdf-preview` uses react-pdf with the worker set via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`, `isEvalSupported: false`, and page navigation. On a load or render error it shows "This file can't be previewed" and "Download".
  - Both fetch a fresh URL from `assignmentSubmission.fileUrl` when shown.
  - Tests mock react-pdf: an image renders `<img>`; a docx shows Download only; a PDF load error shows the fallback.
  - Check `pnpm nx run @discava/instructor-portal:build` puts pdf.js in its own chunk.
- [ ] T020 [US1] Tests first, then add the list route `…/assignments/$contentItemId/submissions/index.tsx` and `-components/submissions-table.tsx` per [contracts/portal-ui.md](./contracts/portal-ui.md) (Submissions list):
  - header with "Back to course";
  - count chips;
  - table of Student, Status, Submitted (`relativeTime` from `@discava/common-web-utils/discussion`, plus a "Late" badge), Version and Points;
  - "No longer enrolled" badge;
  - "Load more" paging as `questions/-components/paged-list.tsx` does;
  - loading, empty and error states;
  - `useBreadcrumbLabel(assignment.title)`.

  Also:
  - add `assignments: 'Assignments'` and `submissions: 'Submissions'` to `segmentLabels` in `packages/websites/instructor-portal/src/components/app-layout.tsx`;
  - add a "Submissions" link for upload assignments in the lesson row of `-components/course/course-modules.tsx` (`:175-195`).

  Component tests: order as given by the API, badges, paging, empty state, and the link only on upload assignments (not quiz assignments).
- [ ] T021 [US1] Tests first, then add the review route `…/submissions/$userId.tsx` with `-components/grading-form.tsx` and `-components/feedback-history.tsx` per the contract (Review page):
  - details;
  - `FilePreview`;
  - a points input ("out of N") and the local `RichTextEditor` for feedback;
  - "Return";
  - "Edit grade" when returned, which submits through `amendGrade`;
  - the left-the-course message instead of the form;
  - the history, newest first.

  The form loads and saves its draft through `grading-draft.ts` (debounced) and clears it on success. On `CONFLICT` it shows the server's message, refetches `get` and keeps the draft. Sending passes the `version` and `reviewRevision` it rendered. Tests: return, amend, the not-enrolled state, draft restored after remount, draft kept on `CONFLICT`, points over the maximum refused before sending.
- [ ] T022 [US3] In `grading-form.tsx`, add "Request resubmission". It is shown only when the state is `submitted`, disabled until the feedback has text, and calls `assignmentSubmission.requestResubmission`. Component tests: hidden for `resubmission_requested` and `returned`; disabled with empty feedback; sends the feedback.
- [ ] T023 [US1] Add grading helpers to `packages/e2e/src/helpers/assignment.ts`: `openSubmissions`, `openSubmissionReview`, `returnSubmission(points, feedback)`, `requestResubmission(feedback)` and `editGrade`. Then add `packages/e2e/src/scenarios/assignment-grading.e2e.ts`, with its own users and uniquely named course (`createUploadAssignmentCourse`, `newUser`). Steps:
  1. Two students submit (one PDF, one docx). The instructor's list shows both waiting, oldest first.
  2. The PDF previews and the docx offers Download.
  3. Request resubmission. The student sees the feedback and the open form, and has a "Resubmission requested" notification.
  4. The student resubmits. The submission is waiting again at version 2.
  5. Return 17 / 20. The student sees the grade and feedback and no form, and has an "assignment returned" notification and email (`emailsFor`).
  6. Edit the grade to 18. The student has a "grade updated" notification.
  7. 25 points are refused.

  Call `screenshot()` after the list, the PDF preview, the request, the student's resubmission view, the return form, and the student's returned view. (The read-only state of a student who left the course is covered by T014 and T021: e2e has no helper to make a student leave.)
- [ ] T024 [US1] Add to `packages/e2e/src/concurrency/concurrent-writes.e2e.ts`, through `apiClients`:
  - two instructors return the same submission at the same moment: exactly one succeeds and the other gets `CONFLICT`;
  - an instructor's return races the student's resubmit: exactly one commits, and if the resubmit won, the submission is waiting at the new version with no grade.

---

## Phase 6: User Story 4 - See which work has waited longest (P2)

**Goal**: Instructors are told about new work at most once per assignment per day, and the list's oldest-first order and time waited (built in Phases 3 and 5) are checked end to end.

**Independent test**: `pnpm nx run @discava/core-api:test -- --run assignment` passes; CI's E2E job passes the new cases.

- [ ] T025 [US4] Tests first, then change `submit` in `packages/apis/core-api/src/procedures/assignment.ts`:
  1. compute `day` (UTC `YYYY-MM-DD`) from the submit time;
  2. get the `submissionNotice` for `{ courseId, contentItemId, day }`;
  3. if it's absent, load the course's instructors (`courseInstructor.query.primary({ courseId })`, as `core-api/src/procedures/review.ts:216-236` does), the course title and the assignment lesson title, and append `submissionsReceivedNotificationWrites` to the transaction;
  4. when a try is cancelled, classify the reasons. If only the marker's condition failed, retry within `MAX_SUBMIT_TRIES` without the notice items, and never surface that as `CONFLICT` to the student (plan risk R5).

  Cases:
  - the first submission of the day writes the marker and one notification per instructor;
  - a second submission that day writes neither;
  - a marker race retries and succeeds;
  - instructors beyond the cap are not notified;
  - a resubmission also counts.
- [ ] T026 [US4] Extend `assignment-grading.e2e.ts`: three students submit to one assignment on the same day. Each instructor has exactly one "New submissions" notification, and it opens the assignment's submissions. The list shows the three oldest first with a time waited. Add a concurrency case to `concurrent-writes.e2e.ts`: two students' first submissions of the day at the same moment both succeed, and instructors get one notification.

---

## Phase 7: User Story 5 - A grading queue on the instructor home page (P3)

**Goal**: The instructor home page shows waiting work across all the instructor's courses, oldest first, with a total, and each entry opens its review page.

**Independent test**: `pnpm nx run @discava/instructor-api:test -- --run grading-queue` and `pnpm nx run @discava/instructor-portal:test -- --run index` pass; CI's E2E job passes `instructor-home.e2e.ts`.

- [ ] T027 [US5] Tests first, then add `packages/apis/instructor-api/src/procedures/grading-queue.ts`, registered as `gradingQueue.list` (input `{ limit?: number }`, default 20, max 50) per the contract:
  1. `courseInstructor.byInstructor` for `ctx.user.sub`;
  2. `assignmentSubmission.query.byWaiting({ waitingCourseId })` per course, reading every page;
  3. batch-get the enrolments and drop `dropped` ones;
  4. merge oldest first;
  5. resolve course titles, assignment lesson titles and display names.

  `total` counts every enrolled waiting entry. `grading-queue.test.ts` covers: two courses merged in order, dropped students excluded from items and total, the limit, and an instructor with no courses.
- [ ] T028 [US5] Tests first, then add a "Waiting for grading" section to `packages/websites/instructor-portal/src/routes/_authenticated/index.tsx` per the contract (Home page):
  - the total;
  - up to 10 rows (student, assignment, course, waited via `relativeTime`), each linking to `/my-courses/$courseId/assignments/$contentItemId/submissions/$userId`;
  - empty text "Nothing is waiting for grading.";
  - loading and error states.

  None of the strings `instructor-home.e2e.ts:11-23` forbids may appear. Extend `-index.test.tsx` with a case for items and one for empty.
- [ ] T029 [US5] Extend `packages/e2e/src/scenarios/instructor-home.e2e.ts`: with a waiting submission in each of two courses, the section lists both oldest first with the right total and opens the review page; after returning one, it leaves the queue. Keep the existing assertions that the forbidden strings never appear. Call `screenshot()` on the section.

---

## Phase 8: Polish - docs and manual checks

**Goal**: The design pages describe the feature, and reviewers confirm by hand what tests can't.

- [ ] T030 [P] Add `docs/src/content/docs/en/design/assignments.mdx`, a design page for upload assignments covering:
  - submissions and grading: the status machine as a table from data-model;
  - feedback rounds;
  - the waiting index and why enrolment is applied at read time;
  - the daily notice marker;
  - the preview approach and its JPEG 2000/JBIG2 gap;
  - a "Spec" link to `specs/20261120-230057-assignment-grading/`, in the style of `video-player.mdx`.

  Add its row to `docs/src/content/docs/en/design/index.mdx`, and add a "**Design page**" line to this feature's `spec.md`. Note in the PR that translations of the other locales are pending.
- [ ] T031 [P] Add a line under "Features" in `packages/databases/core-table/CLAUDE.md`: grading (#102), with `assignment-grading.ts` as the only writer of grade fields, waiting keys and `submissionFeedback`. Add `assignmentSubmission` and `gradingQueue` to the feature notes in `packages/apis/CLAUDE.md`.
- [ ] T032 **(human)** Run [quickstart.md](./quickstart.md) steps 1 to 11 against `pnpm dev` in Chrome and Firefox, saving screenshots to `tmp/screenshots/pr-<number>/`. Confirm SC-001: returning one piece of work takes under 2 minutes, not counting reading time.
- [ ] T033 **(human)** Run quickstart step 12 after Phase 7 merges: the home queue's count matches the waiting submissions across two courses (SC-008).
- [ ] T034 **(human)** On `discava-development` after the last PR deploys:
  - a PDF and an image preview in Chrome, Safari and Firefox through the signed CloudFront URL (CORS, no CSP errors in the console);
  - "assignment returned" and "resubmission requested" emails arrive;
  - "new submissions" email stays off unless turned on in notification settings.

---

## Dependencies & Execution Order

- **Phase order**: 1 → 2 → 3, then 4 and 5 in either order (both need 3; 4 needs only 2 and 3), then 6 (needs 1's notice helper and 5's list for its e2e), then 7 (needs 1's index), then 8.
- **Within Phase 1**: T001, T002 and T003 in parallel; T004 after T002 and T003; T005 after T004 (`waitingKeys`); T006 after T002 to T005; T007 last.
- **Within Phase 2**: T008, then T009.
- **Within Phase 3**: T010 and T011 in parallel; T012 after both; T013, T014 and T015 after T012 (T014 and T015 share a file, so one after the other).
- **Within Phase 4**: T016, then T017.
- **Within Phase 5**: T018 and T019 in parallel; T020; T021 after T018 and T019; T022 after T021; T023 and T024 last.
- **Within Phase 6**: T025, then T026.
- **Within Phase 7**: T027, T028, T029.
- **Phase 8**: T030 and T031 any time after Phase 5; the **(human)** tasks last.

## Parallel Example

```text
Phase 1:  T001 (notification types)  ║  T002 (submission entity)  ║  T003 (feedback + notice entities)
Phase 3:  T010 (schemas)  ║  T011 (list ordering helper)
Phase 5:  T018 (grading draft)  ║  T019 (file and PDF preview)
Phase 8:  T030 (design page)  ║  T031 (CLAUDE.md notes)
```

## Implementation Strategy

- **MVP (Phases 1 to 5)**: an instructor can find, review and return work with points and feedback, request a resubmission and amend a grade; the student is notified and sees it. This closes the loop the issue describes ("a student who submits work never hears back").
- **Then**: Phase 6 (daily instructor notice) and Phase 7 (home queue), each a small PR that leaves `main` working.
- **Finally**: Phase 8's docs, and the reviewer's manual checks before the last PR merges. The last PR closes #102.
