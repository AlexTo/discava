# Data Model: Course Ratings and Written Reviews

Two new entities, in `packages/databases/core-table/src/entities/`, registered in `entities/index.ts` and `service.ts`. Neither is part of the `curriculum` collection (as `enrolment` is not). No new index.

## `review` (new, `entities/review.ts`)

One per student per course. Primary key: pk `courseId`, sk `userId`.

| Attribute | Type | Notes |
|-----------|------|-------|
| `courseId` | string, required | |
| `userId` | string, required | the student (Cognito `sub`); never returned by public procedures |
| `rating` | number, required | integer 1 to 5; changed by edits |
| `text` | string | at most 2,000 characters after trimming; absent for a rating-only review |
| `reviewerName` | string, required, read-only | "Alex T." or "Discava learner", snapshot at posting |
| `status` | `visible` or `removed`, required, default `visible` | |
| `version` | number, required, default 1 | +1 on every edit by the student |
| `createdAt` | ISO string, required, read-only | |
| `editedAt` | ISO string | set by every edit |
| `removedAt`, `removedBy`, `removedReason` | ISO string, string, string (at most 200) | set together and only with `status = removed` |
| `responseText` | string | 1 to 1,000 characters |
| `responseAt`, `responseById`, `responseByName` | ISO string, string, string | set and cleared together with `responseText` |
| `updatedAt` | as other entities | |

**Indexes**:

| Pattern | Key | Used by |
|---------|-----|---------|
| One student's review of a course (post, edit, delete, `mine`) | primary: pk `courseId`, sk `userId` | core-api `review.mine`, `post`, `edit`, `delete`; instructor-api and admin-api actions |
| A course's reviews, newest first, paged | `byCourse` on the existing `gsi2pk-gsi2sk-index`: `gsi2pk` composite `courseId`, `gsi2sk` composite `createdAt`, `userId` | `review.list` (visible), instructor and admin lists |

## `courseRating` (new, `entities/course-rating.ts`)

One per course that has had a rating. Primary key: pk `courseId`, sk a constant (no composite attributes).

| Attribute | Type | Notes |
|-----------|------|-------|
| `courseId` | string, required | |
| `stars1` to `stars5` | number, required, default 0 | counts of visible reviews at each rating |
| `updatedAt` | as other entities | |

Derived (in `helpers/review-rating.ts`, one definition for the helper, invariant, core-api and the search document): `count = sum(stars)`, `average = sum(n x stars_n) / count` (undefined when `count = 0`), `ratingScore = (count x average + 5 x 3.5) / (count + 5)`, `ratingBoost = 1 + 0.1 x (ratingScore - 3.5)`; unrated courses have no score and boost `1`.

A course with no ratings may have no `courseRating` record; a record with all zeros is allowed (after deletes).

## Access patterns

| Request | Access |
|---------|--------|
| Course summary | Keyed get of `courseRating` |
| Course reviews page | Query `byCourse` descending, filter `status = visible`, continue until the page is full |
| Caller's own review | Keyed get of `review` |
| Cards for a catalogue page (up to 100) | Batch get of `courseRating` by course |
| Instructor check | Keyed get of `courseInstructor(courseId, instructorId)` (inside the transaction for writes) |
| Admin course picker | Query `course.byStatus` for `published` and `archived` |
| Invariants | Table scan, tooling only (existing snapshot) |

No scans in user requests.

## Writes by case (all in `reviewWrites`, the only writer of both entities)

| Case | Items in one transaction |
|------|--------------------------|
| Post | `review` create (not exists; a tombstone or an existing review cancels it); `enrolment` condition (status not `dropped`); `course` condition (status `published`); `courseRating` add `+1` to `stars<rating>` (creates the record if absent) |
| Edit | `review` patch of `rating`, `text`, `editedAt`, `version + 1`, condition `version = <read>` and `status = visible`; if the rating changed, `courseRating` add `-1` to the old counter (condition counter >= 1) and `+1` to the new |
| Delete | `review` delete (condition `version = <read>`, `status = visible`); `courseRating` add `-1` to `stars<rating>` (condition >= 1) |
| Remove (admin) | `review` patch `status = removed`, `removedAt`, `removedBy`, `removedReason`, condition `version = <read>` and `status = visible`; `courseRating` add `-1` (condition >= 1) |
| Respond | `review` patch of the four response attributes, condition `status = visible`; `courseInstructor` condition (exists) |
| Delete response | `review` patch removing the four attributes, same conditions |
| Notify (US5, optional) | the `notificationWrites` items for each instructor, added to the Post transaction |

A cancelled transaction is classified by the cancellation reason: create condition (already reviewed or removed: `CONFLICT`), enrolment (not enrolled or dropped: `FORBIDDEN`), course (not open: `PRECONDITION_FAILED`), version (stale: `CONFLICT`). The caller re-reads and may retry, as other procedures do (`lib/transaction.ts`).

## State transitions

`visible` (created) -> `removed` (admin, final) or deleted (student, record gone). No other transitions; a removed review cannot be edited, deleted by the student or answered.

## Invariants (`helpers/invariants.ts`, snapshot gains `reviews` and `courseRatings`)

- `review-shape`: rating an integer 1 to 5; status valid; `version >= 1`; text, response and removal fields within their limits; `removedAt`, `removedBy` and `removedReason` all present when removed and all absent when visible; response fields present together or absent together; `reviewerName` present.
- `review-has-enrolment`: each review has an enrolment for its student and course (any status; dropping keeps the record) and a course record.
- `course-rating-matches-reviews`: for every course, each `stars<n>` equals the number of `visible` reviews with rating `n` (a missing `courseRating` means zero of each), and every `courseRating` has a course record.

Each ships with a test that breaks it. Not violations: a review in an archived course; a review whose student has dropped; a `courseRating` with all zeros; a removed review with a response. Existing invariants unaffected (pinned by a test): `activity-count-matches-students` and the `student-records-*` checks do not include reviews; `instructor-course-updated-at` is unchanged by a review write.
