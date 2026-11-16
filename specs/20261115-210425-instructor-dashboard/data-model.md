# Data Model: Instructor Dashboard and Course Analytics

All new records are ElectroDB entities in the one core table (constitution V). Each lives in `packages/databases/core-table/src/entities/`, one file per entity, and is registered in `service.ts`.

## Entities

All aggregate entities share `pk = ANALYTICS#<courseId>` and differ in sort key, so one range query reads a kind. Counter attributes are numbers updated only with `add`, never `set`, by the analytics handler and the rebuild function.

| Entity | `sk` | Attributes |
|--------|------|------------|
| `courseStats` | `SUMMARY` | `courseId`, `enrolments`, `completed`, `dropped`, `updatedAt` |
| `periodStats` | `DAY#<yyyy-mm-dd>` or `WEEK#<yyyy>-W<ww>` (UTC) | `courseId`, `period` (day or week), `enrolments` (days only), `activeLearners` |
| `lessonStats` | `LESSON#<lessonId>` | `courseId`, `lessonId`, `inProgress`, `completed` (started = both) |
| `quizQuestionStats` | `QUIZ#<contentItemId>#Q#<questionId>` | `courseId`, `contentItemId`, `questionId`, `attempts`, `misses` |
| `quizScoreStats` | `QUIZ#<contentItemId>#SCORES` | `courseId`, `contentItemId`, `band0` .. `band9` (students whose best score is in 0-9, 10-19, .. 90-100) |
| `analyticsMarker` | pk `ANALYTICSMARK#<courseId>`, sk `EVENT#<eventID>`, `MEMBER#<period>#<userId>` or `FUNNEL#<userId>#<lessonId>` | `courseId`, `ttl` (epoch seconds, required on `EVENT` and `MEMBER`: 15 days, or 15 days after the period's end; none on `FUNNEL`), `status` (`FUNNEL` only: `inProgress` or `completed`, the status counted in `lessonStats`) |

Notes:

- `quizQuestionStats` and `quizScoreStats` share the `QUIZ#<contentItemId>` prefix, so one `begins_with` read returns a quiz's questions and its scores.
- `courseStats.updatedAt` is set with each update and shown as "last updated" (FR-013). Other aggregates need none.
- `enrolments` on a day item and in `courseStats` count the same enrolments: the stream adds to both in one transaction.
- Derived on read, not stored: active enrolments (`enrolments - completed - dropped`), completion rate (`completed / (enrolments - dropped)`), started and completion share per lesson, miss rate per question.
- Counters are clamped at zero on read, so a late event never shows a negative figure (spec edge case).
- No second table and no new index: every read is a keyed query on `pk` (and `sk` prefix or range). Instructor to course listing uses the existing `byInstructor` index (constitution V: no index added).

## Access patterns

| # | Request | Key |
|---|---------|-----|
| 1 | Is this user an instructor of the course | `courseInstructor` get by `courseId` + `instructorId` (existing) |
| 2 | An instructor's courses | `courseInstructor` `byInstructor` (existing) |
| 3 | Card figures for N courses | `BatchGet` of `courseStats` `SUMMARY` per course |
| 4 | Detail: totals, lessons, quizzes | one `ANALYTICS#<courseId>` range query over `SUMMARY`, `LESSON#`, `QUIZ#` (three `begins_with` queries, run in parallel) |
| 5 | Detail: enrolments and active learners for 30 or 90 days | `periodStats` `between` `DAY#<from>` and `DAY#<to>`; this week's `WEEK#` get |
| 6 | Names and order of lessons and quiz questions | existing `curriculum` collection query (course partition) |
| 7 | Apply a stream change | transactions on the items above, plus the marker |
| 8 | Rebuild (tooling, not a user request) | enrolments by course, then per student keyed queries by `userId` + `courseId` prefix |

## Source records read, and how

| Source | Used for | Notes |
|--------|----------|-------|
| `enrolment` | enrolments, completed, dropped | INSERT and status MODIFY; `createdAt` is its UTC day |
| `progress` | lesson funnel | INSERT and status MODIFY, written only by progress recalculation |
| `itemCompletion` | active learners | INSERT; `completedAt` is the day |
| `quizAttempt` | question statistics, active learners | INSERT; immutable |
| `quizSummary` | score distribution | INSERT and `bestScore` MODIFY |
| `courseInstructor` | read authorization | unchanged |
| curriculum entities | names, order, visibility filter at read | unchanged |

## Stream filters

`ANALYTICS_STREAM_FILTERS` in `core-table/src/helpers/analytics-stream.ts` (beside `PROGRESS_STREAM_FILTERS`), the filters of the `analytics-update` entry in `STREAM_FEATURES`, which the deployed router stack and the local event runner both read:

- INSERT and MODIFY of `enrolment`, `progress`, `quizSummary`
- INSERT of `itemCompletion`, `quizAttempt`
- REMOVE of `enrolment`, `progress` (a removed course's cleanup, if any, removes contributions)

None of the aggregate or marker entities appear in the filters.

## Invariant

`analytics-matches-records` in `helpers/invariants.ts`: for every course in the snapshot, `contributions` summed over the snapshot's source records equals the stored aggregate items (ignoring markers, and treating a missing item as zeros). The snapshot type gains the aggregate records and the quiz, progress and completion records it needs. See [plan.md](./plan.md) for the impact check.
