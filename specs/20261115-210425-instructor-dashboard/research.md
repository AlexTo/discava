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
| Stream counters with plain `ADD` and no dedupe | Rejected: Lambda stream delivery is at least once, and an at-least-once delivery (a message received twice, a batch retried from the queue, or a failure-queue redrive) would double count. The acceptance criterion says numbers match the records |
| Stream counters with exactly-once markers (chosen) | One extra small write per event, exact numbers, no scan |

## R-2: Exactly-once application of a stream record

**Decision**: Every aggregate is a sum of contributions, and each contribution is applied once.

- A **count contribution** (for example "enrolments +1", "lesson 3 completed +1") is applied in one transaction with a marker item `ANALYTICSMARK#<courseId> / EVENT#<eventID>` written with `attribute_not_exists`. If the marker exists the transaction cancels and the record is skipped, so a redelivered record changes nothing.
- A **member contribution** (a distinct learner active on a day or in a week) is applied in its own transaction: a marker `MEMBER#<period>#<userId>` put with `attribute_not_exists` plus the counter increment. If the marker exists, the learner is already counted. This cannot share the event's transaction, because a failed condition cancels the whole transaction.
- Each part is idempotent on its own, so a crash between parts is repaired by the redelivery.
- Markers carry a `ttl` attribute, and a marker must outlive the longest time a record can still be delivered, or a late redelivery would count again. A message can sit in the feature's failure queue for 14 days before a redrive (router spec, data model), and that retention counts from when the message was first sent. So: event markers 15 days from the write; member markers 15 days after the end of their period (a day marker lives 15 to 16 days, a week marker 15 to 22). The earlier 7, 2 and 9 days assumed the stream's 24-hour retention, which no longer bounds delivery. This needs DynamoDB TTL enabled on the table on that attribute (a construct change, one task).
- A message redriven after its markers are gone is the one case this cannot absorb. The operations note says a redrive is for messages in the failure queue less than 14 days old, and the rebuild (below) repairs any course whose figures are in doubt.

**Alternatives**: a version or last-sequence number on each aggregate (rejected: the router's queues keep no order, even for one item, so there is no total order to compare against); one marker for the whole batch (rejected: a retried or redriven batch can be composed differently).

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

Drop-off figures exclude dropped enrolments (FR-011). No procedure sets `dropped` today, so a drop is rare (the checkout spec, #360, will add one); the handler and rebuild still implement it so the rule holds when one exists.

### Reordering and the lesson funnel

Counts built from `contributions(new) - contributions(old)` add up to the same total in any order, provided each delta is applied exactly once (markers). That holds for enrolments, completions, attempts and best-score bands. It does **not** hold for the lesson funnel once drops exist, because two rules read current state while the deltas are still in flight:

- A drop moves a student's lesson contributions out by reading their `progress` records now.
- A `progress` record for a student whose enrolment is `dropped` is skipped.

Failure scenario: a lesson is started then completed (`progress` deltas d1: +1 `inProgress`, d2: -1 `inProgress`, +1 `completed`). The student is dropped after d1 is applied but before d2 is handled. The drop reads the *current* `progress` record (completed) and removes `completed` +1 that was never added, d2 is then skipped, and `inProgress` is left at +1: the lesson shows a learner who no longer exists. Under the stream's per-item order this was unlikely; under the router's no-order delivery it is expected sometimes.

**Decision**: the lesson funnel does not apply deltas of record images. For each `(student, lesson)` there is a funnel marker `FUNNEL#<userId>#<lessonId>` (an `analyticsMarker` with a `status` and no `ttl`) holding the status currently counted in `lessonStats` (`inProgress`, `completed` or none). On a `progress` record the handler reads the current `progress` record and the current enrolment (two keyed gets), works out the status that should be counted (none when the enrolment is `dropped` or the lesson is `not_started`), and moves the counters from the marker's status to that one in a transaction conditioned on the marker's current value, retrying on a conflict. A drop runs the same step for each of the student's `progress` records with the target "none". Because the target comes from current data and the move is from what was actually counted, any order, any repeat and any redrive converge on the rebuild's result, and the skip rule and the drop's read no longer disagree. The cost is one small marker item per student per lesson, and two keyed reads per `progress` record. The rebuild writes the funnel markers it implies and the invariant ignores them. The alternative of carrying the status on `progress` stays rejected (a write path and a second copy of the status).

## R-4: A router feature, not a third stream consumer

AWS advises at most two simultaneous readers per DynamoDB stream shard, and progress recalculation and search indexing already use both. The stream event router spec (`specs/20261116-183449-stream-event-router`) makes one router Lambda the only stream consumer and gives each feature an SQS queue, failure queue and alarm.

**Decision**: analytics is a `STREAM_FEATURES` registration (`analytics-update`: `ANALYTICS_STREAM_FILTERS`, handler `analytics-update`, batch 100 / 5 s, `maxReceiveCount` 5) in `core-table/src/helpers/stream-features.ts`. It adds no mapping, no failure queue of its own and no entry in Complexity Tracking; the router stack builds its queue, failure queue and alarm. The handler reads its records through the router's `sqs-stream-records.ts`.

**What the router changes for this design**: delivery is at least once and in no fixed order (even for one item), a failing batch is retried whole after the visibility timeout and moves to the failure queue after five receives (SQS cannot bisect), and a redrive replays it. Markers cover duplicates, deltas cover order for counts, the funnel markers cover order for the lesson funnel (R-3), and the marker lifetimes cover redrives (R-2).

**Alternatives**: EventBridge Pipes or a Kinesis destination (rejected by the router spec); folding analytics into progress recalculation (rejected: couples failure and retry of two unrelated jobs).

The analytics handler's own writes (aggregates, markers) are different entities and match none of its filters, and none of the progress or search filters match them, so there is no loop (FR-015).

## R-5: Where reads live

**Decision**: A new `analytics` router in instructor-api (callers must be in the `instructor` group; every procedure then checks the course's instructor record for `ctx.user.sub`, as other instructor-api course procedures do). Three procedures: `analytics.courseSummaries`, `analytics.course`, `analytics.quiz` (see [contracts](./contracts/instructor-api-analytics.md)).

**Why**: Only instructors read analytics, and instructor-api owns instructor-only procedures. core-api is for anything any authenticated user can call, so putting analytics there would need its own instructor check on a shared router.

**Dashboard cards**: the card list comes from the caller's course-instructor records (the `byInstructor` index, already used by My Courses), then one `BatchGet` of each course's summary item.

**Detail view**: the course's analytics partition (summary, lesson and quiz-question items in one range query, the requested days in a second) plus the existing curriculum collection for lesson and question names and order. Lessons and questions that are hidden, archived or deleted are dropped at read time by joining with the curriculum, which is why their counts are never removed from the aggregates (restoring brings them back with correct numbers, spec User Story 3 scenario 3).

## R-6: Hot items and item size

All writes for a course land on one partition. The summary item takes one update per enrolment, completion and attempt in the course; DynamoDB's single-item limit (1000 write units per second) is far above a course's rate. Per-lesson, per-question and per-period items spread the rest. Question statistics are one item per question, not a map on the quiz item, so the 400 KB item limit and nested-map `ADD` (which ElectroDB does not support) never matter. Daily items grow by one per course per day; the 90-day read is a `between` on the sort key.

## R-7: Local development

`pnpm dev`'s event runner needs no code of its own for this feature: its router and feature runner read the same `analytics-update` registration and call the same handler from the feature's local queue (ElasticMQ, as in the router spec). DynamoDB local supports transactions and streams. TTL is not enforced locally, which is fine: markers just stay. `reset-local-data` wipes them.

## R-8: Consistency check against lag

The invariant compares aggregates with sums over the source records. The e2e suite runs invariant checks after every test, while the stream, router and queue lag by a few seconds (the router adds its own batching window and a queue hop, a few seconds in total). The analytics check therefore runs through a helper that polls until the aggregates settle (up to 30 seconds, matching SC-002) before failing. Unit tests of the check itself use hand-built snapshots and need no waiting.

## R-9: Charts

The current dashboard already uses the shared chart components (`ChartContainer`, bar charts) from `common-shadcn`. The detail view reuses them; no new chart library.

## R-10: Rebuild tooling

`rebuildCourseAnalytics(courseId)` lives in core-table `helpers/analytics.ts` and is exposed as a script target in `@discava/common-scripts` (`rebuild-analytics`), alongside `reset-local-data`. It reads enrolments by course, then each student's `progress`, `itemCompletion`, `quizAttempt` and `quizSummary` by keyed queries, so it is tooling, not a user request (constitution V). It deletes and rewrites the course's aggregate items; markers are not rewritten (they only dedupe live events, and a rebuild is not run while events for the course are in flight).
