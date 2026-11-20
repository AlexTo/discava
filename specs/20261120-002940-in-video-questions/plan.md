# Implementation Plan: Questions Inside and Straight After Videos

**Branch**: `20261120-002940-in-video-questions` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261120-002940-in-video-questions/spec.md`

## Summary

An instructor puts up to 20 questions on a video item, each at a moment or at the end. They are stored on the video's own content item in the attributes a quiz already uses, and saved as one versioned document by a new instructor-api mutation. For a learner, the shared player pauses when playback reaches an unanswered question, shows it over the video, records the first answer through a new core-api mutation, shows the key and explanation, and resumes. Markers on the seek bar show where the questions are; seeking never forces one. Answers go in one new record per learner per video (`videoAnswerSheet`), written by a core-table helper that also counts the learner as having used the video, and never touch completion, progress, quiz results or certificates. The instructor's analytics reuses the per-question aggregate quizzes have. Two companions ship with it: the "after each attempt" reveal default is pinned, and the drop-off view names modules with video and no questions.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC and zod (`@discava/core-api`, `@discava/instructor-api`), ElectroDB through `@discava/core-table`, hls.js and the shared player (`@discava/common-shadcn`'s `HlsVideo` and `VideoControls`), `@discava/common-web-utils` (`quiz`, `video-player`), `@discava/common-tiptap` for prompts and explanations, TanStack Router and Query in the portals. No new runtime library.

**Storage**: The core DynamoDB table. One new entity (`videoAnswerSheet`), three existing `contentItem` attributes now also set on videos, one more source for the existing `quizQuestionStats` aggregate. No new index. See [data-model.md](./data-model.md).

**Testing**: vitest for core-table helpers, invariants and analytics; procedure tests in both APIs with the existing fixtures pattern; component tests in `common-shadcn`, `common-web-utils` and both portals; a new Playwright scenario (`packages/e2e/src/scenarios/video-questions.e2e.ts`) with `screenshot()`, and a concurrency test.

**Target Platform**: AWS Lambda behind API Gateway (core-api, instructor-api), the `analytics-update` stream feature, the student and instructor portals. Locally, `pnpm dev` as it stands.

**Project Type**: Web application: a serverless backend plus React portals.

**Performance Goals**: A question shows within 1 second of its moment (SC-001); the check runs on the player's time updates, about four a second, with no network call at that point because the questions are already loaded. Recording an answer is one transaction of at most seven items. Results follow the analytics' existing freshness (30 seconds).

**Constraints**:
- A video with no questions makes the same requests and renders the same controls as today (FR-021).
- The answer key never reaches a learner before their answer is recorded (FR-013).
- An answer writes nothing that completion, progress, quiz results or certificates read (FR-024).
- A recorded answer never changes (FR-026).
- No infrastructure change, and everything runs under `pnpm dev` (FR-041).

**Scale/Scope**: At most 20 questions per video, one sheet per learner per video. One new entity, one core-table helper file, one instructor-api mutation, two core-api procedures and one new field, two analytics reads, generic cue support in the shared player, a question card and hook, an editor dialog, two analytics UI additions and two design-page sections.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | The same Lambdas, table and stream feature. No new service (research R-14) |
| II. Generators first | Pass | No new project or component: procedures in existing APIs, an entity in the existing table, components in existing packages. No generator applies to any of those |
| III. Everything runs locally | Pass | Nothing new to stand in for. The local event runner reads the same `ANALYTICS_STREAM_FILTERS`, and local transcoding already yields a playable video for the e2e scenario |
| IV. Layered tests | Pass, planned | Unit tests for every helper and procedure, with authorisation, answer recording and the edit-after-answers cases the issue names. Two new invariants and six extended, each with a breaking test. One e2e scenario and one concurrency test. Impact check below |
| V. Single-table via ElectroDB | Pass | `videoAnswerSheet` is an entity in the core table, keyed by user like `quizSummary`. Access patterns VQ1 to VQ8 are listed in the data model; each user-facing one is a get or an existing collection query. No scan in a request, no new index. `STREAM_FEATURES`: only `analytics-update`'s filter list gains the entity (R-7) |
| VI. Secure by default | Pass | Authoring is limited to the course's instructors in the service. Reading and answering need an active enrolment and a shown video. The key is held apart from the questions and returned only for answered ones. Results carry no learner identifier. No construct or stage setting changes |
| VII. Change freely before launch | Pass | `contentItem.videoUrl` and `analytics.course` gain fields outright. No alias or fallback: a video without the attributes simply has no questions |
| VIII. Repo conventions | Pass | `core-table/src/helpers/video-question.ts` beside `entities/video-answer-sheet.ts`. Shared non-UI logic in `common-web-utils/video-questions`, shared UI in `common-shadcn`, portal-private code in `-components/`. Text-only buttons. Screenshots in the e2e scenario. English docs, with translations noted as pending |

**Impact check (constitution IV).** The shared records this feature writes, or reads in a new way, and what already covers them:

| Record | What changes | Existing cover | Extended or added |
|---|---|---|---|
| `contentItem.studentActivityCount` (video) | Now also counts learners with an answer sheet. Two writers can claim a learner's first record: `contentItem.complete` and `videoQuestion.answer` | `activity-count-matches-students` and its tests; `completion.test.ts` | The invariant counts sheets (T011). Both writers go through one helper with a cross check (T009, T010), covered by unit tests and a concurrency test (T029) |
| `contentItem.questions`, `answerKey`, `quizVersion` | Now also on videos | The quiz save tests; curriculum invariants | New `video-questions-shape` (T004) |
| `enrolment.lastActivityAt` | Also moved by an answer, through `studentActivityWrites` | `last-activity-at-current` | Extended to sheets (T011) |
| `itemCompletion` | Read and condition-checked when answering. Never created by an answer | `progress-matches-completions`, `completed-at-iff-completed` | Unchanged; tests assert an answer creates none (T025) |
| `quizQuestionStats`, `periodStats` | Sheets contribute counts and active learners | `analytics-matches-records`, `analytics-contributions.test.ts`, `analytics.e2e.ts` | Contributions, rebuild and invariant extended (T012 to T014) |
| `videoAnswerSheet` | New | none | Added to the snapshot, with `video-answer-sheet-shape` and the four placement checks (T008, T011) |
| `quizAttempt`, `quizSummary`, `progress`, `certificate` | Untouched | | Tests assert so (T025) |

"Active learner" in the analytics gains "answered a video question". That is a definition change, recorded in research R-7 and made in the docs task.

**Weakened or changed tests (constitution IV).** None is weakened. Three existing tests gain an expectation because an output gains a field: `contentItem.videoUrl`'s output assertions gain `questionCount` (T024), and tests that compare the whole `analytics.course` output gain `videoQuestions` and `modulesWithoutQuestions` (T041). Each task names its change, and the PR says so. Every existing player test must pass unchanged (SC-002).

## Design Decisions (detail in [research.md](./research.md))

1. **Questions live on the video's content item** (R-1), in `questions`, `answerKey` and `quizVersion`, each question with `atSeconds` and a server-set `contentHash`.
2. **One versioned save** (R-2): `contentItem.updateVideoQuestions`, built like the quiz save. Version 0 means never saved.
3. **One answer sheet per learner per video** (R-3), conditioned on its `answerCount` like a quiz summary on `attemptsUsed`.
4. **A hash per question** (R-4) separates "what the learner sees changed" from "only the key changed", so edits follow the quiz rules question by question.
5. **An answer is student activity** (R-5): it goes through `studentActivityWrites`, and the first-record count is shared with **Mark as done** by a cross check both writers add.
6. **Only the first answer is recorded** (R-6). The key comes back with it, and Try again is graded in the browser.
7. **The quiz question aggregate is reused** (R-7, R-8): one more case in the contribution table feeds the stream handler, the rebuild and the invariant alike.
8. **`videoUrl` says how many questions there are; a separate query loads them** (R-9), so a video without questions costs nothing more.
9. **The player gets generic cues and an overlay** (R-10), with the pause-and-ask rules as pure functions in `common-web-utils`.
10. **The drop-off note is computed on read** (R-11) from the curriculum.
11. **The reveal default is pinned, and added to the API schema** (R-12).
12. **Instructors preview with their own key** (R-13); nothing is sent.

## Project Structure

### Documentation (this feature)

```text
specs/20261120-002940-in-video-questions/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-1 to R-15
├── data-model.md        # Phase 1: the entity, the reused attributes, access patterns, invariants
├── quickstart.md        # Phase 1: how to check it by hand
├── contracts/
│   ├── instructor-api-video-questions.md   # contentItem.updateVideoQuestions and the schema changes
│   ├── core-api-video-questions.md         # videoQuestion.view, videoQuestion.answer, videoUrl.questionCount
│   ├── player-ui.md                        # cue logic, player props, the question card and hook
│   ├── instructor-portal-ui.md             # the editor, preview, analytics card and drop-off note
│   └── instructor-api-analytics.md         # analytics.course additions and analytics.videoQuestions
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/databases/core-table/src/
├── entities/video-answer-sheet.ts            # new entity
├── entities/index.ts, service.ts             # register it
├── helpers/video-question.ts                 # new: videoAnswerWrites, videoFirstRecordCheck, question and answer types
├── helpers/video-question.test.ts            # new
├── helpers/analytics-contributions.ts        # + 'videoAnswerSheet' case; ANALYTICS_STREAM_FILTERS (analytics-stream.ts) gains it
├── helpers/analytics-rebuild.ts              # + sheets among the records summed
├── helpers/analytics-reads.ts                # + readCourseVideoQuestions, readVideoQuestionAnalytics, modulesWithoutQuestions
├── helpers/invariants/snapshot.ts            # + videoAnswerSheets
├── helpers/invariants/student-activity.ts    # extended checks, + video-answer-sheet-shape
├── helpers/invariants/curriculum.ts          # + video-questions-shape
├── helpers/invariants/analytics.ts           # + sheets in the expected sums
└── entity-writers.json                       # regenerated

packages/apis/instructor-api/src/
├── schema/quiz.ts                            # + VideoQuestionInputSchema, VideoQuestionSchema, MAX_VIDEO_QUESTIONS; revealAnswers default
├── schema/content-item.ts                    # VideoContentItemSchema + questions, answerKey, quizVersion; UpdateVideoQuestions schemas
├── schema/analytics.ts                       # + videoQuestions, modulesWithoutQuestions, VideoQuestionsAnalytics schemas
├── procedures/content-item-video-questions.ts        # new: updateContentItemVideoQuestions
├── procedures/content-item-video-questions.test.ts   # new
├── procedures/analytics.ts                   # + videoQuestions; course returns the new fields
└── router.ts                                 # contentItem.updateVideoQuestions, analytics.videoQuestions

packages/apis/core-api/src/
├── schema/video-question.ts                  # new
├── schema/content-item.ts                    # VideoUrlOutputSchema + questionCount
├── procedures/video-question.ts              # new: viewVideoQuestions, answerVideoQuestion
├── procedures/video-question-view.test.ts, video-question-answer.test.ts, video-question.fixtures.ts   # new
├── procedures/content-item.ts                # videoUrl returns questionCount
├── procedures/completion.ts                  # a video's first record considers the sheet
└── router.ts                                 # videoQuestion: { view, answer }

packages/common/web-utils/src/
├── video-questions.ts                        # new module: cues, reached and end rules, grading
└── video-questions.test.ts                   # new

packages/common/shadcn/src/
├── components/hls-video.tsx                  # cues, onCue, overlay, onOverlayDismiss, onTimeChange
├── components/video-controls.tsx             # markers, inert bar and shortcuts off while an overlay is open, focus
├── components/video-question-card.tsx        # new
├── hooks/use-video-questions.tsx             # new
└── (tests beside each)

packages/websites/student-portal/src/routes/learn/$courseId/-components/
├── content-item.tsx                          # VideoPlayer reads questionCount
├── video-questions.tsx                       # new: view query, answer mutation, wiring
└── -video-questions.test.tsx                 # new

packages/websites/instructor-portal/src/routes/_authenticated/
├── my-courses_/$courseId/-components/content-items/video-questions/   # new: dialog, editor hook, form mapping, preview
├── my-courses_/$courseId/-components/content-items/lesson-content-items-row.tsx   # Questions button and count
├── my-courses_/$courseId/-components/content-items/attach-lesson-video-dialog.tsx # preview shows questions
├── my-courses_/$courseId/-components/content-items/quiz/quiz-settings-section.tsx # hint
├── dashboard_/$courseId/-components/video-questions-panel.tsx          # new
├── dashboard_/$courseId/-components/lesson-drop-off.tsx                # the note
└── dashboard_/$courseId/route.tsx                                      # passes the new fields

packages/e2e/src/
├── helpers/video-questions.ts                # new: set questions through the API, find the question and markers
├── scenarios/video-questions.e2e.ts          # new
└── concurrency/video-answer.e2e.ts           # new

docs/src/content/docs/en/design/
├── quizzes.mdx                               # + "Questions in videos", "Spec" link
├── video-player.mdx                          # + "Questions"
├── course-analytics.mdx                      # active learner definition, video question results, the drop-off note
├── live-course-editing.mdx                   # studentActivityCount's video rule, the edit row for video questions
└── progress-and-completion.mdx               # an answer isn't a completion
```

**Structure Decision**: The rule two APIs must agree on (who is counted as having used a video) goes in core-table with its invariant, as the constitution requires. Authoring stays in instructor-api beside the quiz save it copies. Answering is a new `videoQuestion` router in core-api, because `contentItem.videoUrl` runs on a dedicated function whose job shouldn't grow (R-9). The player's new behavior is generic and lives in the shared packages both portals already use. Only the API wiring is portal-private.

## Delivery order

Eight implementation PRs, each leaving `main` working:

1. Storage and the save procedure, then the instructor's editor (tasks Phases 1 and 2). Instructors can author; learners see nothing yet.
2. The answer sheet, its helper, invariants and analytics contributions (Phase 3). Nothing calls it yet.
3. Learners are asked while watching (Phase 4): the feature's core.
4. Markers, seeking, review and Try again, and the instructor's preview (Phase 5).
5. The end check (Phase 6).
6. Results in analytics (Phase 7).
7. The two companions (Phase 8).
8. Docs and the reviewer's manual checks (Phase 9).

Between PR 1 and PR 3 an instructor can add questions that learners aren't yet asked. Discava hasn't launched, so that gap is acceptable; PR 1's description says so.

## Complexity Tracking

No violations to justify.
