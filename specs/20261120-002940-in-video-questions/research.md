# Research: Questions Inside and Straight After Videos

Decisions made while planning, each checked against the code on `main` (2026-11-20). "Today" means what that code does.

## R-1: Where a video's questions are stored

**Decision**: On the video's own `contentItem` record, in the attributes a quiz already uses: `questions`, `answerKey` and `quizVersion`. Each stored question is a quiz question plus `atSeconds` (a whole number, or `null` for an end question) and `contentHash` (R-4). A video has no `settings` and no `questionsHash`.

**Rationale**:
- `contentItem` (`packages/databases/core-table/src/entities/content-item.ts`) already declares `questions`, `answerKey` and `quizVersion` as untyped attributes whose shape "is enforced by the zod schemas, not by ElectroDB". No entity change is needed.
- The questions are read with the video in one get, by the same reads that already load the item (`contentItem.videoUrl`, instructor-api's `course.view`).
- `questions` and `answerKey` are separate attributes precisely so a content item passed to students can't leak answers. core-api's `ContentItemSchema` for a video (`schema/course.ts`) lists only `s3Key`, `mimeType` and `durationSeconds`, so its output is already stripped. A test pins that.
- `studentActivityWrites` (`helpers/student-activity.ts`) already accepts a `quizVersion` and conditions the item on it, so "the questions are still the ones this answer was graded against" costs nothing new.
- 20 questions at the quiz's per-question bounds are far below the 300 KB cap quizzes hold themselves to (`MAX_QUIZ_CONTENT_BYTES`), and the item's other attributes are small.

**Alternatives considered**:
- *A child entity per question* (sk under the content item). Rejected: the whole set is edited and versioned as one document (FR-004), every read wants all of them, and the curriculum collection would return them to every course read.
- *New attributes (`videoQuestions`, `videoAnswerKey`…)*. Rejected: the same shapes under second names, and `studentActivityWrites`' version condition would need a second attribute to check.
- *A hidden quiz item linked to the video*. Rejected: it would have to be kept out of the lesson's item list, progress, the step bar and the quiz analytics, and attempts and pass marks don't apply.

## R-2: Saving a video's questions

**Decision**: A new instructor-api mutation, `contentItem.updateVideoQuestions`, that replaces the whole set against the `quizVersion` the editor loaded, built like `contentItem.updateQuiz` (`procedures/content-item-quiz.ts`): `courseInstructorProcedure`, `requireNotArchived`, `requireAncestorsNotArchived`, then `writeUnderActiveAncestors` with the patch conditioned on `notExists(archivedAt)` and the stored version. A video that has never had questions is at version 0 (the attribute is absent), and the condition for that case is `notExists(quizVersion)`.

**Rationale**: It is the pattern FR-004 and FR-005 describe, already proven by the quiz tests (`content-item-quiz.test.ts`, `curriculum-lifecycle-races.test.ts`). Keeping it separate from `contentItem.updateVideo` matters: that procedure replaces the upload and resubmits a transcode, and questions must be editable without touching the media.

**Alternatives considered**: per-question add, update and delete procedures. Rejected: three procedures and an ordering problem in exchange for nothing, since the editor already holds the whole set, as the quiz builder does.

## R-3: One answer sheet per learner per video

**Decision**: A new entity, `videoAnswerSheet`, keyed like `quizSummary` (pk `userId`, sk `courseId / contentItemId`), holding an `answers` map of `questionId` to `{ optionIds, correct, answeredAt, quizVersion }` and an `answerCount`. The learner's first answer on a video creates it; each later answer rewrites the map with one more entry, conditioned on the `answerCount` that was read.

**Rationale**:
- It is the single per-student, per-item record that `studentActivityCount` needs (R-5), exactly as `quizSummary` is for a quiz.
- One get returns everything the player needs to know about what the learner has answered.
- Conditioning on `answerCount` is the pattern `quizSummary` uses with `attemptsUsed`, so two tabs answering at once can't both land: the loser re-reads and finds the question answered (FR-028).
- The record is bounded: at most one entry per question the video has ever had. With 20 current questions and edits over time it stays a few kilobytes.
- The analytics stream handler works from a record's old and new images (`contributionsOfChange`), so a sheet that gains an entry contributes exactly that entry's counts (R-7).

**Alternatives considered**:
- *One record per answer* (sk `… / questionId`). Rejected: there would be no single record to condition the first-record count on, so the `studentActivityCount` race in R-5 would need a second marker record anyway.
- *Reusing `quizAttempt` and `quizSummary`*. Rejected: they carry scores, passes, attempt limits and completion, and the score-band analytics and `quiz-summary-matches-attempts` invariant read them. Low-stakes answers must stay out of all of that (FR-023, FR-024).

## R-4: Telling "the question changed" apart from "only the key changed"

**Decision**: instructor-api stores a `contentHash` on each question when it saves: the existing `hashQuizQuestions` (`helpers/quiz-hash.ts`) applied to that one question's `questionId`, `kind`, `prompt` and `options`. core-api sends it to the player with the question, the player sends it back with the answer, and core-api compares it with the stored one. A mismatch is `CONFLICT` and records nothing.

**Rationale**:
- It gives FR-030 and FR-031 the quiz rule ("if the screen could look different, the student reviews") per question, so an edit to question B never interrupts a learner answering question A, and moving a question's moment changes nothing (`atSeconds` is not hashed).
- Storing the hash at save time, as a quiz stores `questionsHash`, means core-api needs no hashing code and the helper stays in instructor-api, its only user.

**Alternatives considered**:
- *One hash for the whole set, like a quiz*. Rejected: any edit anywhere on the video would bounce every in-flight answer.
- *Comparing `quizVersion`*. Rejected: a key-only edit bumps the version, and FR-030 says that edit must be invisible.

## R-5: An answer counts as student activity

**Decision**: The answer's transaction is built from `studentActivityWrites`, and a learner's first record on a video, whichever comes first of the `itemCompletion` and the `videoAnswerSheet`, increments `studentActivityCount` once. Each of the two writers, when it claims the first record, adds a condition check that the other record still doesn't exist.

**Rationale**:
- `studentActivityCount` is "distinct students with any data for this item" and gates permanent delete (`design/live-course-editing`). A recorded answer is student data. Without counting it, an archived video that learners answered but never marked done could be deleted for good, leaving their sheets pointing at nothing.
- `studentActivityWrites` brings the checks FR-027 needs in the same transaction: the course is published, the module, lesson and item are shown, the learner is enrolled and not dropped, and `lastActivityAt` moves forward.
- The race: a learner presses **Mark as done** and answers a question at the same moment. Both read "no record yet" and both would add 1. With the cross checks, the two transactions touch each other's key, so DynamoDB cancels one, which re-reads, finds the other's record, and writes without incrementing. Neither record is ever removed, so once one exists the other writer needs no check.
- This is a rule two procedures keep (`contentItem.complete` and `videoQuestion.answer`), so it goes in a core-table helper both call, with the `activity-count-matches-students` invariant extended (constitution IV).

**Alternatives considered**: treating an answer like a `videoPosition`, which "is not student activity" and doesn't stop a delete. Rejected: a position is disposable, while an answer feeds the instructor's figures and is the learner's work.

## R-6: Which answer is recorded, and how the learner sees the key

**Decision**: Only the first answer per question is recorded and it is never rewritten (spec Clarifications). The response to recording it carries the correct options and explanation for that question. **Try again** is graded in the browser against that revealed key with the same all-or-nothing rule (`gradeQuiz` in `@discava/common-web-utils/quiz`), and sends nothing.

**Rationale**:
- The key reaches the learner only after their answer is on record (FR-013), so it can't be probed one option at a time, which is why quizzes withhold per-question feedback.
- An immutable entry makes SC-007 a property of the write (the map only gains keys) and keeps the analytics simple: a sheet's contribution only grows.
- `videoQuestion.view` returns the key for questions the learner has already answered, so a review on another device works.

**Alternatives considered**: recording every try, or the latest. Rejected: miss rates would fall as learners click through options, and the record would no longer say what the learner knew when the video asked.

## R-7: Instructor figures reuse the quiz question aggregates

**Decision**: `contributions('videoAnswerSheet', image)` in `helpers/analytics-contributions.ts` yields, for each entry in `answers`, one `attempts` (and one `misses` when `correct` is false) on the existing `quizQuestionStats` item `QUIZ#<contentItemId>#Q#<questionId>`, and a member for the day and week of each `answeredAt`. `videoAnswerSheet` joins the `INSERT` and `MODIFY` lists of `ANALYTICS_STREAM_FILTERS`. `analytics-rebuild.ts` and the `analytics-matches-records` invariant add the sheets to the records they sum.

**Rationale**:
- The contribution table is "used by three callers that must agree": the stream handler, the rebuild and the invariant. Adding one case there updates all three.
- The stream handler applies `contributions(after) - contributions(before)`, so a sheet going from 2 entries to 3 adds exactly the third.
- `quizQuestionStats` is keyed by content item and question, with nothing quiz-specific in it. A video's `contentItemId` never collides with a quiz's.
- Members are "only ever added", and a sheet's entries are never removed, so the active-learner figures stay correct.
- No stream feature other than `analytics-update` needs the new entity: progress recalculation reacts to completions and curriculum visibility, and search to courses and ratings.

**Alternatives considered**: a new aggregate entity for video questions. Rejected: same shape, a second range to query, and a second set of invariant comparisons.

**Definition change to record**: "Active learner" (`design/course-analytics`) gains "or answered a video question". The docs task updates the table.

## R-8: Reading the figures

**Decision**: `analytics.course` gains `videoQuestions` (the shown videos that have questions, in course order, with their question count) and `modulesWithoutQuestions` (R-11). A new `analytics.videoQuestions` query returns one video's per-question figures. Both are served by `loadCourse` in `helpers/analytics-reads.ts`, which already reads the course's aggregates and curriculum in two queries. The ranking code in `readQuizAnalytics` (miss rate, `MIN_RANKED_ATTEMPTS`, the prompt as plain text) is shared by extracting it, not copied.

**Rationale**: no new access pattern: the same partition reads the quiz analytics use. A separate procedure from `analytics.quiz` keeps that one's output (score bands, students) honest, since a video has neither.

## R-9: How the player learns a video has questions, and gets them

**Decision**: `contentItem.videoUrl`'s output gains `questionCount`. When it is above 0 the student portal calls a new query, `videoQuestion.view`, which returns the questions without the key, plus the learner's recorded answers with the key for those questions only. Recording is a new mutation, `videoQuestion.answer`. Both run on core-api's shared router Lambda.

**Rationale**:
- A video without questions makes exactly the requests it makes today (FR-021): `videoUrl` already reads the item, so the count is free.
- `videoUrl` runs on a dedicated function that holds the CloudFront signing key (`CORE_API_DEDICATED_FUNCTIONS`). Keeping question reads and the answer write off it keeps that function's job, and its table permissions, as they are.
- `videoUrl` is cached for an hour for the cookies' sake (`content-item.tsx`). Questions and answers have their own query with its own freshness, refetched after `CONFLICT`.
- If `videoQuestion.view` fails, the video simply plays (FR-022).

**Alternatives considered**: returning the questions inside `videoUrl`. Rejected for the caching and the dedicated function reasons above.

## R-10: Where the pause-and-ask logic lives

**Decision**: Three layers, following the split the player already has.

1. **Pure logic** in a new `@discava/common-web-utils/video-questions` module: the cue list built from questions and answers, which cues are due when playback moves from one time to the next, the difference between playing through a moment and seeking over it, where an out-of-range question falls, and the position to report while a question is open. Unit-tested without a DOM.
2. **The shared player** (`common-shadcn`'s `hls-video.tsx` and `video-controls.tsx`) gains generic cue support: markers on the seek bar, a callback when a cue is due or chosen, and an overlay slot that pauses the video, makes the control bar inert, stops the keyboard shortcuts and manages focus. It knows nothing about questions.
3. **A question card** in `common-shadcn` (`video-question-card.tsx`), built from the pieces the quiz card already uses (`QuestionScreen`'s option list, `RichTextView`, the verdict from `quiz-result-questions.tsx`), and a small controller hook each portal feeds: the student portal with core-api calls, the instructor portal with the key it already has.

**Rationale**:
- `HlsVideo` is used by both portals and the course preview. A generic cue and overlay API keeps it reusable, and is what the transcript panel (#590) and the AI tutor's hints (#289) will also need: a moment in the video and something to show there.
- Detecting "reached" needs care. The `timeupdate` event fires about four times a second, so a cue is due when the previous and current times straddle it while the video is playing and not seeking. A seek sets a flag (`seeking` to `seeked`) that suppresses that test, which is FR-014.
- The overlay must be inside the player's container, because that element is what goes fullscreen (`VideoControls`' `containerRef`). A portal to `document.body` would be hidden in fullscreen.
- The control bar's keyboard handler already ignores keys from typing targets (`isTypingTarget`). While an overlay is open it returns early for everything, and Escape is handed to the overlay.

**Alternatives considered**: a Radix `Dialog` over the page. Rejected: it portals out of the fullscreen element, and a modal over the whole page is heavier than a question over a video needs to be.

## R-11: The drop-off note

**Decision**: Computed on read in `analytics-reads.ts` from the curriculum `loadCourse` already has: a shown module is listed when it has at least one shown video item and no shown quiz item and no shown video with a non-empty `questions`. `analytics.course` returns `modulesWithoutQuestions: [{ moduleId, title }]` in course order, and `LessonDropOff` renders a note naming them.

**Rationale**: it is a fact about the current curriculum, not a count of events, so there is nothing to keep up to date from the stream and no aggregate to drift.

## R-12: "Reveal answers after each attempt" as the default

**Decision**: The builder already starts a new quiz with it: `newQuiz()` in the instructor portal's `quiz/quiz-form.ts` sets `revealAnswers: 'after_each_attempt'`. What this feature adds is a test that pins it, a line under the select saying why, and `.default('after_each_attempt')` on `revealAnswers` in instructor-api's `QuizSettingsSchema`, so a quiz created without the setting gets the same default. Existing quizzes are untouched.

**Rationale**: the issue lists the default as a companion change, and the code shows the portal half is already true. Pinning it stops it regressing, and the schema default makes the API agree with the portal.

**Risk to check in the task**: `QuizSettingsSchema` is also the output schema's shape. A zod default makes the input type optional and leaves the output type required, which is what's wanted, but the task must confirm that no caller builds `settings` from the input type and now sees `undefined`.

## R-13: Preview for instructors

**Decision**: The instructor's video preview (the `HlsVideo` in `attach-lesson-video-dialog.tsx`) and the new questions editor use the same cue support and question card, fed from instructor-api's `course.view`, which gains the video's `questions`, `answerKey` and `quizVersion`. Answers are graded in the browser with `gradeQuiz` and nothing is sent, like the quiz builder's "Preview as student" (`quiz-preview-dialog.tsx`).

**Rationale**: FR-007. The instructor already holds the key, and core-api's answer procedure requires an enrolment an instructor may not have.

## R-14: Local development and infrastructure

**Decision**: No infrastructure change. The two new core-api procedures run on the existing shared router Lambda with the table access it has, and the new instructor-api procedure on its router. `videoAnswerSheet` is one more entity in the one table. The analytics stream feature keeps its name, handler and queue, and its filter list is data read from `ANALYTICS_STREAM_FILTERS` by both the deployed router and the local event runner.

**Rationale**: constitution I and III are met without work: everything runs under `pnpm dev` as it stands. The e2e helpers already produce a ready three-second video locally (`THREE_SECOND_VIDEO`, ffmpeg in Docker), which is long enough for a question at 0:01 and an end check.

## R-15: Limits

**Decision**: 20 questions per video. `atSeconds` is a whole number from 0 to 86,400 (`VIDEO_POSITION_MAX_SECONDS`, the cap positions and durations already use). It is not validated against the video's duration on save: the duration is unknown while a video transcodes and changes when it is replaced. A question beyond the end of the version being played is asked with the end check (spec Edge Cases), and the editor flags it.

**Rationale**: validating against a duration that can change underneath would refuse saves for reasons the instructor can't see, and would leave no answer for a video replaced by a shorter one.
