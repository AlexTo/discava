# Data Model: Questions Inside and Straight After Videos

One new entity (`videoAnswerSheet`), three existing `contentItem` attributes used by a second item type, and one more source for an existing aggregate. No new table, no new index.

## Changed: `contentItem` of `type: 'video'`

The entity definition doesn't change: these attributes exist and are untyped (`type: 'any'` or `number`). What changes is that a video may now hold them. Shapes are enforced by instructor-api's zod schemas (research R-1).

| Attribute | On a video | Rules |
|---|---|---|
| `questions` | `[{ questionId, kind, prompt, options: [{ optionId, text }], atSeconds, contentHash }]` | 0 to 20. `kind`, `prompt` and `options` follow `QuizQuestionSchema`. `atSeconds` is a whole number from 0 to 86,400, or `null` for an end question. `contentHash` is set by the server on save (R-4). Absent or empty means the video has no questions |
| `answerKey` | `{ [questionId]: { correctOptionIds, explanation? } }` | As a quiz's: one entry per question and none for others, checked by `refineQuizDefinition`. Never sent to a student except for a question they've answered |
| `quizVersion` | Number | Absent until the first save, which sets 1. Incremented by every save of the questions. A save names the version it loaded (0 when absent) |
| `settings`, `questionsHash` | Not used | A video has no pass mark, attempt limit or reveal setting |

Order: learners meet timed questions by `atSeconds`, then by position in the array for equal moments, then the end questions in array order. The editor keeps the array in that order.

`studentActivityCount` on a video now counts distinct students with an `itemCompletion` **or** a `videoAnswerSheet` for it (R-5).

## New: `videoAnswerSheet`

One learner's recorded answers to one video's questions. File `packages/databases/core-table/src/entities/video-answer-sheet.ts`, registered in `service.ts` and exported from `entities/index.ts`.

| Attribute | Type | Notes |
|---|---|---|
| `userId` | string, required | pk |
| `courseId` | string, required | sk, first part |
| `contentItemId` | string, required | sk, second part |
| `moduleId`, `lessonId` | string, required | Not in the key. Copied from the item, as `quizSummary` does, so the record can be placed without a scan |
| `answers` | map, required | `{ [questionId]: { optionIds: string[], correct: boolean, answeredAt: string, quizVersion: number } }`. An entry is added once and never changed or removed |
| `answerCount` | number, required | The number of entries in `answers`. Every write is conditioned on the value it read |
| `createdAt`, `updatedAt` | string | As other entities |

Keys: pk `userId`, sk `courseId / contentItemId`, the same composite as `quizSummary`. No index.

Lifecycle:

```text
(none) ── first answer on the video ──▶ sheet with 1 entry
sheet with n entries ── first answer to another question ──▶ n + 1 entries
```

It is never deleted, and an entry never changes: not when the question is edited, moved or removed, and not when the learner tries again or drops the course.

Written only by core-table's `videoAnswerWrites` (`helpers/video-question.ts`), called by core-api's `videoQuestion.answer`.

## Unchanged shape, new source: `quizQuestionStats`

`ANALYTICS#<courseId>` / `QUIZ#<contentItemId>#Q#<questionId>`, with `attempts` and `misses`. For a video question, `attempts` is the number of sheets with an entry for it and `misses` the number of those entries with `correct: false` (R-7).

## Access patterns

| # | Pattern | Served by |
|---|---|---|
| VQ1 | A video's questions and key, for its instructors | The curriculum collection query instructor-api's `course.view` already makes; one get in `contentItem.updateVideoQuestions` |
| VQ2 | A video's questions for a learner, and how many it has | The `contentItem` get that `contentItem.videoUrl` and `videoQuestion.view` make |
| VQ3 | A learner's answers on one video | `videoAnswerSheet.get({ userId, courseId, contentItemId })` |
| VQ4 | Record an answer | One transaction: `studentActivityWrites` items, the sheet's create or patch, and the first-record check (below) |
| VQ5 | Whether a learner already has a record on a video, when marking it done | `videoAnswerSheet.get` beside the reads `contentItem.complete` already makes |
| VQ6 | A course's videos with questions, and one video's per-question figures | `loadCourse` in `analytics-reads.ts`: the `analytics` collection query and the curriculum query, both existing |
| VQ7 | All sheets of a course, for the analytics rebuild | Per enrolled user, `videoAnswerSheet.query.primary({ userId }).begins({ courseId })`, as `analytics-rebuild.ts` does for `quizSummary`. Tooling, not a user request |
| VQ8 | All sheets, for the invariant snapshot | The snapshot's table scan (tests and tooling only) |

No user-facing request scans.

## The answer transaction (VQ4)

Built by `videoAnswerWrites(entities, input)`:

1. `studentActivityWrites` with `firstRecord: !sheet && !completion` and the video's `quizVersion`: the course is published, the module, lesson and video are shown, the video is still at that version, the learner is enrolled and not dropped, `lastActivityAt` moves forward, and `studentActivityCount` gains 1 when this is the learner's first record.
2. The sheet: `create` when there is none (which fails if one appeared), else `patch` setting `answers` to the read map plus the new entry and `answerCount` to `n + 1`, where `answerCount = n`.
3. When there is no sheet and no completion: a condition check that the `itemCompletion` for this learner and video still doesn't exist.

`contentItem.complete` gains the mirror of step 3 for a video: when it claims the first record, a condition check that the learner's `videoAnswerSheet` doesn't exist. Both come from `videoFirstRecordCheck` in the same helper file.

A canceled transaction is re-read and retried up to three times, as `quiz.submitAttempt` does, then `CONFLICT`.

## Invariants (constitution IV)

`videoAnswerSheets` joins `TableSnapshot` and `SNAPSHOT_ENTITIES`.

| Invariant | Change |
|---|---|
| `activity-count-matches-students` | **Extended**: a video's count is the distinct students with a completion or a sheet |
| `student-records-have-targets` | **Extended**: a sheet's content item exists |
| `student-records-enrolled` | **Extended**: a sheet's learner has an enrolment in the course |
| `student-records-placed-with-item` | **Extended**: a sheet's `moduleId` and `lessonId` are its item's |
| `last-activity-at-current` | **Extended**: no entry's `answeredAt` is later than the enrolment's `lastActivityAt` |
| `analytics-matches-records` | **Extended**: sheets' contributions are part of the expected sums |
| `video-answer-sheet-shape` | **New**: the sheet's item is a video; `answerCount` equals the number of entries; every entry has at least one option, a boolean `correct`, a valid `answeredAt` and a `quizVersion` of 1 or more that is no greater than the item's |
| `video-questions-shape` | **New** (curriculum): a video's `questions` number at most 20 with unique ids; its `answerKey` has exactly their ids; `quizVersion` is present when either attribute is; an item that is neither a quiz nor a video has none of the three |

Each new or extended check gets a test that breaks it, starting from `consistentTable()`.

## Records this feature reads or writes (impact check)

| Record | How | Existing cover | Change |
|---|---|---|---|
| `contentItem` (video) | Writes `questions`, `answerKey`, `quizVersion`; increments `studentActivityCount` | `activity-count-matches-students`, curriculum checks | Count's meaning widens; new `video-questions-shape` |
| `enrolment` | Sets `lastActivityAt` through `studentActivityWrites` | `last-activity-at-current` | Extended to sheets |
| `itemCompletion` | Read, and condition-checked, when answering; `contentItem.complete` gains a check on the sheet | `progress-matches-completions`, `completed-at-iff-completed` | No change in meaning: an answer never creates one |
| `quizQuestionStats`, `periodStats` | Written by `analytics-update` from sheets | `analytics-matches-records` | Extended |
| `quizAttempt`, `quizSummary`, `progress`, `certificate` | Not read or written | | None |
