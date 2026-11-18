# Contract: core-api `review` router

All run on the shared router Lambda. `summary` and `list` are built on `publicCourseProcedure` and MUST be added to `PUBLIC_OPERATIONS` (`packages/apis/core-api/src/router.ts`) so API Gateway skips its authorizer; `router.test.ts` checks the list. `mine`, `post`, `edit` and `delete` are `courseProcedure`s; the student is always `ctx.user.sub`, never an input.

Shared output shapes:

```text
PublicReview = { reviewerName, rating, text?, createdAt, editedAt?, response?: { text, byName, at } }
Summary      = { count, average?, stars: { 1: n, 2: n, 3: n, 4: n, 5: n } }   // average to one decimal, absent when count = 0
OwnReview    = { rating, text?, createdAt, editedAt?, version, status, removedReason?, response? }
```

`PublicReview` never contains `userId`, `version`, `status` or any removal field.

## `review.summary` (query, public)

Input `{ courseId }`. Output `Summary`. A course with no `courseRating` record returns `count: 0`. A draft course has no enrolments and so no reviews, which means the answer reveals nothing about drafts.

## `review.list` (query, public)

Input `{ courseId, cursor?, limit? }` (`limit` at most 20, default 10). Output `{ items: PublicReview[], cursor }`, newest first.

- Queries `byCourse` descending and keeps `status = visible`; continues until the page has `limit` items or the index ends. The cursor is ElectroDB's.
- A draft course returns an empty page.

## `review.mine` (query)

Input `{ courseId }`. Output `OwnReview | null`. A removed review is returned with `status: 'removed'` and `removedReason`, so the portal can show the notice and hide the form.

## `review.post` (mutation)

Input `{ courseId, rating, text? }`: `rating` an integer 1 to 5; `text` trimmed, at most 2,000 characters, whitespace-only stored as absent. Output `OwnReview`.

- One `reviewWrites` Post transaction (data-model.md). The reviewer name comes from the `user` record at this moment.
- Errors: `BAD_REQUEST` (input), `FORBIDDEN` ("Enrol in the course to review it": not enrolled or dropped), `PRECONDITION_FAILED` ("This course is not open for new reviews"), `CONFLICT` ("You already reviewed this course", also for a removed review: "Your review of this course was removed").
- Two concurrent posts: one returns the review, the other `CONFLICT`, and `stars<rating>` rose once.

## `review.edit` (mutation)

Input `{ courseId, rating, text?, version }`. Output `OwnReview` (new `version`, `editedAt` set).

- Edit Post conditions per data-model.md. `NOT_FOUND` if the caller has no review; `CONFLICT` ("Your review changed; reload it") on a stale `version`; `FORBIDDEN` ("This review was removed") for a removed review.
- Allowed whatever the course's or the enrolment's status.

## `review.delete` (mutation)

Input `{ courseId, version }`. Output `{ deleted: true }`. Deletes the record and decrements the counter. `NOT_FOUND`, `CONFLICT` (stale) and `FORBIDDEN` (removed) as for edit. After a delete the student may post again.

## Course list and card output

`course.publicList` items gain `ratingAverage?` and `ratingCount` (see [search-and-catalogue.md](./search-and-catalogue.md)).
