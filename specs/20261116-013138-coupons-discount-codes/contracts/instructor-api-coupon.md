# Contract: instructor-api `coupon` router

All procedures build on `courseProcedure` and require the caller to be an instructor of `courseId` (the same authorisation as other course edits); anyone else gets `FORBIDDEN`. Nothing here writes the `course` record, so `course.updatedAt` and `courseUpdatedAt` do not move.

## `coupon.create`

Input: `{ courseId, code?: string, type: 'percent' | 'fixed', value: number, expiresOn?: 'YYYY-MM-DD', maxRedemptions?: number }`

- `code` omitted: a generated code (`XXXX-XXXX`). Present: normalised and validated (4 to 24 of `A-Z0-9-` after upper-casing).
- `value`: percent is an integer 1 to 100; fixed is minor units above 0 and not above the course's list price, and the course MUST be paid (price above 0), else `PRECONDITION_FAILED` "Coupons need a paid course".
- `expiresOn` must be today or later (UTC); stored as the end of that day.
- `maxRedemptions` an integer of at least 1.
- Duplicate `(courseId, code)` is `CONFLICT` "This code already exists for the course" (conditional create).
- Allowed in any course status.

Output: the coupon with its derived `status` and `redeemedCount`.

## `coupon.list`

Input: `{ courseId }`. Output: the course's coupons, newest first, each `{ code, type, value, currency?, expiresAt?, maxRedemptions?, redeemedCount, enabled, status }`.

## `coupon.update`

Input: `{ courseId, code, enabled?, expiresOn?: 'YYYY-MM-DD' | null, maxRedemptions?: number | null }`. `null` clears the expiry or limit. `maxRedemptions` below `redeemedCount` is `PRECONDITION_FAILED` "The limit cannot be below the N redemptions already held", enforced by a condition on the write (not a prior read), so a claim racing it cannot slip under. Code, type and value are not accepted.

## `coupon.delete`

Input: `{ courseId, code }`. A conditional delete on `redeemedCount = 0`; otherwise `PRECONDITION_FAILED` "This code has redemptions; disable it instead". A missing code is `NOT_FOUND`.
