# Contract: core-api coupon preview and checkout changes

Names of #284's procedures are assumed (`checkout.start`); T001 reconciles them with what merged. Nothing here changes how Stripe is called beyond the amount and the session expiry.

## `coupon.preview` (new, `protectedProcedure`)

Input: `{ courseId, code }`. Reads only: the course and the coupon (two keyed gets) and the student's enrolment and redemption. Reserves nothing.

Output: `{ code, listAmount, discountAmount, totalAmount, currency, isFree }` from `priceWithCoupon`.

Errors, all `PRECONDITION_FAILED` with the message from `COUPON_REFUSALS`, except the first:

| Case | Code | Message |
|------|------|---------|
| unknown code, or a code of another course | `PRECONDITION_FAILED` | "This code is not valid for this course" (identical for both) |
| disabled | `PRECONDITION_FAILED` | "This code has been turned off" |
| expired | `PRECONDITION_FAILED` | "This code has expired" |
| used up | `PRECONDITION_FAILED` | "This code has been used the maximum number of times" |
| already used by the caller | `PRECONDITION_FAILED` | "You have already used this code" |
| already enrolled | `PRECONDITION_FAILED` | "You are already enrolled in this course" |
| total above zero but under the minimum charge | `PRECONDITION_FAILED` | "This code leaves a price too low to pay for" |
| course not published, free or missing | `NOT_FOUND` | as `enrol` does |

## Checkout start with a code (changes #284's `checkout.start`)

Added optional input `couponCode`. The server MUST re-validate everything above, compute the total with `priceWithCoupon`, and ignore any amount from the browser.

- **Total above zero**: one transaction composes `claimCouponWrites` (status `reserved`) with #284's order create (`pending`, discount fields from the contract below) and its course and enrolment checks, and, if the student has an earlier unpaid order for the course, `releaseCouponWrites` for that order's code (if any) and #284's order cancel. Then the Stripe session is created for `totalAmount` with a 30-minute expiry and stored on the order. If the session call fails, the claim is released and the order cancelled. A repeat with the same code returns the existing unpaid order's session.
- **Total zero**: one transaction composes `claimCouponWrites` (status `redeemed`), the order create (`paid`, total 0), the enrolment create and the course-published check. No Stripe call. Result: the enrolment, as `enrol` returns it. A repeat finds the existing redemption and returns the existing enrolment.
- **Cancelled claim**: re-read the coupon and answer with the matching message above; `TransactionConflict` is retried up to 3 times, then `CONFLICT`; a refusal as used up first reclaims expired reservations (research R-5) and retries once.

## Paid and expired handlers (#284's webhook)

- Paid: after #284 marks the order paid and creates the enrolment, `confirmCouponWrites` is part of the same transaction when the order has a code.
- Expired or failed: `releaseCouponWrites` is part of the transaction that marks the order expired. Both are idempotent: a replayed event changes nothing.
