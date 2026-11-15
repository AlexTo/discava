# Feature Specification: Instructor Dashboard and Course Analytics

**Feature Branch**: `20261115-210425-instructor-dashboard`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Instructor dashboard and course analytics (issue #278): enrolments over time, active learners, completion rate, per-lesson drop-off, quiz item analysis, course summary cards on the dashboard and a detail view per course, with aggregates maintained from the core-table stream, not computed per request."

**Parent issue**: #278

## Clarifications

### Session 2026-11-15

- Q: What counts as an "active learner"? → A: An enrolled student who did something in the course: completed an item (which includes submitting an assignment) or submitted a quiz attempt. Signing in or opening a page does not count (it is not recorded today). The dashboard card shows learners active in the current calendar week (Monday to Sunday, UTC); the detail view also shows distinct active learners per day.
- Q: Which time zone and range for "over time"? → A: UTC days. The detail view charts the last 90 days, with 30-day and 90-day choices. All-time totals are always shown.
- Q: How is the completion rate defined? → A: Enrolments whose status is completed, divided by all enrolments that have not dropped. A course with no such enrolments shows "no data", not 0%.
- Q: What about students who drop a course? → A: They stay in "enrolments over time" (the day they enrolled) and are shown as a separate "dropped" count, but leave the active, completion and drop-off figures.
- Q: What does per-lesson drop-off show? → A: For each lesson currently shown to students, in course order: how many learners started it and how many completed it, with the completion share of those who started. Hidden or archived lessons, and lessons of hidden or archived modules, are left out.
- Q: Which scores feed the score distribution, and which attempts feed the most-missed list? → A: The distribution uses each student's best score per quiz, in ten-point bands (0-9, 10-19, ... 90-100), so a student counts once. Question statistics use every attempt. A question needs at least 5 attempts before it can appear in the most-missed ranking, so a single bad attempt does not rank first.
- Q: Who can see a course's analytics? → A: Any instructor of that course (the course's instructor records), including co-instructors, and nobody else. Instructors also see them after the course is archived. An instructor never sees another instructor's course.
- Q: How fresh must numbers be? → A: A few seconds behind the records, like course progress. The page shows when the figures were last updated.
- Q: Are individual students identified? → A: No. Every figure is an aggregate. Per-student views are out of scope.
- Q: Does the data need to be filled in for courses that already exist? → A: Aggregates can be rebuilt from the records for any course by a tool (used by tests and for development data). No migration or fallback for old data is added (Discava has not launched).
- Q: Does the quiz analysis keep working when an instructor edits a quiz? → A: Statistics are kept per question. Questions that no longer exist are not shown. A question that was edited keeps its history, as the stored attempts were graded against the quiz as it was.

- Q: What does "started" a lesson mean? → A: The student's progress for the lesson is in progress or completed (they completed at least one of its items). "Completed" means the lesson's progress is completed.
- Q: Do figures include students who enrolled before this feature shipped? → A: Yes once rebuilt; the rebuild reads the records, so the numbers do not depend on when the student enrolled.
- Q: Are the summary cards limited to published courses? → A: No. Draft and archived courses get cards too (draft courses show zeros), so an instructor sees everything they teach in one place.
- Q: Is the 5-attempt threshold for ranking configurable? → A: No, it is a fixed constant in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See how my courses are doing at a glance (Priority: P1)

An instructor opens the instructor portal's dashboard and sees one summary card per course they teach: total enrolments, learners active this week, and completion rate. The placeholder figures are gone. Opening a card goes to that course's detail view.

**Why this priority**: The dashboard is empty today. Summary cards answer the instructor's first question ("is anyone using my course?") and need the aggregate foundation every other story builds on.

**Independent Test**: Enrol several students in a course, complete items for some of them, and check that the card's enrolment count, weekly active learners and completion rate equal the figures counted from the records.

**Acceptance Scenarios**:

1. **Given** an instructor with courses, **When** they open the dashboard, **Then** each of their courses (draft, published and archived) shows a card with total enrolments, learners active this week and completion rate, and no placeholder figures remain.
2. **Given** a student who enrols, **When** a few seconds pass, **Then** the course's enrolment count (and the weekly active figure, once they do something) is updated on the next load.
3. **Given** a course nobody has enrolled in, **When** the instructor views its card, **Then** it shows zero enrolments and "no data" for completion rate.
4. **Given** a student who completes every shown item, **When** progress is recalculated, **Then** the completion rate rises accordingly.
5. **Given** a student who drops the course, **When** the figures update, **Then** they leave the active and completion figures but still count in the enrolment history and the dropped count.
6. **Given** an instructor with no courses, **When** they open the dashboard, **Then** they see an invitation to create one.
7. **Given** a user who does not teach a course, **When** they ask for its analytics, **Then** the request is refused and no figure is returned.

---

### User Story 2 - Watch enrolments and activity over time (Priority: P2)

An instructor opens a course's detail view and sees enrolments per day and distinct active learners per day over the last 30 or 90 days, plus the all-time totals.

**Why this priority**: Trends show whether a launch, announcement or change worked. The cards work without it.

**Independent Test**: Create enrolments and activity on known days, open the detail view and check each day's bar against the records for that UTC day.

**Acceptance Scenarios**:

1. **Given** a course with enrolments on several days, **When** the instructor opens its detail view, **Then** a chart shows new enrolments for each of the last 90 days (zero on quiet days) and they can switch to 30 days.
2. **Given** a student who does several things in one day, **When** the figures update, **Then** they count once for that day's active learners.
3. **Given** a student active on two days, **When** the daily figures are read, **Then** they count once on each day, and once in the weekly figure if both fall in the same week.
4. **Given** a course archived by its instructor, **When** the instructor opens its detail view, **Then** the history is still shown.
5. **Given** a course that belongs to another instructor, **When** its detail view is requested, **Then** it is refused.

---

### User Story 3 - Find the lessons where learners drop off (Priority: P2)

On the detail view, an instructor sees every lesson in order with how many learners started and completed it, so they can spot where people stop.

**Why this priority**: It is the most actionable insight for improving a course, but depends on the foundation and the detail view.

**Independent Test**: Have three students progress to different points in a four-lesson course and check each lesson's started, completed and share against the progress records.

**Acceptance Scenarios**:

1. **Given** a course with several shown lessons, **When** the instructor opens the drop-off section, **Then** lessons appear in course order with started count, completed count and completion share.
2. **Given** a lesson an instructor hides or archives, **When** the figures update, **Then** it disappears from the drop-off list and the remaining figures are unchanged.
3. **Given** a lesson restored later, **When** the figures update, **Then** it returns with counts matching the records.
4. **Given** a lesson nobody has started, **When** it is listed, **Then** it shows zero started and "no data" for the share.
5. **Given** a student who drops the course, **When** the figures update, **Then** their lesson progress is no longer counted.

---

### User Story 4 - See which quiz questions learners miss (Priority: P3)

For each quiz in the course, the instructor sees a ranking of the most-missed questions and a distribution of students' best scores.

**Why this priority**: Valuable for improving assessments, but only relevant to courses with quizzes.

**Independent Test**: Submit known attempts to a quiz and check the miss rate of each question and each score band against the stored attempts.

**Acceptance Scenarios**:

1. **Given** a quiz with attempts, **When** the instructor opens its analysis, **Then** questions are ranked by share of attempts that missed them, with attempts and misses shown.
2. **Given** a question with fewer than 5 attempts, **When** the ranking is shown, **Then** it is listed as "not enough attempts" and is not ranked.
3. **Given** a student who retakes a quiz and improves, **When** the figures update, **Then** the score distribution moves them to their new band once, and the question figures include both attempts.
4. **Given** a question an instructor has deleted from the quiz, **When** the analysis is shown, **Then** it is not listed.
5. **Given** a quiz nobody has attempted, **When** its analysis is opened, **Then** it shows an empty state.

---

### Edge Cases

- A course with thousands of students: reading analytics costs the same as for a course with one, as every figure is already summed.
- The same stream record delivered twice, or a batch retried: each event affects the figures exactly once.
- Records arrive out of order (a quiz attempt before the enrolment's progress is recalculated): the figures settle to the same result once all records have been processed.
- A lesson, module or quiz is removed after students used it: its figures disappear from the views; totals that do not depend on it stay.
- An instructor is removed from a course: they stop being able to read its analytics immediately; their other courses are unaffected.
- Progress recalculation changes statuses after a curriculum edit (items hidden): drop-off, completion and active figures follow the new statuses.
- The course has been archived or unpublished: analytics stay readable by its instructors.
- Day boundaries: an event at 23:59:59 UTC counts for that day, one at 00:00:00 for the next.
- Figures never go negative or above 100% even when events are processed late.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The instructor dashboard MUST show one summary card per course the instructor teaches, with total enrolments, learners active this week and completion rate, replacing the placeholder figures and the placeholder disclaimer.
- **FR-002**: Each card MUST link to the course's detail view.
- **FR-003**: The detail view MUST show enrolments per UTC day and distinct active learners per UTC day for the last 30 or 90 days (default 90), with all-time totals, including a dropped count.
- **FR-004**: The detail view MUST show per-lesson drop-off (started, completed, share) for lessons currently shown to students, in course order.
- **FR-005**: The detail view MUST show, for each quiz, the most-missed questions (ranked by miss rate, with attempts and misses; only questions with at least 5 attempts are ranked) and the distribution of each student's best score in ten-point bands.
- **FR-006**: Only instructors of a course MUST be able to read its analytics. Every analytics read MUST check the caller against the course's instructor records, and MUST return nothing to anyone else, including other instructors and students.
- **FR-007**: Analytics MUST NOT be computed by scanning students' records per request. They MUST be read from aggregates maintained as the underlying records change, so a read costs a small, fixed number of keyed lookups regardless of enrolment size.
- **FR-008**: The aggregates MUST be updated from the core table's change stream by a handler that is safe against duplicate and retried deliveries: each source change affects each figure exactly once.
- **FR-009**: Each aggregate's definition (what it counts and from which records) MUST be written once, in shared code that both the stream handler and a rebuild function use.
- **FR-010**: A rebuild function MUST be able to recompute a course's aggregates from the underlying records alone. The numbers produced by the stream MUST equal the rebuilt numbers; a consistency check in the repository's invariant checks MUST fail when they differ, and a test MUST break it.
- **FR-011**: The active, completion and drop-off figures MUST exclude dropped enrolments; enrolments over time MUST keep them, and quiz statistics keep dropped students' attempts.
- **FR-012**: Figures MUST follow progress recalculation: when visibility changes alter students' statuses, the dashboard figures follow without separate action.
- **FR-013**: The views MUST show when the figures were last updated and MUST show empty states ("no data", zero) rather than errors or 0% for missing denominators.
- **FR-014**: No figure MAY identify an individual student.
- **FR-015**: The aggregates' own writes MUST NOT trigger the handlers that produce them (no feedback loop), and MUST NOT disturb existing stream consumers (progress recalculation, search indexing).
- **FR-016**: The feature MUST work end to end in local development without an AWS account, including the stream handler.
- **FR-017**: The records the analytics read (enrolments, item completions, lesson progress, quiz attempts and summaries) MUST keep being written only through the shared helpers their writers already use; this feature adds no second way to write them.
- **FR-018**: Per-student analytics, exports, email reports, comparisons across courses and historical backfill for courses that predate the feature are out of scope.

### Key Entities

- **Course analytics summary**: One per course. Totals of enrolments, dropped, active, completed, and the time the figures were last updated.
- **Daily course activity**: One per course per UTC day. New enrolments, and distinct learners active that day.
- **Lesson funnel entry**: One per course per lesson. Learners who started and completed it.
- **Quiz analytics**: One per quiz. Per question attempts and misses; counts of students per best-score band.
- **Instructor of a course**: Existing record linking an instructor to a course; decides who can read analytics.
- **Source records (existing)**: Enrolments, item completions, lesson progress, quiz attempts and quiz summaries. The aggregates are derived from them and never replace them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every course in the test data, each dashboard figure equals the figure counted directly from the records, in 100% of consistency checks run after every end-to-end test.
- **SC-002**: A change (an enrolment, a completion, a quiz attempt) appears in the figures within 30 seconds in 95% of cases.
- **SC-003**: The dashboard for an instructor with 20 courses loads its figures in under 2 seconds, and the detail view of a course in under 2 seconds, however many students are enrolled.
- **SC-004**: 0 cases where a non-instructor of a course, including another instructor, can read any of its analytics.
- **SC-005**: Replaying any stream batch twice leaves the figures identical in 100% of tests.
- **SC-006**: An instructor can find the lesson with the lowest completion share in a course within 30 seconds, in a usability check with at least 5 of 5 testers.
- **SC-007**: No placeholder or illustrative figures remain in the instructor portal.

## Assumptions

- The dashboard route and its placeholder page exist (instructor portal); this feature replaces its content.
- Course progress recalculation already maintains lesson progress and enrolment status and progress; analytics read its results from the records it writes and do not recompute progress.
- "Activity" means the course activity the system records today (item completions, quiz attempts); page views and sign-ins are not tracked and are out of scope.
- Enrolment, completion and attempt records are never moved to another course or student.
- Analytics are eventually consistent by a few seconds, as progress already is.
- Dev data is fixed by hand or rebuilt with the rebuild function; no backward-compatible handling of data written before this feature.
- Charts reuse the shared chart components already used by the dashboard.
- Issue #278 stays linked from the PRs; only the PR that merges the last phase may close it.
