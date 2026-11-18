# Contract: instructor-api `review` router

All procedures are on `courseProcedure` (the caller is in the `instructor` group) and additionally require the caller to be an instructor of `courseId` (a keyed get of `courseInstructor`), otherwise `FORBIDDEN`. Writes go through `reviewWrites`, which repeats the instructor check inside its transaction.

## `review.list` (query)

Input `{ courseId, cursor?, limit? }` (`limit` at most 50, default 20). Output `{ items, cursor }`, newest first, visible reviews only:

```text
items[] = { reviewerId, reviewerName, rating, text?, createdAt, editedAt?, response?: { text, byName, at } }
```

`reviewerId` is the student's ID: instructors need it to answer a review. No email.

## `review.respond` (mutation)

Input `{ courseId, reviewerId, text }`: `text` trimmed, 1 to 1,000 characters. Output the review item above with its response.

- Sets or replaces the response; the author name is the calling instructor's name in the "Alex T." form, the time is now. Any instructor of the course may edit or delete another instructor's response.
- Does not change `rating`, `text`, `version`, `editedAt` or the summary.
- Errors: `NOT_FOUND` (no such review), `FORBIDDEN` (not an instructor of the course), `PRECONDITION_FAILED` ("This review was removed").

## `review.deleteResponse` (mutation)

Input `{ courseId, reviewerId }`. Output the review item without a response. Deleting an absent response is a no-op returning the review. Same errors as `respond`.
