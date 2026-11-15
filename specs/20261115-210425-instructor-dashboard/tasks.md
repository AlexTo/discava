---

description: "Task list for the instructor dashboard and course analytics"
---

# Tasks: Instructor Dashboard and Course Analytics

**Input**: Design documents from `/specs/20261115-210425-instructor-dashboard/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: unit tests for each helper, the handler and each procedure, component tests for each page, the invariant `analytics-matches-records` with a test that breaks it, and a `packages/e2e` scenario plus a concurrency test. Write each story's tests first and see them fail. Never weaken an existing test to make it pass (constitution IV).

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The e2e scenario and the concurrency test are written by the agent but run on PR CI (`pr-checks.yml`'s `E2E tests` job, which runs `nx affected --target e2e`); a CI failure is the feedback for those. Tasks marked **(human)** need a running local stack or people, and are done by a reviewer before merging.

**Organization**: Grouped by user story so each can be built and tested on its own. Paths are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 summary cards (P1), US2 enrolments and activity over time (P2), US3 lesson drop-off (P2), US4 quiz analysis (P3)

---

## Phase 1: Setup

- [ ] T001 Check the `nx-plugin-for-aws` MCP server's `list-generators` and `generator-guide` for `ts#lambda-function`, then add a Lambda function `analytics-update` to the existing `@discava/events` project with it (handler `packages/events/src/analytics/analytics-update.ts`, exporting `handler`), as `progress-recalculation` was added; keep the generator's output (construct wrapper under `packages/common/constructs/src/app/` or `lambda-functions/`, SPDX headers) untouched. Note in the PR that it is generator-created (constitution II).
- [ ] T002 Check `packages/events/package.json` and `packages/databases/core-table/package.json` already list `electrodb` and `@aws-sdk/client-dynamodb` directly; add them where missing (TS2883, see CLAUDE.md), then `pnpm i`.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the aggregate entities, the contribution and write helpers, the stream handler and its wiring, the invariant and the rebuild. Enrolments are the first contribution; later stories add theirs.

**⚠️ CRITICAL**: no user story work starts until this phase is done.

### Entities (data-model.md)

- [ ] T003 [P] Add `packages/databases/core-table/src/entities/course-stats.ts`: pk `ANALYTICS#<courseId>`, sk `SUMMARY`, attributes `courseId` (string, required), `enrolments`, `completed`, `dropped` (numbers, default 0), `updatedAt` (string, set on every write). Follow the neighbouring entity files (`createXEntity`, `getDynamoDBClient`, `resolveTableName`).
- [ ] T004 [P] Add `packages/databases/core-table/src/entities/period-stats.ts`: same pk, sk `DAY#<yyyy-mm-dd>` or `WEEK#<yyyy>-W<ww>` (UTC), attributes `courseId`, `period` ('day' | 'week'), `enrolments` (days only), `activeLearners` (numbers, default 0).
- [ ] T005 [P] Add `packages/databases/core-table/src/entities/lesson-stats.ts`: same pk, sk `LESSON#<lessonId>`, attributes `courseId`, `lessonId`, `inProgress`, `completed` (numbers, default 0).
- [ ] T006 [P] Add `packages/databases/core-table/src/entities/quiz-question-stats.ts` (sk `QUIZ#<contentItemId>#Q#<questionId>`; `courseId`, `contentItemId`, `questionId`, `attempts`, `misses`) and `quiz-score-stats.ts` (sk `QUIZ#<contentItemId>#SCORES`; `courseId`, `contentItemId`, `band0` .. `band9`, numbers default 0: students whose best score is in 0-9, 10-19, .. 90-100).
- [ ] T007 [P] Add `packages/databases/core-table/src/entities/analytics-marker.ts`: pk `ANALYTICSMARK#<courseId>`, sk `EVENT#<eventID>` or `MEMBER#<period>#<userId>`, attributes `courseId`, `ttl` (number, epoch seconds, required).
- [ ] T008 Register T003 to T007 in `packages/databases/core-table/src/entities/index.ts` and `packages/databases/core-table/src/service.ts` (aggregates in one `analytics` collection by shared pk); export from the package index. No index is added (constitution V).

### Stream filters and TTL (research R-4, R-2)

- [ ] T009 [P] Write `packages/databases/core-table/src/helpers/analytics-stream.test.ts` first: `matchesAnalyticsStreamFilters` passes INSERT and MODIFY of `enrolment`, `progress`, `quizSummary`, INSERT of `itemCompletion` and `quizAttempt`, REMOVE of `enrolment` and `progress`; and none of the six new entities (including markers) nor any record passes progress's or search's filters by way of this change.
- [ ] T010 Implement `packages/databases/core-table/src/helpers/analytics-stream.ts` (`ANALYTICS_STREAM_FILTERS`, `AnalyticsStreamRecord`, `matchesAnalyticsStreamFilters`, the same shape as `progress-stream.ts`); export from the package index.
- [ ] T011 [P] Enable DynamoDB TTL on the core table's `ttl` attribute in `packages/common/constructs/src/core/dynamodb.ts` (add a construct prop only if stages need to differ; default on), with a test in the construct's test file or `packages/infra/src/stages/application-stage.test.ts` asserting the table has `TimeToLiveSpecification` on `ttl`; keep checkov passing.

### Contributions, writes and rebuild (research R-2, R-3)

- [ ] T012 [P] Write `packages/databases/core-table/src/helpers/analytics.test.ts` first for the enrolment contribution: an enrolment contributes `enrolments` +1 on its `createdAt`'s UTC day (23:59:59 and 00:00:00 land on different days) and to the summary, `completed` +1 when status is completed, `dropped` +1 when dropped; a change of status moves the count (`contributions(new) - contributions(old)`); a REMOVE subtracts the old; a record with neither image yields nothing.
- [ ] T013 Implement `packages/databases/core-table/src/helpers/analytics.ts`: pure `contributions(entity, image)` returning `{ counts: Delta[], members: Member[] }` (a count delta names an aggregate item key and attribute; a member is a distinct learner for a period), `diffContributions(old, new)`, and the UTC day and ISO-week helpers (weeks Monday to Sunday). Only the enrolment contribution now; later stories add theirs in this file's one table of contributions.
- [ ] T014 [P] Write `packages/databases/core-table/src/helpers/analytics-writes.test.ts` first (ElectroDB with the table mocked or DynamoDB local as the sibling helper tests do): `applyAnalyticsChange` writes the counts and an `EVENT#<eventID>` marker (`attribute_not_exists`, `ttl` = now + 7 days) in one transaction; applying the same event twice changes nothing; a member contribution writes `MEMBER#<period>#<userId>` plus its counter in its own transaction and a second application is skipped; day-member markers expire in 2 days, week-member markers in 9; one cancelled part does not cancel the others; counters are only ever changed with `add`.
- [ ] T015 Implement `packages/databases/core-table/src/helpers/analytics-writes.ts` (`applyAnalyticsChange(service, { eventId, courseId, counts, members, now })`), treating a `ConditionalCheckFailed` on a marker as "already applied" and rethrowing every other transaction error so the stream retries.
- [ ] T016 [P] Write the `rebuildCourseAnalytics` tests in `analytics.test.ts` first: given a course's enrolments it deletes the course's aggregate items and writes the sums of `contributions` over them; running it twice gives the same items; markers are untouched.
- [ ] T017 Implement `rebuildCourseAnalytics(service, courseId)` in `packages/databases/core-table/src/helpers/analytics-rebuild.ts`: reads enrolments by course, then each student's records by keyed query (`userId` + `courseId` prefix) as later stories need, sums contributions, replaces the course's aggregate items. It is tooling, never called from a request.

### Handler, wiring and local dev

- [ ] T018 [P] Write `packages/events/src/analytics/analytics-update.test.ts` first, in the style of `progress-recalculation.test.ts`: a batch of enrolment INSERT and MODIFY records produces the expected counts; the same batch delivered twice leaves the counts as after once; a batch where one record's write fails throws (so the mapping retries) after applying the others; a REMOVE subtracts; records for different courses are applied independently; aggregate and marker records in the batch are ignored.
- [ ] T019 Implement `packages/events/src/analytics/analytics-update.ts` on top of T013 and T015 with the same Powertools middleware as `progress-recalculation.ts` (`process.env.POWERTOOLS_SERVICE_NAME = 'AnalyticsUpdate'`, metrics `RecordsApplied`, `RecordsSkipped`), a memoized core table service, and bounded concurrency (10) per batch; the eventID of each record is its marker key.
- [ ] T020 Wire the third event source mapping in `packages/infra/src/stacks/core-api-stack.ts` as a `createAnalyticsUpdateLambda(coreTable)` method beside the progress and search ones: read-write on the core table, `RUNTIME_CONFIG_APP_ID` and AppConfig read as theirs, `batchSize: 100`, `maxBatchingWindow: 5s`, `retryAttempts: 5`, `bisectBatchOnError: true`, its own SQS-managed encrypted failure queue (`AnalyticsUpdateFailures`, 14 days, `enforceSSL`), filters built from `ANALYTICS_STREAM_FILTERS`. Extend `packages/infra/src/stages/application-stage.test.ts` for the mapping, its filters and the queue; check the resource count stays under 500 at `synth` (plan R5) and move the method to another stack only if it does not.
- [ ] T021 [P] Extend `packages/events/src/local/event-runner.ts` with a third batcher (`analyticsBatches`, 100 records or 5 seconds, `matchesAnalyticsStreamFilters`, invoking `analytics-update`), and its tests in `event-runner-server.test.ts` / `trigger-events.test.ts` where the others are covered; update the runner's doc comment and CLAUDE.md's description of the event runner (one sentence).

### Consistency check (constitution IV, plan Impact check)

- [ ] T022 Write the invariant tests first in `packages/databases/core-table/src/helpers/invariants.test.ts`: a snapshot whose aggregates equal the sums over its source records passes; a test that breaks the rule (an `enrolments` count off by one, a `completed` count for a status nobody has, a missing summary for a course with enrolments) reports each violation with the course id; a course with no enrolments and no items passes.
- [ ] T023 Add `analytics-matches-records` to `packages/databases/core-table/src/helpers/invariants.ts`: extend `TableSnapshot` with the aggregate records (`courseStats`, `periodStats`, `lessonStats`, `quizQuestionStats`, `quizScoreStats`; markers excluded) and the source records it needs; compare per course the stored items with the sums of `contributions` over the snapshot, treating a missing item as zeros; wire it into the checks the e2e suite runs and the snapshot loader that fills `TableSnapshot`.
- [ ] T024 Add to `packages/e2e/src/helpers/` a `waitForAnalytics` step used by the post-test invariant check: it re-reads the snapshot and re-runs only `analytics-matches-records` for up to 30 seconds (plan R2, research R-8) before reporting a violation; all other checks stay immediate. Unit-test the polling with fake timers.
- [ ] T025 [P] Add the `rebuild-analytics` target to `packages/common/scripts` (`project.json` and a script under `src/`, like `reset-local-data`): `pnpm nx run @discava/common-scripts:rebuild-analytics -- <courseId>` calls `rebuildCourseAnalytics` against the local or configured table; unit-test the argument handling.

**Checkpoint**: enrolment changes reach the aggregates exactly once, the invariant holds, and a rebuild reproduces them.

---

## Phase 3: User Story 1 - See how my courses are doing at a glance (P1) 🎯 MVP

**Goal**: the dashboard shows one card per course with enrolments, active this week and completion rate, readable only by the course's instructors.

**Independent Test**: enrol students, complete items for some, and check each card's figures equal those counted from the records; a non-instructor is refused.

### Tests for User Story 1 (write first, see them fail)

- [ ] T026 [P] [US1] Extend `analytics.test.ts` and `analytics-writes.test.ts` (core-table helpers): an `itemCompletion` contributes a member (learner active on `completedAt`'s UTC day and week) and a `quizAttempt` one on `submittedAt`; the same learner twice in a day counts once and counts once in the week when active on two days of it; a dropped enrolment's status change moves `completed` and `dropped`, but activity members are historical and are never removed (only lesson contributions move on a drop, see T044).
- [ ] T027 [P] [US1] Write `packages/databases/core-table/src/helpers/analytics-reads.test.ts`: `readCourseSummaries(courseIds)` returns each course's `enrolments`, `completed`, `dropped`, this week's `activeLearners` and `updatedAt` with one batch get per kind; a course without items returns zeros and `updatedAt: null`; counters below zero are clamped to 0.
- [ ] T028 [P] [US1] Write `packages/apis/instructor-api/src/procedures/analytics.test.ts` (pattern: `course.test.ts`, `t.createCallerFactory`, `vi.mock`) for `analytics.courseSummaries`: lists only the caller's courses (draft, published, archived); `completionRate` is `completed / (enrolments - dropped)` as a whole percent rounded down and `null` when the denominator is 0; a caller outside the `instructor` group gets `FORBIDDEN`; the output contains no student identifier; and the authorization matrix for later course-scoped procedures is written once in a shared `describe.each` (instructor, co-instructor, other instructor, student, removed instructor).
- [ ] T029 [P] [US1] Write `packages/websites/instructor-portal/src/routes/_authenticated/dashboard/-route.test.tsx` anew (the file exists with placeholder expectations: change it only as T034 names, the behavior change being the removal of placeholders): loading skeleton, no courses shows an invitation with a "Create a course" link, a card per course with enrolments, active this week, completion rate or "No data", "Last updated", the card links to `/dashboard/<courseId>`, an error shows "Retry", and none of the placeholder text ("illustrative placeholders") remains.
- [ ] T030 [P] [US1] Write `packages/e2e/src/scenarios/analytics.e2e.ts`: users and a uniquely named course made by the scenario (no reset); a student enrols and completes an item; the instructor's dashboard card shows 1 enrolment and 1 active this week within 30 seconds; a second instructor can't open the course's analytics page; the invariant check runs after the test (T024). Add a concurrency test in `packages/e2e/src/concurrency/` for several students enrolling and completing at the same moment: the card's enrolments and weekly active equal the number of students.

### Implementation for User Story 1

- [ ] T031 [US1] Add the `itemCompletion` and `quizAttempt` member contributions to `helpers/analytics.ts` and the member application to `helpers/analytics-writes.ts` (T026), extend `analytics-matches-records` and `rebuildCourseAnalytics` for them (reading each student's `itemCompletion` and `quizAttempt` by `userId` + `courseId`).
- [ ] T032 [US1] Implement `packages/databases/core-table/src/helpers/analytics-reads.ts`: `readCourseSummaries(service, courseIds)` per T027 (batch get of `SUMMARY` and of the current week's item), exported from the package.
- [ ] T033 [US1] Add `packages/apis/instructor-api/src/schema/analytics.ts` (zod, per [contracts/instructor-api-analytics.md](./contracts/instructor-api-analytics.md)) and `packages/apis/instructor-api/src/procedures/analytics.ts` with `courseSummaries` (courses from the caller's `courseInstructor` records via `byInstructor`, titles from the course records, figures from T032) and a shared `analyticsCourseProcedure` middleware that requires a `courseInstructor` record for `ctx.user.sub` and answers `NOT_FOUND` for an unknown course and for a course the caller does not teach alike; register `analytics` in `router.ts`.
- [ ] T034 [US1] Replace the placeholder content of `packages/websites/instructor-portal/src/routes/_authenticated/dashboard/route.tsx` with the summary cards per [contracts/instructor-portal-ui.md](./contracts/instructor-portal-ui.md), using `renderWithInstructorApi` conventions, the shared shadcn components, text-only buttons and no arrow icons; remove the placeholder data, the disclaimer banner and any now-unused chart code.
- [ ] T035 [US1] Run the US1 unit and component tests, lint, typecheck and `pnpm nx run @discava/infra:synth`.

**Checkpoint**: the dashboard shows true figures. First issue ends here.

---

## Phase 4: User Story 2 - Watch enrolments and activity over time (P2)

**Goal**: a course analytics page with totals and daily charts for 30 or 90 days.

**Independent Test**: create enrolments and activity on known days and compare each day's bars with the records.

### Tests for User Story 2 (write first)

- [ ] T036 [P] [US2] Extend `analytics-reads.test.ts` for `readCourseAnalytics(courseId, days)`: totals (`active = enrolments - completed - dropped`, never below 0), exactly `days` daily entries oldest first, zero filled, from the `periodStats` `between` range; and `analytics.test.ts` (instructor-api) for `analytics.course` totals and `daily` with `days` 30 and 90, `BAD_REQUEST` for another value, and the authorization matrix against it.
- [ ] T037 [P] [US2] Write `packages/websites/instructor-portal/src/routes/_authenticated/dashboard/$courseId/-route.test.tsx` (the `-` prefix, rendering `Route.options.component`): header with last updated, the 30/90 choice (default 90, kept in the search params), the totals row, the two daily charts with their text alternative tables, the empty state "No learners have enrolled yet", and the not-found page for a refused course. Extend `analytics.e2e.ts` to assert today's bars after an enrolment and a completion.

### Implementation for User Story 2

- [ ] T038 [US2] Implement `readCourseAnalytics` (totals, daily) in `helpers/analytics-reads.ts` and the `analytics.course` procedure (`days: 30 | 90`, default 90; `lessons` and `quizzes` empty until their stories) in `procedures/analytics.ts`.
- [ ] T039 [US2] Add the course analytics route `packages/websites/instructor-portal/src/routes/_authenticated/dashboard/$courseId/route.tsx` with components under `-components/` (totals row, daily charts using the shared chart components from `@discava/common-shadcn`, range choice); link dashboard cards to it if T034 did not.
- [ ] T040 [US2] Run the US2 tests.

**Checkpoint**: trends are visible.

---

## Phase 5: User Story 3 - Find the lessons where learners drop off (P2)

**Goal**: per-lesson started, completed and share, for lessons currently shown.

**Independent Test**: three students at different points in a four-lesson course; each lesson's figures match the progress records; hiding a lesson removes it from the list and showing it brings it back.

### Tests for User Story 3 (write first)

- [ ] T041 [P] [US3] Extend `analytics.test.ts`: a `progress` record contributes `inProgress` or `completed` to its lesson (not_started contributes nothing); a status change moves the count; a student's drop (enrolment to `dropped`) removes that student's lesson contributions by reading their `progress` records for the course (one keyed query), and is idempotent on redelivery; extend the invariant test for lesson sums and its breaking case; extend the rebuild test.
- [ ] T042 [P] [US3] Extend `analytics-reads.test.ts` and instructor-api's `analytics.test.ts`: `lessons` lists only shown lessons (not hidden or archived, nor in a hidden or archived module) in course order with `started = inProgress + completed`, `completionShare` null when `started` is 0; a hidden lesson keeps its stored counts and returns with them when shown again; a lesson without stats shows zeros.
- [ ] T043 [P] [US3] Extend `$courseId/-route.test.tsx` for the drop-off section (bars in course order, hover or focus numbers, lowest share marked, "No data" for an unstarted lesson, empty state) and `analytics.e2e.ts` for hide and show of a lesson.

### Implementation for User Story 3

- [ ] T044 [US3] Add the `progress` contribution and the drop handling to `helpers/analytics.ts` and `helpers/analytics-writes.ts`, extend `analytics-matches-records` and `rebuildCourseAnalytics` for lesson funnels (enrolments that are `dropped` contribute nothing to lessons), and keep the handler's concurrency bound for the per-student read.
- [ ] T045 [US3] Implement the lessons part of `readCourseAnalytics` joining `lessonStats` with the `curriculum` collection (one query) and filter by visibility; fill `lessons` in `analytics.course`.
- [ ] T046 [US3] Add the drop-off section components under `$courseId/-components/` and use them in the route.
- [ ] T047 [US3] Run the US3 tests.

**Checkpoint**: drop-off is visible.

---

## Phase 6: User Story 4 - See which quiz questions learners miss (P3)

**Goal**: a most-missed ranking and a best-score distribution per quiz.

**Independent Test**: submit known attempts and compare each question's miss rate and each band with the stored attempts.

### Tests for User Story 4 (write first)

- [ ] T048 [P] [US4] Extend `analytics.test.ts`: a `quizAttempt` contributes `attempts` +1 for each question id in `answers` and `misses` +1 for each not in `correctQuestionIds`; a `quizSummary` contributes one student to the band of `bestScore` (0-9 .. 90-100, 100 in the last), and a rising best moves the student between bands once; extend the invariant test (with its breaking case) and the rebuild test. Check `invariants.ts` for an existing check that `bestScore` never decreases and `attempts` are immutable; if missing, add one with its breaking test, because the contributions rely on it (plan R4).
- [ ] T049 [P] [US4] Extend `analytics-reads.test.ts` and instructor-api's `analytics.test.ts` for `analytics.quiz`: only the quiz's current questions (a deleted question is dropped), `ranked` true at 5 or more attempts, ranked first by `missRate` descending then `attempts` descending, the unranked after in quiz order; ten `scoreBands`; `students` equals their sum; a quiz of another course or an unknown one answers `NOT_FOUND`; `analytics.course` lists the course's shown quizzes.
- [ ] T050 [P] [US4] Extend `$courseId/-route.test.tsx` and add `quiz-panel.test.tsx`: ranked questions with attempts, misses and miss rate, "Not enough attempts", ten score bars with a text alternative, empty state; extend `analytics.e2e.ts`: a student answers wrongly and the question and band show.

### Implementation for User Story 4

- [ ] T051 [US4] Add the `quizAttempt` question and `quizSummary` band contributions to `helpers/analytics.ts`, extend `analytics-matches-records` and `rebuildCourseAnalytics` (T048), and add the `quiz`-prefixed reads to `analytics-reads.ts` joined with the curriculum's current quiz questions.
- [ ] T052 [US4] Add `analytics.quiz` and the `quizzes` list of `analytics.course` in `procedures/analytics.ts`.
- [ ] T053 [US4] Add `quiz-panel.tsx` and the score chart under `$courseId/-components/`, shown per quiz in the route; text-only buttons.
- [ ] T054 [US4] Run the US4 tests.

**Checkpoint**: all four stories work.

---

## Phase 7: Polish and cross-cutting

- [ ] T055 [P] Update the docs site (`docs/`) where it describes the instructor portal or course management with a short "Course analytics" page (definitions of active learner, completion rate, drop-off and score bands; figures lag a few seconds) and, in `CONTRIBUTING.md`, one line on `rebuild-analytics`. Translate changed English docs locally and commit the translations, or note in the PR description that translations are pending.
- [ ] T056 Run `pnpm lint`, `pnpm test` and `pnpm build`; fix every failure in the code, not the tests.
- [ ] T057 **(human)** Run [quickstart.md](./quickstart.md) by hand against `pnpm dev`, saving numbered screenshots of the key steps, including any failure, to `tmp/screenshots/pr-<number>/`; also check SC-006 (find the lowest-share lesson in 30 seconds) with testers.
- [ ] T058 **(human)** After deploying `discava-development`, check the core table stream's `GetRecords` throttling and the `AnalyticsUpdateFailures` queue stay at zero under the e2e load, and that TTL deletes expired markers (plan R1, R6); if throttled, open an issue to move the consumers to EventBridge Pipes.
- [ ] T061 **(human)** Check SC-003 on a deployed or seeded course with at least 1,000 enrolments: the dashboard (20 courses) and the course analytics page each load their figures in under 2 seconds, and the number of table reads per request does not grow with enrolments; note the numbers on the PR.
- [ ] T059 **(human)** Run `rebuild-analytics` for a deployed course and confirm the figures before and after are equal; note the result on the PR.
- [ ] T060 **(human)** Update issue #278: tick off its scope items, and make the PR that merges the last phase say "Closes #278"; earlier PRs say "Refs #278".

---

## Dependencies and order

- Phase 1 → Phase 2 → stories. Within Phase 2: entities T003-T007 are parallel, then T008; T009 → T010; T012 → T013 and T014 → T015 and T016 → T017 follow T008; the handler T018 → T019 needs T013, T015; T020 needs T010, T019 and T011; T021 needs T010; T022 → T023 need T013 and T017; T024 and T025 are independent after T023 and T017.
- **US1** depends only on Phase 2. **US2** needs US1's reads and procedure file, so it follows US1. **US3** and **US4** each need the route from US2 (they extend `analytics.course` and the course page) and are independent of each other, so they can run in parallel after US2.
- Tests in each story come before its implementation. Every story that adds a contribution also extends `analytics-matches-records` and `rebuildCourseAnalytics` in the same story, so the invariant holds at every checkpoint.

## Parallel examples

- Phase 2: T003 to T007 together; T009, T011, T012, T014 and T016 together once T008 is done.
- US1: T026 to T030 together; then T031 and T032 together, then T033, then T034.
- After US2: US3 and US4 in parallel (different contributions and components, same two files `analytics-reads.ts` and `procedures/analytics.ts`: sequence their edits per file).

## Implementation strategy

- **MVP**: Phase 1, Phase 2 and US1. Instructors see true summary cards. Over time, drop-off and quiz analysis follow as separate, reviewable increments.
- Deliver in the order US1 → US2 → US3 → US4; each checkpoint leaves the table passing `analytics-matches-records`.
- The riskiest parts are the exactly-once application (T014, T015, T018) and the third stream mapping (T020, T058): land and verify them before building on them.
