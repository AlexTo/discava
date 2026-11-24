# Contract: admin-api `review` router

The admin API is the generated `@discava/admin-api` that the catalogue categories spec (#333) also uses; this feature adds only the procedures below. Every procedure requires the caller to be in the `admin` Cognito group, otherwise `FORBIDDEN`. If `admin-api` is not on `main` when this is implemented, the first task generates it exactly as #333's plan does (see research R-7).

## `review.courses` (query)

Input `{ cursor?, limit? }` (`limit` at most 50). Output `{ items: { courseId, title, status, ratingCount }[], cursor }`: published courses then archived ones, newest first within each (two `course.byStatus` queries; the cursor encodes which). `ratingCount` is from one batch get of `courseRating`. This feeds the course picker.

## `review.list` (query)

Input `{ courseId, cursor?, limit? }` (`limit` at most 50, default 20). Output `{ items, cursor }`, newest first, all statuses:

```text
items[] = { reviewerId, reviewerName, rating, text?, createdAt, editedAt?, status,
            removedAt?, removedBy?, removedReason?, response?: { text, byName, at } }
```

`NOT_FOUND` for a draft course or an unknown ID. No email.

## `review.remove` (mutation)

Input `{ courseId, reviewerId, reason }`: `reason` trimmed, 1 to 200 characters. Output the review item (now removed).

- One `reviewWrites` Remove transaction (data-model.md). `removedBy` is the admin's `sub`.
- Removing an already removed review changes nothing and returns it (idempotent).
- A stale read (the student edited at the same moment) retries once after re-reading; the removal then applies to the edited review.
- Errors: `NOT_FOUND`, `FORBIDDEN` (not an admin: instructors of the course included), `BAD_REQUEST` (reason).
