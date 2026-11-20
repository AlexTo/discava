# Data Model: Start in Lesson One After Enrolling

No new entity, no new index and no new record. Four existing entities in the core table gain attributes. Landing after enrolling (User Story 1) stores nothing.

## Changed entities

### `course` (`entities/course.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `firstLessonPrompt` | string, optional | The instructor's own prompt text: plain text, 1 to 200 characters after trimming. Absent means the course uses `DEFAULT_FIRST_LESSON_PROMPT`. Written only by instructor-api's `course.setFirstLessonPrompt`, which removes it when cleared |

### `enrolment` (`entities/enrolment.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `firstLessonPromptState` | `answered` or `dismissed`, optional | What the learner did with the first-lesson prompt. Absent while it is still open. Set once and never changed or removed. Written only by the helpers in `helpers/first-lesson-prompt.ts` |

`lastActivityAt` (existing) is read in a new way: an enrolment that has it is activated. Nothing about how it is written changes.

### `discussionPost` (`entities/discussion-post.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `promptAnswer` | boolean, optional, read-only | `true` on a question that answers the first-lesson prompt. Never set on a reply, and never `false` (absent otherwise). Such a question never carries `unanswered` or `unansweredSince` |

Its `title` is made by `promptAnswerTitle(body)`: the body's first line, trimmed, cut to 120 characters with a trailing "…" when longer.

### `courseStats` and `periodStats` (`entities/course-stats.ts`, `period-stats.ts`)

| Entity | Counter | Counts |
|--------|---------|--------|
| `courseStats` | `activated` | Enrolments with `lastActivityAt` |
| `courseStats` | `promptAnswered` | Enrolments with `firstLessonPromptState = answered` |
| `courseStats` | `promptDismissed` | Enrolments with `firstLessonPromptState = dismissed` |
| `periodStats` (days) | `activated` | Enrolments created that UTC day that have `lastActivityAt` |

All default to 0 and change only with `add`, like the existing counters. Derived on read, not stored: the activation share (`activated / enrolments`, null when `enrolments` is 0), all-time and summed over a range of days.

## Contributions (`helpers/analytics-contributions.ts`)

`contributions('enrolment', image)` adds, beside what it returns today:

| When the image has | Delta |
|--------------------|-------|
| `lastActivityAt` (a non-empty string) | `SUMMARY.activated + 1`, and `DAY#<createdAt day>.activated + 1` |
| `firstLessonPromptState = answered` | `SUMMARY.promptAnswered + 1` |
| `firstLessonPromptState = dismissed` | `SUMMARY.promptDismissed + 1` |

Ended (`dropped`) enrolments contribute these like any other. Because the stream handler applies the difference between a change's two images, the first activity adds one, later activities add nothing, and a removed enrolment takes its counts back. No funnel task, member or marker kind is added.

## Rules and where they live

`helpers/first-lesson-prompt.ts` (new, exported from the package index):

| Export | What it is |
|--------|------------|
| `DEFAULT_FIRST_LESSON_PROMPT` | "What do you want to be able to do with what this course teaches? Tell the class in a sentence or two." |
| `FIRST_LESSON_PROMPT_MAX` | 200 |
| `normaliseFirstLessonPrompt(text)` | Trims and collapses the text like discussion text; says `empty` or `too-long` |
| `resolveFirstLessonPrompt(course)` | The course's text, else the default |
| `promptAnswerTitle(body)` | The title of an answer's post |
| `firstLessonPromptStateWrites(entities, { courseId, userId, state })` | One transaction item: `enrolment.patch` setting the state, on the condition that the enrolment exists, is not `dropped`, and has no state yet |
| `dismissFirstLessonPrompt(coreTable, { courseId, userId })` | Runs that write with `dismissed`. A failed condition is read again: a state already set is success, an ended or missing enrolment is refused |

`helpers/discussion.ts`: `discussionWrites` gains the operation `answerPrompt`:

| Operation | Items |
|-----------|-------|
| `answerPrompt` | the three checks every non-moderation operation has (`course` published, `module` and `lesson` shown); `post.create` (a question with `promptAnswer: true`, `title` from `promptAnswerTitle`, no `unanswered` attributes; condition: the id is new); `firstLessonPromptStateWrites(..., 'answered')` |

`helpers/discussion-text.ts`: `answeredState` takes `promptAnswer` and returns `not-a-question` for a shown prompt answer (a hidden or deleted one is still `not-open`). Every operation that recomputes `unanswered` passes the question it read, so none can put a prompt answer in the queue.

`helpers/curriculum.ts`: `firstShownLesson({ modules, lessons })` returns the first lesson of the first module, in course order, after `filterEffectivelyVisible`, or undefined. core-api uses it to check an answer's lesson.

A prompt answer is not student activity: `studentActivityWrites` is not called, so `lastActivityAt`, `studentActivityCount` and progress do not move (FR-017).

## Invariants (`helpers/invariants/`)

| Invariant | File | Rule |
|-----------|------|------|
| `first-lesson-prompt-matches-answers` (new) | `discussion.ts` | Every post with `promptAnswer` is a question whose author has an enrolment in that course with `firstLessonPromptState = answered`; an author has at most one such post per course; and every enrolment with `answered` has exactly one such post by that learner in that course (in any state: a hidden or deleted answer still counts) |
| `discussion-post-shape` (extended) | `discussion.ts` | `promptAnswer`, when present, is `true` and on a question |
| `discussion-unanswered-matches` (extended through `answeredState`) | `discussion.ts` | A prompt answer never has `unanswered` |
| `analytics-matches-records` (covers the new counters through `contributions`) | `analytics.ts` | Stored `activated`, `promptAnswered` and `promptDismissed` equal the sum over the snapshot's enrolments |

Each new or extended rule ships with a test that breaks it. `TableSnapshot` already loads enrolments, discussion posts and the aggregates, so `snapshot.ts` needs no new entity.

Existing checks on the same records that must stay green, pinned by a test: `last-activity-at-current`, `student-records-enrolled`, `enrolment-in-published-course`, `discussion-counts-match`, and the paid-enrolment checks in `payments.ts`.

## Access patterns

| # | Request | Key |
|---|---------|-----|
| 1 | Show or hide the prompt on a lesson page | `enrolment` get by `courseId` + `userId` (existing `course.myEnrolment`) and the course's curriculum (existing `course.view`). No new read |
| 2 | Answer the prompt | The reads `discussion.ask` makes (course, module, lesson, enrolment, instructor record, post by id), one `curriculum` collection query on the course partition for the first shown lesson, then one transaction |
| 3 | Dismiss the prompt | One conditional `enrolment` patch by key |
| 4 | Set a course's prompt text | One `course` patch by key, after the existing instructor check |
| 5 | Activation and prompt figures | The `courseStats` and `periodStats` items the analytics page already reads (dashboard spec, patterns 3 to 5) |
| 6 | Apply an enrolment change to the figures | The transaction the analytics handler already runs for an enrolment change |

No scan, and no index is added or changed.

## Stream consumers

`ANALYTICS_STREAM_FILTERS` already match every enrolment `INSERT`, `MODIFY` and `REMOVE`; nothing is added. No registered feature matches `course` or `discussionPost` on the new attributes: search indexing reads other `course` fields, and discussion notifications are written in the post's transaction, not from the stream. `STREAM_FEATURES` is unchanged.

## Existing data

`activated` is a new counter over records that already exist. The stream only counts changes, so an enrolment that was active before the change is counted when its course's figures are rebuilt (`pnpm nx run @discava/tooling-deploy:rebuild-analytics -- <courseId> ...`), not before. Until then `analytics-matches-records` reports those courses. Fresh data (PR CI) is unaffected. Rebuilding existing local and deployed courses is a **(human)** task. Nothing else needs fixing by hand: the other new attributes are optional by meaning.
