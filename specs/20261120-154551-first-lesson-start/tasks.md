---

description: "Task list for starting in lesson one after enrolling"
---

# Tasks: Start in Lesson One After Enrolling

**Input**: Design documents from `/specs/20261120-154551-first-lesson-start/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they're included: unit tests for every helper and procedure, one new invariant and two extended ones with tests that break them, portal component tests, `packages/e2e` scenarios with `screenshot()`, and one concurrency test. Write each phase's tests first and watch them fail. Never weaken an existing test to make it pass. The intended test changes (the "You're enrolled!" dialog is gone: T003, T006, T007; expected analytics figures gain counters: T022, T024) are named in their tasks and must be repeated in that PR's description.

**Who runs what**: An automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The agent writes the e2e and concurrency tests, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job); a CI failure is the feedback for those. Tasks marked **(human)** need a running local stack, a deployed stage or people, and a reviewer does them before merging.

**Organization**: Six phases, each one agent PR, merged in the order under Dependencies. Each leaves `main` green and working. Phase 1 alone is the MVP and needs no backend change. Only the last implementation PR closes #596; earlier PRs say "Part of #596" and must not use a closing keyword.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Land in the lesson straight after enrolling | P1 |
| US2 | Answer a prompt about the content in the first lesson | P2 |
| US3 | See how many learners got started (activation) | P2 |
| US4 | Write the prompt for my course | P3 |

Paths are relative to the repository root. All buttons are text only: no arrow icons (CLAUDE.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: User Story 1 - Land in the lesson straight after enrolling (P1) 🎯 MVP

**Goal**: Enrolling in a free course, or returning from a confirmed payment, opens the learner's next lesson (the first shown lesson for someone new) with a one-line confirmation. A course with no shown lesson opens the course home. The "You're enrolled!" dialog is gone. Student portal only.

**Independent test**: `pnpm nx run @discava/student-portal:test -- --run enrolment-actions start-course use-course-player enrolled-notice` passes. The e2e tests "enrolling lands in the first shown lesson" and the purchase scenario pass on PR CI, with screenshots.

- [x] T001 [P] [US1] Tests first, then add `isPlaceReady: boolean` to `CoursePlayer` in `packages/websites/student-portal/src/hooks/use-course-player.ts`: true once `course.view`, `course.myItemCompletions` and `course.myLessonProgress` have all loaded (research R-1). Nothing else in the hook changes. Tests (a new `hooks/use-course-player.test.tsx`, with `renderWithCoreApi`): false while completions or progress are pending, true when all three have data, and `nextLesson` for a learner who completed the first two lessons is the third.
- [x] T002 [US1] Tests first, then add the start route per [contracts/student-portal-ui.md](./contracts/student-portal-ui.md) "Start route":
  - `packages/websites/student-portal/src/routes/learn/$courseId/start.tsx`: `createFileRoute('/learn/$courseId/start')` with `beforeLoad: requireSignIn`, rendering `StartCourse`;
  - `routes/learn/$courseId/-components/start-course.tsx`: reads `useCoursePlayer(courseId)`; while `!isPlaceReady` shows "Opening your course…" with `role="status"`; then navigates with `replace: true` and history state `{ enrolled: true }` to `/learn/$courseId/lesson/$lessonId` for `nextLesson`, or to `/learn/$courseId/home` when `nextLesson` is undefined; on a `course.view` error renders the `Unavailable` component that `CoursePlayerLayout` renders for it (export it from `-components/course-player.tsx`; do not copy it);
  - declare the state's type once (`declare module '@tanstack/react-router' { interface HistoryState { enrolled?: boolean } }`) in `packages/websites/student-portal/src/router-context.ts`;
  - regenerate and commit `packages/websites/student-portal/src/routeTree.gen.ts` (the router plugin rewrites it when the portal's tests or build run).

  Tests in `-components/start-course.test.tsx` with `mockRouter`: a new learner goes to the first lesson; a learner with two completed lessons goes to the third; a course with no lessons goes to the course home; nothing navigates before completions and progress have loaded; the navigation uses `replace` and carries `enrolled: true`.
- [x] T003 [US1] Tests first, then change the moment of enrolling in `packages/websites/student-portal/src/routes/learn/$courseId/-components/enrolment-actions.tsx` and `use-checkout-return.ts`, per the first table of [contracts/student-portal-ui.md](./contracts/student-portal-ui.md):
  - `enrol`'s `onSuccess` still writes the enrolment to the `course.myEnrolment` cache, then navigates to `/learn/$courseId/start`;
  - remove the "You're enrolled!" dialog, its state (`enrolledOpen`) and its now-unused imports;
  - `useCheckoutReturn` calls `onEnrolled` once whenever the address says `checkout=success` and the learner is enrolled: after waiting, or already enrolled on the first read (research R-2). Its polling, the 60 s limit, `status` and `result` are unchanged;
  - `onEnrolled` navigates to `/learn/$courseId/start` with `replace: true`.

  This is an intended test change: in `enrolment-actions.test.tsx`, the cases that expect the dialog after `course.enrol` and after a confirmed payment now expect the navigation, and no dialog. Add cases: `?checkout=success` with the enrolment already present navigates once with `replace`; `?checkout=success` with no enrolment never navigates (confirming, then timed out); an enrolled learner without the parameter sees the enrolled card and no navigation; no button in the component renders an arrow icon. Every other existing case stays as it is. List the changed cases in the PR description.
- [x] T004 [P] [US1] Tests first, then add `packages/websites/student-portal/src/routes/learn/$courseId/-components/enrolled-notice.tsx`: when the router's location state has `enrolled: true`, it renders "You're enrolled in <course title>." with `role="status"`; otherwise nothing. Render it at the top of the lesson in `lesson-page.tsx` and at the top of `course-home.tsx`, with the title from `player.course`. Tests (`-components/enrolled-notice.test.tsx`, and one case each in `course-home-and-lesson-page.test.tsx`): shown with the state, absent without it, and focus is not moved.
- [x] T005 [P] [US1] In `specs/20261116-013315-stripe-checkout/contracts/student-portal-ui.md`, change the `?checkout=success`, not yet enrolled row's ending from "the enrolled state and the usual enrolled dialog" to "the learner is taken to their lesson (see `specs/20261120-154551-first-lesson-start/contracts/student-portal-ui.md`)". Change nothing else in that spec.
- [x] T006 [US1] Update `enrol` in `packages/e2e/src/helpers/student-portal.ts` and add `enrolAndLand` (research R-10). This is an intended test change, confined to this helper:
  - `enrolAndLand(page, user?)`: presses **Enrol now** (signing in first as `enrol` does today), then waits for `/learn/<id>/lesson/<id>` or `/learn/<id>/home`, and returns;
  - `enrol(page, user?)`: calls `enrolAndLand`, then opens the course home (`page.goto` of `/learn/<id>/home`, with the course id taken from the landing URL) and waits for it, so its callers still start from the course home. Do not edit the scenarios that call `enrol`.
- [x] T007 [US1] End to end, in `packages/e2e/src/scenarios/learn.e2e.ts` and `course-purchase.e2e.ts`:
  - new test "enrolling lands in the first shown lesson": an instructor (own user, `uniqueName` course) publishes a course with two modules whose first lesson is hidden; a new student uses `enrolAndLand`; expect the URL of the first shown lesson, its heading, the line "You're enrolled in", and no dialog; `screenshot(page, 'landed-in-first-lesson')`. Go back: expect the course page. Open the lesson again from the course home: the line is absent;
  - new test "enrolling in a course with no lessons lands on the course home": expect `/home`, the line and "No lessons yet"; `screenshot(page, 'landed-on-course-home')`;
  - in `course-purchase.e2e.ts`, replace the click on the dialog's **Start learning** (an intended change: the dialog is gone) with an expectation that the lesson page opens by itself after the payment is confirmed, then `screenshot(student, 'landed-after-purchase')`. Keep every other assertion of that scenario.

---

## Phase 2: Foundational - the prompt's records, rules and procedures

**Goal**: The data, the one writer and the API for the first-lesson prompt. No portal calls them yet, so nothing users see changes.

**Independent test**: `pnpm nx run @discava/core-table:test -- --run first-lesson-prompt discussion curriculum invariants` and `pnpm nx run @discava/core-api:test -- --run discussion.test.ts enrolment.test.ts course-view.test.ts router.test.ts` pass, and `pnpm nx run @discava/tooling-agent:invariant-coverage` passes against `origin/main`.

- [ ] T008 [P] Tests first, then add the attributes in [data-model.md](./data-model.md) "Changed entities" to `packages/databases/core-table/src/entities/`, each with a comment saying what it means and who writes it:
  - `course.ts`: `firstLessonPrompt` (string, optional; "plain text, 1 to 200 characters after trimming. Absent means the course uses `DEFAULT_FIRST_LESSON_PROMPT`");
  - `enrolment.ts`: `firstLessonPromptState` (`['answered', 'dismissed'] as const`, optional; "Set once and never changed or removed");
  - `discussion-post.ts`: `promptAnswer` (boolean, optional, read-only; "`true` on a question that answers the first-lesson prompt. Never set on a reply, and never `false`").

  Tests: each entity accepts a record with and without the attribute; `enrolment` refuses any other state value.
- [ ] T009 [P] Tests first, then add the pure parts of `packages/databases/core-table/src/helpers/first-lesson-prompt.ts` (new, exported from `src/index.ts`) and `firstShownLesson` in `helpers/curriculum.ts`, per [data-model.md](./data-model.md) "Rules":
  - `DEFAULT_FIRST_LESSON_PROMPT` = "What do you want to be able to do with what this course teaches? Tell the class in a sentence or two.";
  - `FIRST_LESSON_PROMPT_MAX = 200`;
  - `normaliseFirstLessonPrompt(text)`, reusing `normaliseDiscussionText` with `{ min: 1, max: 200 }`;
  - `resolveFirstLessonPrompt(course)`: the course's text, else the default;
  - `promptAnswerTitle(body)`: the body's first non-empty line, trimmed, cut to `DISCUSSION_TITLE_MAX` (120) characters with a trailing "…" when longer;
  - `firstShownLesson({ modules, lessons })`: the first lesson of the first module in course order after `filterEffectivelyVisible`, or undefined.

  Tests (`first-lesson-prompt.test.ts`, `curriculum.test.ts`): 200 and 201 characters, blank text, a multi-line body, a 300-character first line, a hidden first module, a hidden first lesson, an archived lesson, and a course with no shown lesson.
- [ ] T010 Tests first, then the writes (after T008 and T009), per [data-model.md](./data-model.md) "Rules":
  - in `helpers/first-lesson-prompt.ts`: `firstLessonPromptStateWrites(entities, { courseId, userId, state })`, one `enrolment.patch` setting `firstLessonPromptState` where the enrolment exists, `status` is not `dropped` and the attribute does not exist; and `dismissFirstLessonPrompt(coreTable, { courseId, userId })`, which runs it with `dismissed`, and on a failed condition reads the enrolment again: a state already set returns the enrolment, a missing or `dropped` enrolment throws the helper's "not enrolled" error;
  - in `helpers/discussion-text.ts`: `answeredState` takes `promptAnswer?: boolean` and returns the new value `not-a-question` for a `shown` post with it (`not-open` still wins for hidden and deleted);
  - in `helpers/discussion.ts`: every caller of `answeredState` and `unansweredChange` passes the question's `promptAnswer`; a new operation `answerPrompt` (`{ type, courseId, moduleId, lessonId, postId, author, body, now }`) returns the three `checks`, the question's `create` with `promptAnswer: true`, `title: promptAnswerTitle(body)`, the body validated as a question's details are, and no `unanswered` or `unansweredSince`, plus `firstLessonPromptStateWrites(..., 'answered')`. `toPostRead` and `toQuestionRead` carry `promptAnswer`.

  Tests in `first-lesson-prompt.test.ts` and `discussion.test.ts`, against the in-memory fake the discussion tests use: an answer creates one post and sets the state; a second answer with a new id is cancelled; an answer after a dismissal is cancelled; a `dropped` enrolment is cancelled; hiding, unhiding, accepting a reply on and deleting a reply under a prompt answer never set `unanswered`; 20 concurrent answers by one learner leave exactly one post; a dismissal after an answer leaves `answered`; no operation here touches `lastActivityAt` or `studentActivityCount`.
- [ ] T011 Impact-check invariants, tests first (constitution IV; [data-model.md](./data-model.md) "Invariants"), in `packages/databases/core-table/src/helpers/invariants/discussion.ts` and `discussion.test.ts`:
  - new `first-lesson-prompt-matches-answers`: every post with `promptAnswer` is a question whose author has an enrolment (`snapshot.enrolments`) in that course with `firstLessonPromptState = answered`; an author has at most one such post per course; every enrolment with `answered` has exactly one such post by that learner in that course, in any state;
  - `discussion-post-shape` extended: `promptAnswer`, when present, is `true` and on a question;
  - `discussion-unanswered-matches`: pass `promptAnswer` to `answeredState`.

  Breaking tests, each starting from `consistentTable()`: a prompt answer whose author's enrolment has no state; one whose state is `dismissed`; two prompt answers by one learner; an `answered` enrolment with no post; `promptAnswer` on a reply; a prompt answer carrying `unanswered`. Add a test that a consistent table with an answered and a dismissed enrolment trips none of `last-activity-at-current`, `student-records-enrolled`, `enrolment-in-published-course`, `discussion-counts-match` or the checks in `payments.ts`. Add the fixture rows to `test-fixture.ts` only if `consistentTable()` needs them.
- [ ] T012 Tests first, then the core-api outputs in [contracts/core-api.md](./contracts/core-api.md) "Changed outputs":
  - `packages/apis/core-api/src/schema/course.ts`: `ViewCourseOutputSchema` gains `firstLessonPrompt: z.string()`, and `course.view` (`procedures/course.ts`) returns `resolveFirstLessonPrompt(course)`. `PublicViewCourseOutputSchema` is unchanged;
  - `schema/enrolment.ts`: `EnrolmentSchema` gains `firstLessonPromptState: z.enum(['answered', 'dismissed']).optional()`, returned by `course.enrol` and `course.myEnrolment` (outputs are built by picking fields; add this one);
  - `schema/discussion.ts`: `DiscussionPostSchema` gains `promptAnswer: z.boolean().optional()`, set by the mapper in `procedures/discussion.ts` only where the caller may see the post's content.

  Tests: `course-view.test.ts` returns the default and a custom text; `enrolment.test.ts` returns the state and still no `orderId`; `discussion.test.ts` lists a prompt answer with `promptAnswer: true` and a hidden one without it for a student.
- [ ] T013 Tests first, then add `answerPrompt` to `packages/apis/core-api/src/procedures/discussion.ts` and `AnswerPromptInputSchema` (`LessonRefSchema` plus `postId` and `body`, bounded as `AskInputSchema`'s) to `schema/discussion.ts`, per [contracts/core-api.md](./contracts/core-api.md) "`discussion.answerPrompt`" and research R-9:
  - `requireDiscussionAccess` as `ask` uses it, returning the caller's enrolment as well; refuse a caller with no enrolment (an instructor who is not enrolled included) as a non-enrolled student is refused;
  - `assertOpen` as `ask`;
  - one `curriculum` collection query for the course, and `PRECONDITION_FAILED` "This prompt belongs to the course's first lesson" unless the lesson is `firstShownLesson(...)`;
  - under `writeWithRetry`: an existing post with this `postId` by the caller is returned unchanged; an enrolment whose state is set gives `PRECONDITION_FAILED` "You've already answered or dismissed this prompt"; otherwise the `answerPrompt` operation.

  Tests cover every row of the contract's table, with a signed-out caller, an unenrolled student, an enrolled student, an instructor of the course who is not enrolled, an instructor who is also enrolled, and another course's instructor. Also assert that a successful answer writes no notification record (FR-025) and leaves the enrolment's `lastActivityAt` as it was (FR-017).
- [ ] T014 Tests first, then add `dismissFirstLessonPrompt` to `packages/apis/core-api/src/procedures/enrolment.ts` (input `{ courseId }`, output `EnrolmentSchema`, calling core-table's `dismissFirstLessonPrompt` for the caller), per [contracts/core-api.md](./contracts/core-api.md). Mount `discussion.answerPrompt` and `course.dismissFirstLessonPrompt` in `packages/apis/core-api/src/router.ts`; neither joins `PUBLIC_OPERATIONS`, and `router.test.ts` must pass (add the names where it lists procedures by hand, weakening nothing). Tests: every row of the contract's table, including a second call and a call after an answer.
- [ ] T015 Run `pnpm nx run @discava/tooling-agent:entity-writers` and commit `packages/databases/core-table/entity-writers.json` if it changed, then `pnpm nx run @discava/tooling-agent:invariant-coverage`. The new writes of `enrolment` live in core-table helpers, and T011 names `snapshot.enrolments` under `helpers/invariants/`, so the `Invariant coverage` check should pass without a label. Say in the PR description which entities gained writers.

---

## Phase 3: User Story 2 - Answer a prompt about the content in the first lesson (P2)

**Goal**: An enrolled learner sees the prompt in the first shown lesson's Questions section, answers it or presses **Not now**, and never sees it again on any device. Answers are labelled in lists and stay out of the Unanswered queue.

**Independent test**: `pnpm nx run @discava/student-portal:test -- --run first-lesson-prompt questions-section` and `pnpm nx run @discava/common-shadcn:test -- --run post-card` pass. The e2e test "a new learner answers the first-lesson prompt once" and the concurrency test pass on PR CI, with screenshots.

- [ ] T016 [P] [US2] Tests first, then show the label "Answer to the course prompt" in `packages/common/shadcn/src/discussion/post-card.tsx` for a post with `promptAnswer`, as a `Badge` beside the title. Add or extend the component's test: the label is present with the flag and absent without it.
- [ ] T017 [US2] Tests first, then add `packages/websites/student-portal/src/routes/learn/$courseId/-components/discussion/first-lesson-prompt.tsx` per [contracts/student-portal-ui.md](./contracts/student-portal-ui.md) "The prompt". Props: `lesson` (`LessonRef`) and `prompt` (the text).
  - a `fieldset` whose `legend` is the prompt text; a `Textarea` labelled "Your answer" with `maxLength={DISCUSSION_BODY_MAX}` and the count; the note "Everyone in this course can read your answer."; **Post** and **Not now** (`variant="outline"`), text only;
  - **Post** calls `discussion.answerPrompt` with `usePostId`'s id; on success set `firstLessonPromptState: 'answered'` on the `course.myEnrolment` cache entry and invalidate `discussion.listQuestions`;
  - **Not now** calls `course.dismissFirstLessonPrompt` and writes its result to the `course.myEnrolment` cache;
  - `PRECONDITION_FAILED` from either invalidates `course.myEnrolment` and shows no error; any other failure shows an `ErrorAlert` with `apiErrorMessage` and keeps the text;
  - no `autoFocus`.

  Tests in `discussion/-first-lesson-prompt.test.tsx` with `renderWithCoreApi`: both buttons' calls and inputs; **Post** disabled while blank or pending; the cache updates; the two failure kinds; the note is present; the textarea is not focused on render; no arrow icons.
- [ ] T018 [US2] Tests first, then wire the prompt (after T017):
  - `lesson-page.tsx` passes `QuestionsSection` two new props: `firstLessonPrompt`, the text from `player.course.firstLessonPrompt` when this lesson is `player.lessons[0]`, the course is not read-only, and `player.enrolment` is `active` or `completed` with no `firstLessonPromptState`; otherwise undefined;
  - `discussion/questions-section.tsx` renders `FirstLessonPrompt` under the heading, above the list, only when that prop is set, the list has loaded without error and no thread is open.

  Tests (extend `discussion/-questions-section.test.tsx` and `course-home-and-lesson-page.test.tsx`, weakening nothing): shown on the first lesson for a new learner; absent on the second lesson, with either state, in an archived course, with no enrolment (an instructor), while the list is loading or failed, and with a thread open; after **Post** the prompt is gone and the list is refetched.
- [ ] T019 [US2] End to end, in `packages/e2e/src/helpers/discussion.ts` and `packages/e2e/src/scenarios/discussion-student.e2e.ts`:
  - helper `answerFirstLessonPrompt(page, text)`: fills "Your answer" and presses **Post**;
  - test "a new learner answers the first-lesson prompt once": a fresh instructor's course with two shown lessons (`createDiscussionCourse` or its like); a fresh student uses `enrolAndLand`; expect the prompt's default text; `screenshot(page, 'first-lesson-prompt')`; answer; expect the answer listed with "Answer to the course prompt" and the prompt gone; `screenshot(page, 'first-lesson-prompt-answered')`; open the second lesson: no prompt; sign the same student in with a second browser context and open the first lesson: no prompt; `screenshot(second, 'first-lesson-prompt-stays-closed')`;
  - in the same test, a second fresh student presses **Not now**, reloads, and sees no prompt and only the first student's answer;
  - in `packages/e2e/src/scenarios/discussion-instructor.e2e.ts`, add a test that the instructor's Unanswered view does not list the prompt answer while By lesson does, with `screenshot(page, 'prompt-answer-by-lesson')`.
- [ ] T020 [US2] Add `packages/e2e/src/concurrency/first-lesson-prompt.e2e.ts`, following `discussion-counters.e2e.ts`: one enrolled student sends five `discussion.answerPrompt` requests with different post ids and one `course.dismissFirstLessonPrompt` at the same moment. Expect at most one answer to succeed, the enrolment to end with exactly one state, the lesson's list to hold one prompt answer when the state is `answered` and none when it is `dismissed`, and the table's invariants to hold.

---

## Phase 4: User Story 3 - See how many learners got started (P2)

**Goal**: The course analytics page shows activation (all time and for the selected range) and the prompt's answers and dismissals, beside the drop-off funnel, from counters kept by the existing analytics handler.

**Independent test**: `pnpm nx run @discava/core-table:test -- --run analytics`, `pnpm nx run @discava/instructor-api:test -- --run analytics.test.ts` and `pnpm nx run @discava/instructor-portal:test -- --run activation-card` pass. The e2e test "activation counts a learner once" passes on PR CI, with a screenshot.

- [ ] T021 [P] [US3] Add the counters in [data-model.md](./data-model.md) to `packages/databases/core-table/src/entities/course-stats.ts` (`activated`, `promptAnswered`, `promptDismissed`: number, default 0) and `period-stats.ts` (`activated`: number, default 0), with a comment on each saying what it counts. Extend the entities' tests if they list attributes.
- [ ] T022 [US3] Tests first, then extend `contributions('enrolment', image)` in `packages/databases/core-table/src/helpers/analytics-contributions.ts` exactly as [data-model.md](./data-model.md) "Contributions" says: `activated` on `SUMMARY` and on the enrolment's `createdAt` day when `lastActivityAt` is a non-empty string; `promptAnswered` or `promptDismissed` on `SUMMARY` by `firstLessonPromptState`. Update the file's header comment. Nothing else in the handler, the rebuild or the markers changes (research R-7).

  This is an intended test change: existing expectations in `analytics-contributions.test.ts` (and `analytics-writes.test.ts`, `analytics-funnel.test.ts` if they pin enrolment deltas) gain the new deltas only where their fixture enrolment has `lastActivityAt`; loosen nothing. New cases for `contributionsOfChange('enrolment', before, after)`: first activity gives `activated +1` on both items; a later activity gives no counts; an active enrolment that becomes `dropped` keeps `activated`; removing an activated enrolment gives `-1` on both; a state going from absent to `answered` gives `promptAnswered +1`, to `dismissed` gives `promptDismissed +1`; applying the same change twice through `applyAnalyticsChange`'s fake leaves the counters as after once. In `helpers/invariants/analytics.test.ts`, add breaking cases for `analytics-matches-records`: a stored `activated` one too high, one too low on the day item, and a `promptAnswered` that does not match.
- [ ] T023 [US3] Tests first, then carry the figures through `packages/databases/core-table/src/helpers/analytics-reads.ts`: `CourseSummary` gains `activated`, `promptAnswered` and `promptDismissed` (clamped at 0 with `counter`, and `activated` no higher than `enrolments`), and `CourseDay` gains `activated` (no higher than that day's `enrolments`). Extend `analytics-reads.test.ts`: present, missing (zeros) and negative stored values.
- [ ] T024 [US3] Tests first, then extend instructor-api per [contracts/instructor-api.md](./contracts/instructor-api.md) "Changed outputs": in `packages/apis/instructor-api/src/schema/analytics.ts`, `CourseTotalsSchema` gains `activated`, `activationRate` (`z.number().int().min(0).max(100).nullable()`), `promptAnswered` and `promptDismissed`, and `CourseDaySchema` gains `activated`; in `procedures/analytics.ts`, `course` fills them, with `activationRate` = `floor(activated * 100 / enrolments)` or null when `enrolments` is 0. `courseSummaries` is unchanged. Intended test change in `analytics.test.ts`: expected totals and daily items gain the new fields. New cases: 1 of 3 gives 33; no enrolments gives null; a caller who does not teach the course still gets `NOT_FOUND`.
- [ ] T025 [US3] Tests first, then add `packages/websites/instructor-portal/src/routes/_authenticated/dashboard_/$courseId/-components/activation-card.tsx` per [contracts/instructor-portal-ui.md](./contracts/instructor-portal-ui.md) "Activation", and render it in `dashboard_/$courseId/route.tsx` beside `LessonDropOff`, passing `totals`, `daily` and the selected range. The range line sums `activated` and `enrolments` over `daily`. Tests in `-components/activation-card.test.tsx`: "1 of 3 enrolled learners have started (33%)"; "No data" with no enrolments, all time and in range; the range line for a 30-day series; the prompt counts; the note. Add the new fields to the handlers in `-route.test.tsx` only where a test now fails for lack of them, changing no assertion.
- [ ] T026 [US3] End to end, in `packages/e2e/src/scenarios/analytics.e2e.ts`: new test "activation counts a learner once": a fresh instructor's course with two students enrolled; one completes an item; using the scenario's existing wait for analytics (`helpers/wait-for-analytics.ts`), expect the Activation card to say "1 of 2"; the same student completes a second item, and after the wait it still says "1 of 2"; `screenshot(page, 'activation-card')`.

---

## Phase 5: User Story 4 - Write the prompt for my course (P3)

**Goal**: An instructor sets, changes and clears the prompt's text in the course's settings, and new learners see it.

**Independent test**: `pnpm nx run @discava/instructor-api:test -- --run course.test.ts` and `pnpm nx run @discava/instructor-portal:test -- --run course-first-lesson-prompt-form` pass. The e2e test "an instructor's prompt reaches a new learner" passes on PR CI, with screenshots.

- [ ] T027 [US4] Tests first, then add `setCourseFirstLessonPrompt` to `packages/apis/instructor-api/src/procedures/course.ts`, built on `courseInstructorProcedure` like `setCourseCertificates`, with `SetCourseFirstLessonPromptInputSchema` (`{ courseId, prompt: z.string().max(800).nullable() }`) in `schema/course.ts`, per [contracts/instructor-api.md](./contracts/instructor-api.md): `normaliseFirstLessonPrompt`; too long gives `BAD_REQUEST` "The prompt must be at most 200 characters"; null or blank removes `firstLessonPrompt`; otherwise set the trimmed text; then `refreshInstructorCourseUpdatedAt`. `course.view`'s output gains `firstLessonPrompt` (optional) and `defaultFirstLessonPrompt`. Mount it as `course.setFirstLessonPrompt` in `router.ts` (and its router test). Tests in `course.test.ts`: every row of the contract's table, in draft, published and archived courses, and the view output with and without a custom text.
- [ ] T028 [US4] Tests first, then add `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/course/course-first-lesson-prompt-form.tsx` per [contracts/instructor-portal-ui.md](./contracts/instructor-portal-ui.md) "The prompt form", and render it in `my-courses_/$courseId/route.tsx` beside `CourseCertificatesSwitch` and `CoursePriceForm`, following how `course-price-form.tsx` saves and reports errors. Tests in `course-first-lesson-prompt-form.test.tsx` with `renderWithInstructorApi`: the default state line and placeholder; a custom text shown; **Save prompt** sends the trimmed text and is disabled while unchanged; a blank field sends null; a failing call shows the message and restores the text; **Use default** only with a custom text, sending null; no arrow icons.
- [ ] T029 [US4] End to end, in `packages/e2e/src/scenarios/discussion-instructor.e2e.ts` (helpers in `packages/e2e/src/helpers/instructor-portal.ts`): new test "an instructor's prompt reaches a new learner": the instructor saves a uniquely worded prompt on their course; `screenshot(page, 'first-lesson-prompt-form')`; a fresh student uses `enrolAndLand` and sees that text in the first lesson; `screenshot(student, 'first-lesson-prompt-custom')`; the instructor presses **Use default** and another fresh student sees the default text.

---

## Phase 6: Polish - docs and manual checks

**Goal**: The docs describe the landing, the prompt and activation. Existing courses' figures are rebuilt, and a reviewer checks the flows by hand.

- [ ] T030 [P] Docs, English only, under `docs/src/content/docs/en/`:
  - `design/course-analytics.mdx`: add **Activated**, **Activation rate** and **Prompt answers and dismissals** to the Definitions table, with the rules in research R-7 and R-8 (every enrolment counts, ended ones included; "so far"; counted from the enrolment's last-activity time, so no new marker), and add this spec to the page's "Spec" links in the existing style;
  - `guides/lesson-discussions.mdx`: a short section on the first-lesson prompt for learners (one answer, **Not now**, who can read it) and for instructors (where to set the text, that answers appear under By lesson and not Unanswered);
  - `guides/getting-started.mdx` or the student-facing guide that describes enrolling, if one does: enrolling now opens the first lesson.

  Note in the PR that translations of the other locales are pending.
- [ ] T031 **(human)** After Phase 4 is merged, rebuild the figures of existing courses so `activated` counts enrolments from before the change: locally for the courses you use (`pnpm nx run @discava/tooling-deploy:rebuild-analytics -- <courseId> ...`), and on `discava-development` after deploying (CONTRIBUTING.md, "Course analytics"). Confirm the table invariants report nothing for those courses afterwards.
- [ ] T032 **(human)** Run [quickstart.md](./quickstart.md) "By hand" steps 1 to 17 against `pnpm dev`, saving screenshots to `tmp/screenshots/pr-<number>/`. In particular: a video in the first lesson is loaded and not playing (FR-004), Back after a purchase does not re-enter the lesson (FR-007), and with a screen reader the confirmation line is announced and focus is not moved to the prompt (FR-005, FR-010).
- [ ] T033 **(human)** After deploying to `discava-development`, repeat quickstart steps 1, 5, 8, 9 and 15 there: Cognito sign-in and the real payment return are only exercised on a deployed stage.

---

## Dependencies

- Phase 1 stands alone and can ship first.
- Phase 2 → Phase 3 (the portal calls the Phase 2 procedures; its e2e uses Phase 1's `enrolAndLand`).
- Phase 2 → Phase 4 (the prompt counters read `firstLessonPromptState`). Phase 4 does not need Phase 3.
- Phase 2 → Phase 5 (`course.firstLessonPrompt` and `resolveFirstLessonPrompt`); its e2e needs Phase 3's prompt in the lesson.
- Phase 6's T030 can start after Phase 4. T031 follows Phase 4; T032 and T033 follow Phase 5.
- Within Phase 1: T001, T004 and T005 in parallel; T002 after T001; T003 after T002; T006 then T007.
- Within Phase 2: T008 and T009 in parallel, then T010, then T011; T012 after T008 and T009; T013 and T014 after T010 and T012; T015 last.
- Within Phase 4: T021, then T022, then T023, then T024, then T025; T026 alongside T025.
- The checkout spec's open student portal phases (9, 10, 12, 13) also edit `enrolment-actions.tsx`. They don't depend on Phase 1 and Phase 1 doesn't depend on them; whichever merges second rebases (plan, research R-2).

## Parallel examples

```text
Phase 1:  T001 (isPlaceReady)  ║  T004 (enrolled notice)  ║  T005 (checkout contract row)
Phase 2:  T008 (attributes)  ║  T009 (pure helpers)
Phase 3:  T016 (post card label)  ║  T017 (prompt component)
```

## Implementation strategy

- **MVP**: Phase 1, one PR. Enrolling opens the lesson, with no backend change.
- **Then**: Phase 2 (records and procedures, invisible), Phase 3 (the prompt), Phase 4 (activation), Phase 5 (the instructor's text). Each is a small PR that leaves `main` working. Phases 3 and 4 can be built in either order once Phase 2 is merged.
- **Finally**: Phase 6's docs, the rebuild of existing figures, and the reviewer's manual checks before the last PR merges.
