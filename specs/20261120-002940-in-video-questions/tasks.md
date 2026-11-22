---

description: "Task list for questions inside and straight after videos"
---

# Tasks: Questions Inside and Straight After Videos

**Input**: Design documents from `/specs/20261120-002940-in-video-questions/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: unit tests for every helper and procedure (authoring authorisation, answer recording and the edit-after-answers cases the issue names), invariant checks (two new, six extended) each with a test that breaks it, component tests for the shared player and both portals, a `packages/e2e` scenario and a concurrency test. Write each phase's tests first and see them fail. Never weaken an existing test to make it pass. Three tasks add an expectation to existing tests because an output gains a field (T020, T039, T043): each names the change, and its PR description must repeat it. Every existing test of the player must pass unchanged (spec SC-002).

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The agent writes the e2e scenarios and the concurrency test, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job); a CI failure is the feedback for those. Tasks marked **(human)** need a running local stack or people, and a reviewer does them before merge.

**Organization**: Nine phases in the order the code needs them, each one agent PR, merged in order. Phases 1 and 2 form the first PR (the first story's phase ends the first implementation issue). Each PR leaves `main` green and working. Paths are relative to the repository root. Only the last PR closes #591; earlier PRs say "Part of #591" and must not use a closing keyword.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Put questions on a video's timeline | P1 |
| US2 | Be asked a question while watching | P1 |
| US3 | See where the questions are, and go back to one | P2 |
| US4 | A short check when the video ends | P2 |
| US5 | See which video questions learners miss | P2 |
| US6 | Change a video's questions after learners have answered | P2 |
| US7 | Nudges towards asking questions | P3 |

US6 has no phase of its own: its rules are part of the save (Phase 1), the editor (Phase 2) and the answer (Phase 4), so its tasks sit there. US1's preview needs the player work of Phases 4 and 5, so that one task is in Phase 5.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - a video holds questions (instructor-api)

**Goal**: A video content item can store up to 20 questions with their key, saved as one versioned document by the course's instructors. No portal calls it yet, and nothing a user sees changes.

**Independent test**: `pnpm nx run @discava/instructor-api:test -- --run content-item-video-questions content-item.test`, `pnpm nx run @discava/core-api:test -- --run course-view course-public-view` and `pnpm nx run @discava/core-table:test -- --run curriculum` pass.

- [x] T001 [P] Tests first, then add the schemas in [contracts/instructor-api-video-questions.md](./contracts/instructor-api-video-questions.md):
  - in `packages/apis/instructor-api/src/schema/quiz.ts`: `MAX_VIDEO_QUESTIONS = 20`, `VideoQuestionInputSchema` (`QuizQuestionSchema` plus `atSeconds: z.number().int().min(0).max(86_400).nullable()`), `VideoQuestionSchema` (that plus `contentHash: z.string()`), with their `I…` types;
  - in `packages/apis/instructor-api/src/schema/content-item.ts`: optional `questions`, `answerKey` and `quizVersion` on `VideoContentItemSchema`, and `UpdateVideoQuestionsInputSchema` (the item ref, `quizVersion: z.number().int().min(0)`, `questions` of at most 20, `answerKey`, refined with `refineQuizDefinition`) and `UpdateVideoQuestionsOutputSchema`, exported through `schema/index.ts`.

  `refineQuizDefinition` takes the questions and key, so it applies as it is; widen its parameter type only as far as accepting the video question shape. Cases in `packages/apis/instructor-api/src/schema/content-item.test.ts`: 21 questions refused, an empty list with an empty key accepted, `atSeconds` of -1, 1.5 and 86,401 refused and `null` accepted, and one case for each `refineQuizDefinition` rule (no key entry, a key entry for an unknown question, two correct options on a single choice question, a correct id that isn't an option).
- [x] T002 Tests first, then add `updateContentItemVideoQuestions` in `packages/apis/instructor-api/src/procedures/content-item-video-questions.ts` and register it as `contentItem.updateVideoQuestions` in `packages/apis/instructor-api/src/router.ts`, following `updateContentItemQuiz` in `procedures/content-item-quiz.ts`:
  - `courseInstructorProcedure`, the item must exist (`NOT_FOUND`) and be a video (`BAD_REQUEST`), `requireNotArchived` and `requireAncestorsNotArchived`;
  - `CONFLICT` "The questions were modified by another request; reload them and retry" when the stored `quizVersion` (0 when absent) isn't the one sent;
  - each question stored with `contentHash = hashQuizQuestions([{ questionId, kind, prompt, options }])` from `helpers/quiz-hash.ts`, and the list sorted: timed questions by `atSeconds`, keeping the sent order for equal moments, then end questions in the sent order;
  - one `writeUnderActiveAncestors` transaction patching `questions`, `answerKey` and `quizVersion: sent + 1`, conditioned on `notExists(archivedAt)` and the sent version (`notExists(quizVersion)` when 0), with the same stale-version handler as the quiz;
  - nothing else on the item changes, and no transcode is submitted.

  `procedures/content-item-video-questions.test.ts` (fixtures as in `content-item-video.fixtures.ts`) covers every row of the contract's behavior table, plus: an instructor of another course and a non-instructor are refused; two saves from one version give one success and one `CONFLICT`; `contentHash` stays the same when only `atSeconds`, the key or the explanation changes and differs when the prompt or an option changes; the stored order; an empty save; `course.view` returns the saved questions with their key. Then check `pnpm nx run @discava/infra:synth` still succeeds: the API's routes are derived from the router, so the new operation adds a method to the instructor API's stack (research R-14).
- [x] T003 [P] Add cases to `packages/apis/core-api/src/procedures/course-view.test.ts` and `course-public-view.test.ts`: a video item stored with `questions`, `answerKey` and `quizVersion` comes back without any of the three (spec FR-013, SC-009). No source change is expected, because `ContentItemSchema`'s video shape already strips them; if a case fails, fix the output schema, not the test.
- [x] T004 [P] Tests first, then add the `video-questions-shape` invariant to `packages/databases/core-table/src/helpers/invariants/curriculum.ts` ([data-model.md](./data-model.md), Invariants): a video's `questions` number at most 20 with unique ids, its `answerKey` has exactly their ids, `quizVersion` is present when either is, and an item that is neither a quiz nor a video has none of the three. Add `questions`, `answerKey` and `quizVersion` to the `contentItems` pick in `helpers/invariants/snapshot.ts` if they aren't there. In `helpers/invariants/curriculum.test.ts`, starting from `consistentTable()`, break each clause and expect the violation.
- [x] T005 Run `pnpm nx run @discava/tooling-agent:entity-writers` and commit `packages/databases/core-table/entity-writers.json` if it changed (a new file now writes `contentItem`).

---

## Phase 2: User Story 1 - Put questions on a video's timeline (P1) 🎯 MVP

**Goal**: An instructor opens **Questions** on a video's row, adds questions at moments of the video and at the end, edits, moves, reorders and removes them, and saves.

**Independent test**: The instructor portal's component tests for the editor pass. On PR CI, the e2e test "an instructor adds questions to a video" passes with screenshots.

- [x] T006 [P] [US1] Tests first, then add the optional `onTimeChange?: (seconds: number) => void` prop to `HlsVideo` in `packages/common/shadcn/src/components/hls-video.tsx`, called with the video's current time on each `timeupdate` and after a seek. Without the prop nothing changes. Cases in `hls-video.test.tsx`; every existing case passes unchanged.
- [x] T007 [P] [US1] Tests first, then add `video-questions-form.ts` in `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/content-items/video-questions/`, mirroring `../quiz/quiz-form.ts` and reusing its `QuestionState`, `newQuestion` and per-question validation:
  - state: the quiz question state plus `atSeconds: number | null`;
  - `fromVideoItem(item)` and `toVideoQuestionsInput(state, quizVersion)`;
  - `parseTime('1:30') → 90` and `formatTime(90) → '1:30'` (`m:ss`, and `h:mm:ss` from an hour), refusing anything else;
  - `sortQuestions` (by time, stable, end questions last) and `moveWithinMoment(questions, questionId, direction)`, which only swaps neighbours with the same `atSeconds`;
  - `validateVideoQuestions`: the quiz's per-question errors, an invalid time, and more than 20 questions;
  - `isAfterEnd(question, durationSeconds)`.

  `video-questions-form.test.ts` covers each.
- [x] T008 [US1] Tests first, then build the editor dialog in the same folder, as [contracts/instructor-portal-ui.md](./contracts/instructor-portal-ui.md) describes: `video-questions-dialog.tsx`, `video-questions-editor.tsx` and `use-video-questions-editor.ts`.
  - The player (`HlsVideo` with the URL from `contentItem.createVideoUrl`, and `onTimeChange` from T006), the current time, **Add a question here** (the current time rounded down) and **Add an end question**.
  - One card per question in asking order, reusing `../quiz/question-card.tsx`, with an **Ask at** time field and an **At the end** switch, **Move up** and **Move down** for questions sharing a moment, and remove.
  - The note "After the end of the video: asked with the end check" on a question at or past the duration.
  - The add buttons disabled at 20 questions, with the reason.
  - Text-only buttons, no arrow icons.

  Component tests with `renderWithInstructorApi`: adding at the current time, editing the time re-sorts the list, marking as an end question, reordering within a moment only, removing, the 20 limit, and each validation error marking its card.
- [x] T009 [US1] [US6] Tests first, then wire saving in `use-video-questions-editor.ts` and the dialog:
  - **Save** calls `contentItem.updateVideoQuestions` with the loaded `quizVersion` (0 when the video has none) and keeps the returned version for the next save, then refreshes the course (as the quiz builder does with `useRefreshCourse`);
  - `CONFLICT` offers to reload the latest questions; other errors show in an `ErrorAlert`;
  - closing with unsaved changes asks first;
  - read-only, with the reason, while the video or anything above it is archived;
  - when the video's `studentActivityCount` is above 0, the notice "N learners have used this video. Answers already recorded are kept and aren't regraded." (spec FR-034).

  Component tests for each, asserting the mutation's input with `calls`.
- [x] T010 [US1] Tests first, then add the **Questions** button to a video's row in `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/content-items/lesson-content-items-row.tsx`, beside **Captions**: labelled "Questions" or "Questions (3)" (spec FR-008), with `aria-label` "Questions for <title>", opening the dialog from T008, and disabled with a reason while the video has no playable version. Cases in `lesson-content-items-row.test.tsx`.
- [x] T011 [US1] Add `packages/e2e/src/helpers/video-questions.ts` (open the editor from a video's row, add a question at the current time, fill a question card, save) and the test "an instructor adds questions to a video" in a new `packages/e2e/src/scenarios/video-questions.e2e.ts`: an instructor made for the test uploads the three-second video (`addVideoToLastLesson` in `helpers/instructor-portal.ts`), opens **Questions**, adds a question at 0:01 and an end question, saves, reloads, and sees both in the editor and "Questions (2)" on the row. Take `screenshot(page, 'video questions editor')` and `screenshot(page, 'video row with question count')`.

---

## Phase 3: Foundational - the answer sheet and its rules (core-table)

**Goal**: The record a learner's answers go in, the one helper that writes it, the first-record rule it shares with **Mark as done**, its invariants, and its place in the analytics figures. No procedure records an answer yet.

**Independent test**: `pnpm nx run @discava/core-table:test`, `pnpm nx run @discava/core-api:test -- --run completion` and `pnpm nx run @discava/events:test -- --run analytics` pass, and `pnpm nx run @discava/tooling-agent:invariant-coverage` reports nothing.

- [x] T012 [P] Add the `videoAnswerSheet` entity in `packages/databases/core-table/src/entities/video-answer-sheet.ts` exactly as in [data-model.md](./data-model.md): pk `userId`, sk `courseId`, `contentItemId`; required `moduleId`, `lessonId`, `answers` (a map, `type: 'any'`) and `answerCount` (number); `createdAt` and `updatedAt` as other entities. Export it from `entities/index.ts`, register it in `service.ts`, and add `videoAnswerSheets` to `TableSnapshot`, `SNAPSHOT_ENTITIES` and `emptyTableSnapshot` in `helpers/invariants/snapshot.ts`. `helpers/invariants-coverage.test.ts` must pass without listing the entity in `NO_INVARIANTS` once T015 lands.
- [x] T013 Tests first, then add `packages/databases/core-table/src/helpers/video-question.ts`, exported from the package index:
  - the stored shapes as types (`StoredVideoQuestion`, `VideoAnswerEntry`) and `videoQuestionsOf(item)`, which returns a video item's questions, key and version (an empty list, an empty key and 0 when it has none);
  - `videoFirstRecordCheck(entities, { userId, courseId, lessonId, contentItemId }, other: 'completion' | 'sheet')`, a condition check that the named record doesn't exist;
  - `videoAnswerWrites(entities, input)`, returning the transaction items of [data-model.md](./data-model.md)'s "The answer transaction": `studentActivityWrites` with `firstRecord: !sheet && !completion` and the video's `quizVersion`; the sheet's `create` (no sheet) or `patch` conditioned on the `answerCount` read, setting `answers` to the read map plus the new entry and `answerCount` plus 1; and `videoFirstRecordCheck(…, 'completion')` when it claims the first record.

  `helpers/video-question.test.ts` asserts the items for each case: first answer with no completion (increment and completion check), first answer with a completion (no increment, no check), a later answer (patch conditioned on `answerCount`, no increment), and that an existing entry is never among the changes.
- [x] T014 Tests first, then change `completeContentItem` in `packages/apis/core-api/src/procedures/completion.ts` for a video: read the learner's `videoAnswerSheet` beside its other reads, pass `firstRecord: !sheet` to `studentActivityWrites`, and add `videoFirstRecordCheck(…, 'sheet')` to the transaction when there is no sheet (research R-5). Other item types are untouched. Cases in `procedures/completion.test.ts`: a video with a sheet is completed without counting the learner again; without one, the transaction carries the check; a canceled transaction is retried and then finds the sheet.
- [x] T015 Tests first, then the invariants in `packages/databases/core-table/src/helpers/invariants/student-activity.ts` ([data-model.md](./data-model.md), Invariants), each with a test in `student-activity.test.ts` that starts from `consistentTable()` and breaks it:
  - extend `activity-count-matches-students` to count `snapshot.videoAnswerSheets`;
  - extend `student-records-have-targets`, `student-records-enrolled`, `student-records-placed-with-item` and `last-activity-at-current` (each entry's `answeredAt`) to the sheets;
  - add `video-answer-sheet-shape`: the item is a video, `answerCount` equals the number of entries, and every entry has at least one option, a boolean `correct`, a valid `answeredAt` and a `quizVersion` from 1 to the item's.

  Add a consistent sheet to `test-fixture.ts`'s `consistentTable()` so the existing tests exercise the new records. No existing assertion is loosened.
- [x] T016 [P] Tests first, then add the `videoAnswerSheet` case to `contributions` in `packages/databases/core-table/src/helpers/analytics-contributions.ts` (research R-7): for each entry of `answers`, one `attempts` on `quizQuestionStats` at `questionStatsSk(contentItemId, questionId)`, one `misses` when `correct` is false, and members for the day and week of its `answeredAt`. Add `'videoAnswerSheet'` to the `INSERT` and `MODIFY` lists of `ANALYTICS_STREAM_FILTERS` in `helpers/analytics-stream.ts`. Cases in `analytics-contributions.test.ts` (a sheet of two entries; `contributionsOfChange` from two entries to three gives only the third's counts; a malformed image gives nothing) and `analytics-stream.test.ts` (insert and modify match, remove doesn't).
- [x] T017 Tests first, then include the sheets wherever the contributions are summed:
  - `packages/databases/core-table/src/helpers/analytics-rebuild.ts`: query each enrolled user's sheets for the course, as it does `quizSummary`, and add their contributions;
  - `packages/databases/core-table/src/helpers/invariants/analytics.ts`: add `snapshot.videoAnswerSheets` to `checkAnalyticsMatchesRecords`'s expected sums, with a breaking test in `invariants/analytics.test.ts` (a sheet entry with no matching `attempts`);
  - `packages/events/src/analytics/analytics-update.test.ts` and `packages/events/src/local/analytics-feature.test.ts`: a sheet's insert and a later modify update `quizQuestionStats` and the active-learner figures once each, and a redelivered record changes nothing.
- [x] T018 Run `pnpm nx run @discava/tooling-agent:entity-writers` and commit `packages/databases/core-table/entity-writers.json` if it changed, then `pnpm nx run @discava/tooling-agent:invariant-coverage` and fix what it reports (the new entity is named by T015's checks).

---

## Phase 4: User Story 2 - Be asked a question while watching (P1)

**Goal**: An enrolled learner playing a video is stopped at each unanswered question, answers or skips, sees the result and explanation, and carries on. A video without questions is unchanged.

**Independent test**: The core-api, `common-web-utils`, `common-shadcn` and student portal tests named below pass. On PR CI, the e2e test "a learner is asked a video question, answers it and carries on" and the concurrency test pass.

- [x] T019 [P] [US2] Add `packages/apis/core-api/src/schema/video-question.ts` with `ViewVideoQuestionsOutputSchema`, `AnswerVideoQuestionInputSchema` and `AnswerVideoQuestionOutputSchema` exactly as in [contracts/core-api-video-questions.md](./contracts/core-api-video-questions.md) (`optionIds: z.array(z.string().min(1)).min(1).max(10)`, `contentHash: z.string().min(1)`), exported through `schema/index.ts`, and `questionCount: z.number().int().min(0)` on `VideoUrlOutputSchema` in `schema/content-item.ts`, omitted from `PreviewVideoUrlOutputSchema`.
- [x] T020 [US2] Tests first, then return `questionCount` from `videoUrl` in `packages/apis/core-api/src/procedures/content-item.ts`: the number of questions on the item, and 0 when the course isn't published. Intended test change: existing assertions on `videoUrl`'s whole output in `procedures/content-item.test.ts` gain `questionCount: 0`; nothing else in them changes. New cases: a video with three questions gives 3, and the same video in an archived course gives 0.
- [x] T021 [US2] Tests first, then add `viewVideoQuestions` in `packages/apis/core-api/src/procedures/video-question.ts` and register `videoQuestion.view` in `packages/apis/core-api/src/router.ts`. It applies `videoUrl`'s access rule (extract the shared reads and checks into a function in the same file or `helpers/playback.ts`, without changing `videoUrl`'s behavior), reads the learner's sheet, and returns the questions without the key and the learner's answers to current questions with the current key. `procedures/video-question-view.test.ts`, with a `video-question.fixtures.ts` modelled on `quiz.fixtures.ts`, covers every row of the contract's table and asserts that no unanswered question's `correctOptionIds` or `explanation` appears anywhere in the output.
- [x] T022 [US2] [US6] Tests first, then add `answerVideoQuestion` in the same file and register `videoQuestion.answer`:
  - checks in the contract's order: access, archived course (`PRECONDITION_FAILED`), the question exists (`NOT_FOUND` "This question is no longer part of the video"), already answered (return the record, `recorded: false`), `contentHash` (`CONFLICT` "This question was updated. Check it before answering"), options (`BAD_REQUEST`);
  - graded all-or-nothing with `gradeAttempt` from `procedures/quiz.ts` on the one question;
  - recorded with `videoAnswerWrites` (T013), `answeredAt` from `studentActivityAt`;
  - a canceled transaction is re-read and judged again up to three times, then `transactionConflict()`, as `submitQuizAttempt` does.

  `procedures/video-question-answer.test.ts` covers every row of the contract's table, plus: the key-only edit is graded against the new key (FR-030); a changed prompt, kind or option gives `CONFLICT` and writes nothing (FR-031); a moved question is accepted (FR-033); the transaction's items in each first-record case; a lost race that finds the answer on record returns it; and that no `itemCompletion`, `progress`, `quizAttempt`, `quizSummary` or certificate write is ever in the transaction (FR-024, SC-003). Then run `pnpm nx run @discava/tooling-agent:entity-writers` and commit the result, and check `pnpm nx run @discava/infra:synth` still succeeds with the two new core-api operations (research R-14).
- [x] T023 [P] [US2] Tests first, then add the `video-questions` module at `packages/common/web-utils/src/video-questions.ts` with the types and functions of [contracts/player-ui.md](./contracts/player-ui.md): `toCues`, `cueTime`, `cuesReached`, `cuesAtEnd`, `positionBeforeCue`, `isCorrectAnswer` and `MAX_PLAYBACK_STEP_SECONDS = 2`. `video-questions.test.ts` covers: order with equal moments and end cues; a cue at 0; a step that straddles one cue, two cues, and none; a backwards step and a step over 2 seconds give nothing; a cue at or past the duration counts as an end cue; `positionBeforeCue` never below 0; `isCorrectAnswer` for exact, partial and superset choices.
- [x] T024 [US2] Tests first, then add cue and overlay support to `packages/common/shadcn/src/components/hls-video.tsx` and `video-controls.tsx`, per the contract's "Reaching a cue" and "While `overlay` is set" (markers come in Phase 5):
  - props `cues`, `onCue`, `overlay` and `onOverlayDismiss`;
  - `onCue(ids, 'reached')` when the video is playing, not seeking, and two time updates straddle unanswered cues (`cuesReached`); nothing during a seek, the update after it, or the resume seek;
  - while `overlay` is set: the video is paused, and plays again when it clears if it was playing; the overlay renders inside the container that goes fullscreen; the control bar is `inert`; the shortcut handler does nothing except pass Escape to `onOverlayDismiss`; focus moves to the overlay's `[data-autofocus]` element and back to Play when it clears; picture-in-picture is left first; no transition with `prefers-reduced-motion`; an overlay taller than the video grows below its frame, and nothing scrolls sideways at 375 px.

  New cases in `video-controls.test.tsx` and `hls-video.test.tsx` for each bullet, including a seek across a cue reporting nothing (FR-014) and Space doing nothing while an overlay is open (FR-040). Without `cues` and `overlay`, the rendered output and every existing case are unchanged.
- [x] T025 [P] [US2] Tests first, then add `VideoQuestionCard` in `packages/common/shadcn/src/components/video-question-card.tsx` with the contract's Unanswered, Submitting, Failed to save and Answered states, built from `RichTextView`, the option list of `quiz-question-screen.tsx` (extract the options fieldset into a shared piece if needed, leaving `QuestionScreen`'s output unchanged) and the verdict of `quiz-result-questions.tsx`. The heading has `data-autofocus` and `tabIndex={-1}`, the verdict sits in a `role="status"` region with an icon and the words "Correct" or "Not quite", buttons are text-only. `video-question-card.test.tsx` covers each state, single and multiple choice, **Submit answer** disabled until an option is chosen, **Skip** enabled while submitting, and the "updated" note.
- [x] T026 [US2] [US6] Tests first, then add `useVideoQuestions` in `packages/common/shadcn/src/hooks/use-video-questions.tsx` per the contract: it builds `cues` with `toCues`, opens the card for reached cues one after another, calls `submit`, shows the result, and clears the overlay on Continue, Skip or Escape. A skipped cue is left out of what the player may report as reached for the life of the component. On `updated` the card stays open, `onChanged` is called and the refreshed question shows with the note; on `removed` the overlay clears; on `failed` the choice is kept with a retry. `use-video-questions.test.tsx` covers each path with a fake `submit`.
- [x] T027 [US2] Tests first, then wire the student portal. Add `packages/websites/student-portal/src/routes/learn/$courseId/-components/video-questions.tsx`: it queries `videoQuestion.view`, passes `useVideoQuestions`' `cues`, `onCue`, `overlay` and `onOverlayDismiss` to `HlsVideo`, calls `videoQuestion.answer` in `submit` (mapping `CONFLICT` to `updated` and the question's `NOT_FOUND` to `removed`), writes each recorded answer into the cached view, and refetches the view on `onChanged`. `VideoPlayer` in `content-item.tsx` uses it only when `videoUrl`'s `questionCount` is above 0. While the view is loading or has failed the video plays without cues (FR-022). `-video-questions.test.tsx` with `renderWithCoreApi`: `questionCount: 0` makes no `videoQuestion.view` call and renders as before (FR-021); a reached question is shown, answered and the result displayed; Skip records nothing; a failing view still plays the video; a `CONFLICT` shows the updated question.
- [x] T028 [US2] Add to `packages/e2e/src/helpers/video-questions.ts` a `setVideoQuestionsViaApi(instructor, item, questions)` helper and locators for the open question, and to `packages/e2e/src/scenarios/video-questions.e2e.ts` the test "a learner is asked a video question, answers it and carries on": an instructor publishes a course with the three-second video (as `createCaptionedVideoViaApi` in `helpers/api.ts` does) and a question at 0:01 with an explanation; a learner made for the test enrols, plays the video, sees it pause with the question focused, answers wrongly, sees "Not quite", the correct option and the explanation, and continues to the end. Then the lesson's progress and the video's **Mark as done** state are as for a video without questions. Take `screenshot(page, 'video question open')` and `screenshot(page, 'video question answered')`.
- [x] T029 [US2] Add `packages/e2e/src/concurrency/video-answer.e2e.ts`, in the style of `concurrent-writes.e2e.ts`, firing at the same moment: (a) one learner's two different answers to one question: one entry is recorded and both responses report it; (b) one learner's first answer and `contentItem.complete` for the same video: the video's `studentActivityCount` rises by exactly 1; (c) two instructors' `contentItem.updateVideoQuestions` from the same version: one `CONFLICT`. The table's invariants hold after each.

---

## Phase 5: User Story 3 - See where the questions are, and go back to one (P2)

**Goal**: Markers on the seek bar, a question opened from its marker, review of an answered one with Try again, resuming just before an open question, and the instructor's preview.

**Independent test**: The marker, review and preview component tests pass. On PR CI, the e2e test "a learner seeks past a question and opens it from its marker" passes.

- [ ] T030 [US3] Tests first, then render the markers in `packages/common/shadcn/src/components/video-controls.tsx` per the contract's "Markers": one `button` per timed cue at `cueTime / duration` of the bar, after the slider in the tab order, with `aria-label` from the cue's `label`, a tick for answered and a dot for unanswered, a hit area of at least 24 by 24 CSS pixels, rendered only once the duration is known. Activating one seeks to its time, pauses and calls `onCue([id], 'chosen')`. Cases in `video-controls.test.tsx`: positions, labels, both states, activation by click and by Enter, and no markers without cues.
- [ ] T031 [US3] Tests first, then report `positionBeforeCue` through `onPositionChange` while an overlay is open for a reached cue, in `packages/common/shadcn/src/components/hls-video.tsx` (spec FR-020), so the pause, the 10-second tick and leaving the page all save one second before the question. Cases in `hls-video.test.tsx`; the reported position is unchanged when no overlay is open.
- [ ] T032 [US3] Tests first, then add review and practice to `VideoQuestionCard` and `useVideoQuestions`: a `chosen` cue opens an unanswered question to answer, or an answered one showing the recorded answer, key and explanation with **Try again** and **Close**. Try again shows the Practising state ("Practice: this answer isn't recorded", **Check answer**, **Close**), graded with `isCorrectAnswer` against the answer already held, and calls `submit` never (spec FR-018). A skipped cue's marker still opens it. Cases in both test files.
- [ ] T033 [US3] [US6] Extend `packages/e2e/src/scenarios/video-questions.e2e.ts` with "a learner seeks past a question and opens it from its marker": with a question at 0:01, the learner seeks to the end without playing through it and no question appears; they choose the marker, answer, and use **Try again**; after a reload the marker shows as answered and playing through 0:01 doesn't pause. Then the instructor changes which option is correct through the API, and the learner's reviewed result is unchanged while the key shown is the new one. Last, the instructor archives the video and `contentItem.deletePermanently` through the API is refused, because a learner has used it (Story 6 scenario 9). Take `screenshot(page, 'seek bar with question markers')` and `screenshot(page, 'reviewing an answered question')`.
- [ ] T034 [US1] Tests first, then show questions in the instructor's previews, graded in the browser and sending nothing (research R-13): **Preview as student** in the editor (`video-questions/video-questions-preview.tsx`, using the questions as they stand in the editor) and the video preview in `attach-lesson-video-dialog.tsx` (the saved questions), both through `useVideoQuestions` with a `submit` that grades with `isCorrectAnswer` against the instructor's `answerKey`. The editor's own player also shows a marker per question, and choosing one scrolls to its card. Component tests assert a question appears, is graded, and that `calls` holds no mutation. Extend the instructor's e2e test from T011 to open **Preview as student**, see the question at 0:01, and take `screenshot(page, 'video questions preview')`.

---

## Phase 6: User Story 4 - A short check when the video ends (P2)

**Goal**: When a video with unanswered end questions finishes, they are asked one after another and a summary follows.

**Independent test**: The end-check component tests pass. On PR CI, the e2e test "a learner takes the check at the end of a video" passes.

- [ ] T035 [US4] Tests first, then in `packages/common/shadcn/src/components/hls-video.tsx` and `video-controls.tsx`: on `ended`, call `onCue(ids, 'ended')` with the unanswered `cuesAtEnd`; render one marker at the right edge for the end cues (label "Questions at the end, 1 of 2 answered"), which seeks to the last second and calls `onCue` with reason `chosen` and the first end cue; and don't resume playback when an overlay clears on an ended video. Cases in both test files, including a timed cue past the duration being reported at the end.
- [ ] T036 [US4] Tests first, then the end check in `useVideoQuestions` and `VideoQuestionCard`: `ended` cues are asked in order with `position` ("Question 1 of 2"), each can be skipped, and after the last a summary card shows "n of m correct" over the end questions answered so far, with **Close**. Escape closes the whole check. When every end question is answered, `ended` opens nothing and the end marker opens a review of them (spec FR-019, Story 4 scenario 3). Cases in `use-video-questions.test.tsx` and `video-question-card.test.tsx`.
- [ ] T037 [US4] Extend `packages/e2e/src/scenarios/video-questions.e2e.ts` with "a learner takes the check at the end of a video": a video with two end questions is played to the end, the first question appears by itself, the learner answers one and skips one, and the summary reads "1 of 1 correct"; **Mark as done** still completes the video. Take `screenshot(page, 'end of video check')` and `screenshot(page, 'end check summary')`.

---

## Phase 7: User Story 5 - See which video questions learners miss (P2)

**Goal**: The course analytics lists videos with questions, and shows each question's answers, misses and miss rate.

**Independent test**: The `analytics-reads`, instructor-api `analytics` and instructor portal panel tests pass. On PR CI, the e2e test "an instructor sees which video question a learner missed" passes.

- [ ] T038 [US5] Tests first, then add `readCourseVideoQuestions` and `readVideoQuestionAnalytics` to `packages/databases/core-table/src/helpers/analytics-reads.ts` ([contracts/instructor-api-analytics.md](./contracts/instructor-api-analytics.md)), over the existing `loadCourse`, and return `videoQuestions` from `readCourseAnalytics`. Extract the per-question figures and ranking (`MIN_RANKED_ATTEMPTS = 5`, miss rate then answers, the prompt as plain text) from `readQuizAnalytics` into one function both use, leaving `readQuizAnalytics`' results unchanged. Cases in `analytics-reads.test.ts`: the listing's order, hidden and archived videos, lessons and modules left out, a video without questions left out, figures with 4, 5 and more answers, a removed question dropped, a new one at zero.
- [ ] T039 [US5] Tests first, then in instructor-api: `videoQuestions` on `CourseAnalyticsOutputSchema` and `VideoQuestionsAnalyticsOutputSchema` in `packages/apis/instructor-api/src/schema/analytics.ts`; `course` returning the new field and a new `videoQuestions` procedure on `analyticsCourseProcedure` in `procedures/analytics.ts` (`NOT_FOUND` when the read returns nothing); `analytics.videoQuestions` in `router.ts`. Intended test change: assertions on `analytics.course`'s whole output in `procedures/analytics.test.ts` gain `videoQuestions: []`. New cases: the listing, the figures, and `NOT_FOUND` for a hidden video, a video without questions, a quiz's id, and a caller who doesn't teach the course. Check `pnpm nx run @discava/infra:synth` still succeeds with the new operation.
- [ ] T040 [US5] Tests first, then add `video-questions-panel.tsx` in `packages/websites/instructor-portal/src/routes/_authenticated/dashboard_/$courseId/-components/`, beside `quiz-panel.tsx` and following it, and render it from `route.tsx`: the videos with their question counts; choosing one loads `analytics.videoQuestions` and lists each question's moment ("1:30" or "End of video"), prompt text, answers, misses and miss rate, with "Not enough answers yet" under 5; and "No videos with questions are shown to learners yet." when the list is empty. `video-questions-panel.test.tsx` with `renderWithInstructorApi`, and `-route.test.tsx` updated only by adding the new field to its `analytics.course` handler.
- [ ] T041 [US5] Add "an instructor sees which video question a learner missed" to `packages/e2e/src/scenarios/analytics.e2e.ts`, following its quiz test: a learner answers a video question wrongly through the portal, `waitForAnalytics()` settles, and the instructor's **Video questions** card shows the video and the question with 1 answer and 1 miss. A second instructor can't open it. Take `screenshot(page, 'video question results')`.

---

## Phase 8: User Story 7 - Nudges towards asking questions (P3)

**Goal**: A new quiz reveals answers after each attempt by default, and the lesson drop-off view names modules with video and no questions.

**Independent test**: The quiz schema and builder tests, the `analytics-reads` module cases and the drop-off component test pass.

- [ ] T042 [P] [US7] Tests first, then pin the reveal default (research R-12):
  - `revealAnswers: z.enum([...]).default('after_each_attempt')` in `QuizSettingsSchema`, `packages/apis/instructor-api/src/schema/quiz.ts`, with cases in `schema/content-item.test.ts` and `procedures/content-item-quiz.test.ts`: a quiz created without the setting is stored with `after_each_attempt`, and one sent with `never` keeps it. Check every use of the settings input type still compiles and none can now store `undefined`;
  - a test in the instructor portal's `quiz/quiz-form` tests that `newQuiz()` starts on `after_each_attempt`, and that `fromQuizItem` keeps a saved `never`;
  - the hint "Learners remember more when they see the answers straight after each attempt." under the select in `quiz/quiz-settings-section.tsx`, with a component test, and `screenshot(page, 'new quiz reveal setting')` where `packages/e2e/src/scenarios/quiz.e2e.ts` has the builder's settings open for a new quiz (add that step to its instructor part if it builds the quiz another way).
- [ ] T043 [US7] Tests first, then add `modulesWithoutQuestions` (research R-11): computed in `packages/databases/core-table/src/helpers/analytics-reads.ts` from the shown curriculum (a shown module with at least one shown video and no shown quiz and no shown video with questions, in course order), returned by `readCourseAnalytics`, added to `CourseAnalyticsOutputSchema` in `packages/apis/instructor-api/src/schema/analytics.ts` and returned by `course` in `procedures/analytics.ts`. Intended test change: assertions on `analytics.course`'s whole output gain `modulesWithoutQuestions: []`. New cases in `analytics-reads.test.ts` for each combination: video only, video and quiz, video with questions, no video, only a hidden video, a hidden quiz beside a shown video, and an archived module.
- [ ] T044 [US7] Tests first, then show the note in `packages/websites/instructor-portal/src/routes/_authenticated/dashboard_/$courseId/-components/lesson-drop-off.tsx`, passed from `route.tsx`: "These modules have video and no questions: <titles>. Learners remember more when a video asks them something." above the list, and nothing when the list is empty. Cases in `lesson-drop-off.test.tsx`; its existing cases pass unchanged. Extend the e2e analytics test from T041 with a module holding only a video without questions, expect the note, and take `screenshot(page, 'drop-off note for modules without questions')`.

---

## Phase 9: Polish - docs and manual checks

**Goal**: The design pages describe the feature, and reviewers confirm by hand what tests can't.

- [ ] T045 [P] Update the English design pages, and note in the PR that translations of the other locales are pending:
  - `docs/src/content/docs/en/design/quizzes.mdx`: a "Questions in videos" section (where they are stored, the versioned save, the per-question hash, the answer sheet, first answer only, the rules after edits as a table like "Quiz edited mid-attempt") and a "Spec" link to `specs/20261120-002940-in-video-questions/` in the style of `video-player.mdx`;
  - `video-player.mdx`: a "Questions" section (when a question is asked, seeking, markers, the end check, resuming before an open question, what is and isn't recorded);
  - `course-analytics.mdx`: "Active learner" gains "or answered a video question", a row for video question results, and the drop-off note;
  - `live-course-editing.mdx`: `studentActivityCount` for a video counts an answer sheet as well as a completion, and an "Edit content item: video questions" row;
  - `progress-and-completion.mdx`: answering a video question isn't a completion and changes no progress.
- [ ] T046 [P] Add a line under "Features" in `packages/databases/core-table/CLAUDE.md`: video questions (#591), `videoAnswerWrites` as the only writer of `videoAnswerSheet`, and the first-record check it shares with `contentItem.complete`. Add `videoQuestion` to the feature notes in `packages/apis/CLAUDE.md`.
- [ ] T047 (human) Run [quickstart.md](./quickstart.md) steps 1 to 23 against `pnpm dev` in Chrome and Safari, saving screenshots to `tmp/screenshots/pr-<number>/`. Confirm in particular: a question shows within a second of its moment (SC-001), fullscreen is kept, nothing scrolls sideways at 375 px, and a video without questions makes no `videoQuestion.view` request.
- [ ] T048 (human) Run quickstart steps 24 and 25 with VoiceOver or NVDA: the question is announced when the video pauses, the result when it arrives, focus returns to Play, and each marker says its time and state (spec FR-039, SC-008).
- [ ] T049 (human) On `discava-development` after the last PR deploys, play a video with questions on a phone (iOS Safari and Android Chrome): the question shows over the inline player, answering works with signed cookies in place, and the analytics figures follow within 30 seconds.

---

## Dependencies

- Phase 1 → Phase 2 (the editor calls the save). Phase 3 needs nothing from Phases 1 and 2 except T004's snapshot fields, and can be built alongside Phase 2. Phase 4 needs Phases 1 and 3. Phase 5 → Phase 6 (the end marker joins Phase 5's markers). Phase 7 needs Phase 3's contributions and Phase 4's answers. Phase 8's T042 can start any time; T043 and T044 come after Phase 7, because they touch the same output and route. Phase 9's T045 and T046 come after Phase 8, and the **(human)** tasks last.
- Within Phase 1: T001, T003 and T004 in parallel, then T002, then T005.
- Within Phase 2: T006 and T007 in parallel, then T008, T009, T010, then T011.
- Within Phase 3: T012 first; T013 and T016 in parallel; then T014, T015 and T017; then T018.
- Within Phase 4: T019, T023 and T025 in parallel; T020, T021 and T022 after T019; T024 after T023; T026 after T024 and T025; T027 after T021, T022 and T026; then T028 and T029.

## Parallel examples

```text
Phase 1:  T001 (schemas)  ║  T003 (core-api leak tests)  ║  T004 (video-questions-shape)
Phase 2:  T006 (onTimeChange)  ║  T007 (editor form logic)
Phase 3:  T013 (answer writes)  ║  T016 (analytics contributions)
Phase 4:  T019 (core-api schemas)  ║  T023 (cue logic)  ║  T025 (question card)
```

## Implementation strategy

- **First PR**: Phases 1 and 2. Instructors can put questions on a video. Learners aren't asked them yet, which the PR description says.
- **Core**: Phase 3 (the record and its rules, with nothing calling them), then Phase 4, after which a learner is asked each question at its moment and sees the explanation before the video resumes. Phases 1 to 4 meet the issue's first three acceptance criteria and its unit-test criterion.
- **Then**: Phase 5 (markers, review, preview), Phase 6 (the end check), Phase 7 (results, the issue's fourth criterion) and Phase 8 (the two companions). Each is a small PR that leaves `main` working.
- **Finally**: Phase 9's docs, and the reviewer's manual checks before the last PR merges.
