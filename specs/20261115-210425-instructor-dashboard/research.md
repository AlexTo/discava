# Research: Instructor Dashboard and Course Analytics

Decisions that shape the plan. Each lists the alternatives rejected.

## R-1: How analytics are computed

**Decision**: Stream-maintained aggregate records in the core table, one partition per course (`ANALYTICS#<courseId>`), updated by a new events handler from the table's stream. A read is a few keyed queries on that partition.

**Why**: The issue asks for it, and the numbers drive a dashboard that every instructor opens often, while the source records change far less often than they are read. Source records are keyed by student (`itemCompletion`, `progress`, `quizAttempt` all have `pk = userId`), so any per-request answer to "how many learners completed lesson 3" needs one query per enrolled student. That is O(students) read cost on every page view.

**Alternatives**:

| Option | Verdict |
|--------|---------|
| Per-request scan or per-student fan-out | Rejected: O(students) per view, scans are banned for user requests (constitution V) |
| Recompute the whole course on each stream batch, like progress recalculation | Rejected: progress recalculation is cheap only because it reads one student's records. A course-wide recompute is O(students) per batch, and a busy course gets a batch every 5 seconds |
| Stream counters with plain `ADD` and no dedupe | Rejected: Lambda stream delivery is at least once, and a retried batch (`retryAttempts: 5`, bisect on error) would double count. The acceptance criterion says numbers match the records |
| Stream counters with exactly-once markers (chosen) | One extra small write per event, exact numbers, no scan |

## R-2: Exactly-once application of a stream record

**Decision**: Every aggregate is a sum of contributions, and each contribution is applied once.

- A **count contribution** (for example "enrolments +1", "lesson 3 completed +1") is applied in one transaction with a marker item `ANALYTICSMARK#<courseId> / EVENT#<eventID>` written with `attribute_not_exists`. If the marker exists the transaction cancels and the record is skipped, so a redelivered record changes nothing.
- A **member contribution** (a distinct learner active on a day or in a week) is applied in its own transaction: a marker `MEMBER#<period>#<userId>` put with `attribute_not_exists` plus the counter increment. If the marker exists, the learner is already counted. This cannot share the event's transaction, because a failed condition cancels the whole transaction.
- Each part is idempotent on its own, so a crash between parts is repaired by the redelivery.
- Markers carry a `ttl` attribute: event markers 7 days (the stream keeps records 24 hours), day-member markers 2 days, week-member markers 9 days. This needs DynamoDB TTL enabled on the table on that attribute (a construct change, one task).

**Alternatives**: a version or last-sequence number on each aggregate (rejected: shards deliver in parallel, so there is no total order per course); one marker for the whole batch (rejected: bisecting changes batch composition on retry).

## R-3: One definition of "what each record contributes"

**Decision**: `core-table/src/helpers/analytics.ts` holds a pure function `contributions(entity, image)` returning the count and member contributions of a source record. A stream change is `contributions(newImage) - contributions(oldImage)`, so status changes (active to completed, in progress to completed, a better best score) just move a count from one bucket to another. The rebuild function sums `contributions` over every source record of the course. The handler and the rebuild therefore cannot disagree on a definition (FR-009), and the invariant compares them (FR-010).

Contributions by source record:

| Source | Contribution |
|--------|--------------|
| `enrolment` | `enrolments` +1 on its creation UTC day; `completed` and `dropped` totals by status |
| `progress` | per lesson `inProgress` and `completed` by status |
| `itemCompletion` | member: learner active on `completedAt`'s UTC day and week |
| `quizAttempt` | per answered question `attempts` +1, and `misses` +1 when not in `correctQuestionIds`; member: learner active on `submittedAt`'s day and week |
| `quizSummary` | per quiz one student in the band of `bestScore` (moves when the best improves) |

Drop-off figures exclude dropped enrolments (FR-011): a drop moves the student's own progress contributions out, by reading that student's `progress` records for the course (one bounded keyed query, as progress recalculation does). No procedure sets `dropped` today, so this is rare (the checkout spec, #360, will); the handler and rebuild still implement it so the rule holds when one exists.

The drop moves contributions out once, so a later `progress` MODIFY for that student (still matched by the stream filters, e.g. after a recalculation caused by a curriculum edit) must add nothing. Decision: the handler reads the student's enrolment (one keyed get) for each `progress` record and skips it when the status is `dropped`; carrying the status on the `progress` record was rejected because it adds a write path and a second copy of the status to keep in step. This matches the rebuild and `analytics-matches-records`, which exclude dropped enrolments.

## R-4: Adding a third stream consumer

AWS advises at most two simultaneous readers per DynamoDB stream shard on a standard table, because they share read throughput (5 `GetRecords` per second per shard). Progress recalculation and search indexing already use both.

**Decision**: Add a third event source mapping on the core table's stream for the analytics handler, with its own filters and failure queue, and record it in Complexity Tracking. Each Lambda mapping polls a shard about once per second, so three mappings stay under the limit, and the filters keep the handler's invocations to analytics-relevant records. A task (human) checks for throttled `GetRecords` after deploying.

**Alternatives**: EventBridge Pipes fan-out or a Kinesis Data Streams destination (rejected for now: new infrastructure, a new local stand-in, and no benefit at three consumers; revisit if a fourth consumer is added); folding analytics into progress recalculation (rejected: couples failure and retry of two unrelated jobs, and progress recalculation's filters and batching are tuned to curriculum edits).

The analytics handler's own writes (aggregates, markers) are different entities and match none of its filters, and none of the progress or search filters match them, so there is no loop (FR-015).

## R-5: Where reads live

**Decision**: A new `analytics` router in instructor-api (callers must be in the `instructor` group; every procedure then checks the course's instructor record for `ctx.user.sub`, as other instructor-api course procedures do). Three procedures: `analytics.courseSummaries`, `analytics.course`, `analytics.quiz` (see [contracts](./contracts/instructor-api-analytics.md)).

**Why**: Only instructors read analytics, and instructor-api owns instructor-only procedures. core-api is for anything any authenticated user can call, so putting analytics there would need its own instructor check on a shared router.

**Dashboard cards**: the card list comes from the caller's course-instructor records (the `byInstructor` index, already used by My Courses), then one `BatchGet` of each course's summary item.

**Detail view**: the course's analytics partition (summary, lesson and quiz-question items in one range query, the requested days in a second) plus the existing curriculum collection for lesson and question names and order. Lessons and questions that are hidden, archived or deleted are dropped at read time by joining with the curriculum, which is why their counts are never removed from the aggregates (restoring brings them back with correct numbers, spec User Story 3 scenario 3).

## R-6: Hot items and item size

All writes for a course land on one partition. The summary item takes one update per enrolment, completion and attempt in the course; DynamoDB's single-item limit (1000 write units per second) is far above a course's rate. Per-lesson, per-question and per-period items spread the rest. Question statistics are one item per question, not a map on the quiz item, so the 400 KB item limit and nested-map `ADD` (which ElectroDB does not support) never matter. Daily items grow by one per course per day; the 90-day read is a `between` on the sort key.

## R-7: Local development

`pnpm dev`'s event runner gets a third batcher beside progress and search, filtered by the same `ANALYTICS_STREAM_FILTERS` the deployed mapping uses, calling the same handler. DynamoDB local supports transactions and streams. TTL is not enforced locally, which is fine: markers just stay. `reset-local-data` wipes them.

## R-8: Consistency check against lag

The invariant compares aggregates with sums over the source records. The e2e suite runs invariant checks after every test, while the stream lags by a few seconds. The analytics check therefore runs through a helper that polls until the aggregates settle (up to 30 seconds, matching SC-002) before failing. Unit tests of the check itself use hand-built snapshots and need no waiting.

## R-9: Charts

The current dashboard already uses the shared chart components (`ChartContainer`, bar charts) from `common-shadcn`. The detail view reuses them; no new chart library.

## R-10: Rebuild tooling

`rebuildCourseAnalytics(courseId)` lives in core-table `helpers/analytics.ts` and is exposed as a script target in `@discava/common-scripts` (`rebuild-analytics`), alongside `reset-local-data`. It reads enrolments by course, then each student's `progress`, `itemCompletion`, `quizAttempt` and `quizSummary` by keyed queries, so it is tooling, not a user request (constitution V). It deletes and rewrites the course's aggregate items; markers are not rewritten (they only dedupe live events, and a rebuild is not run while events for the course are in flight).
