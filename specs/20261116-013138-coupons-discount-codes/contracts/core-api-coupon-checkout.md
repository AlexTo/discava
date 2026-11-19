# Contract: core-api coupon preview and checkout changes

Names of #284's procedures are assumed (`checkout.start`); T001 reconciles them with what merged. Nothing here changes how Stripe is called beyond the amount and the session expiry.

## `coupon.preview` (new, `protectedProcedure`)

Input: `{ courseId, code }`. Reads only: the course and the coupon (two keyed gets) and the student's enrolment and redemption. Reserves nothing.

Output: `{ code, listAmount, discountAmount, totalAmount, currency, isFree }` from `priceWithCoupon`.

Errors, all `PRECONDITION_FAILED` with the message from `COUPON_REFUSALS`, except the first:

| Case | Code | Message |
|------|------|---------|
| unknown code, a code of another course, a fixed code whose currency is not the course's, or any code on a free course | `PRECONDITION_FAILED` | "This code is not valid for this course" (identical for all) |
| disabled | `PRECONDITION_FAILED` | "This code has been turned off" |
| expired | `PRECONDITION_FAILED` | "This code has expired" |
| used up | `PRECONDITION_FAILED` | "This code has been used the maximum number of times" |
| already used by the caller | `PRECONDITION_FAILED` | "You have already used this code" |
| already enrolled | `PRECONDITION_FAILED` | "You are already enrolled in this course" |
| total above zero but under the minimum charge | `PRECONDITION_FAILED` | "This code leaves a price too low to pay for" |
| course not published or missing | `NOT_FOUND` | as `enrol` does |

## Checkout start with a code (changes #284's `checkout.start`)

Added optional input `couponCode`. The server MUST re-validate everything above, compute the total with `priceWithCoupon`, and ignore any amount from the browser.

- **Replacing an earlier unpaid order (both branches below).** A student has one unpaid order per course. If one exists, in this order: (1) validate the new request read-only first, so a refusal never touches the earlier checkout; (2) if the earlier order has a Stripe session, expire it with `checkout.sessions.expire`; (3) only once that succeeds, run the transaction below, which also cancels the earlier order and, if it holds a redemption, releases it. If Stripe reports the session already complete, or the order is now `paid`, nothing is replaced: return the existing enrolment as "already enrolled". Any other expiry failure is a retryable error and changes nothing. The reservation is never released while its session can still be paid.
- **Total above zero**: one transaction composes `claimCouponWrites` (status `reserved`) with #284's order create (`pending`, discount fields from the contract below) and its course and enrolment checks, and, if there was an earlier unpaid order, `releaseCouponWrites` for that order's code (if any) and #284's order cancel. Then the Stripe session is created for `totalAmount` with a 30-minute expiry and stored on the order. If the session call fails, the claim is released and the order cancelled. A repeat with the same code returns the existing unpaid order's session.
- **Total zero**: after the replacement step above (so a live paid-checkout session can never charge an enrolled student), one transaction composes the earlier order's cancel and release (if any), `claimCouponWrites` (status `redeemed`), the order create (`paid`, total 0), the enrolment create and the course-published check. No Stripe call. Result: the enrolment, as `enrol` returns it. A repeat finds the existing redemption and returns the existing enrolment.
- **Cancelled claim**: re-read the coupon and answer with the matching message above; `TransactionConflict` is retried up to 3 times, then `CONFLICT`; a refusal as used up first reclaims expired reservations (research R-5) and retries once.

## Paid and expired handlers (#284's webhook)

- Paid: after #284 marks the order paid and creates the enrolment, `confirmCouponWrites` is part of the same transaction when the order has a code.
- Expired or failed: `releaseCouponWrites` is part of the transaction that marks the order expired. Both are idempotent: a replayed event changes nothing.
