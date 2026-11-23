# Contract: core-api coupon preview and checkout changes

#284's procedure is `payment.checkout` (`packages/apis/core-api/src/procedures/payment.ts`, on the dedicated `PaymentsCheckout` function, which alone may read the Stripe key); `coupon.preview` reads no Stripe key and runs on the shared function. Nothing here changes how Stripe is called beyond the amount.

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
| already enrolled (`active` or `completed`; a `dropped` student may buy) | `PRECONDITION_FAILED` | "You are already enrolled in this course" (`payment.checkout` keeps #284's `CONFLICT` with this message for a start without a code) |
| total above zero but under the minimum charge | `PRECONDITION_FAILED` | "This code leaves a price too low to pay for" |
| course not published or missing | `NOT_FOUND` | as `enrol` does |

## Checkout start with a code (changes #284's `payment.checkout`)

Added optional input `couponCode`; the input is `{ courseId, couponCode? }`. The output stays `{ checkoutUrl }` for a total above zero and is `{ enrolled: true }` (no `checkoutUrl`) on the free path; the portal then reads the enrolment as it does after `enrol`. A start without a code behaves exactly as today. The server MUST re-validate everything above, compute the total with `priceWithCoupon`, and ignore any amount from the browser.

- **Replacing an earlier unpaid order (both branches below).** A student has one unpaid order per course. #284's `findOpenOrder` returns an open order (`pending`, with a session, more than five minutes left) and `payment.checkout` returns its stored `checkoutUrl` untouched; with a code, that reuse applies only when the open order's `couponCode` equals the normalised request (both absent counts as equal). Otherwise every `pending` order of the student for the course (read with `byStudentCourse`, not only the one `findOpenOrder` returns: one within five minutes of its end still holds the redemption, and a restart with the same code would otherwise be refused as "already used by you") is replaced, in this order: (1) validate the new request read-only first, so a refusal never touches the earlier checkout; (2) if the earlier order has a Stripe session, expire it with `checkout.sessions.expire`, treating "already expired" as success; (3) only once that succeeds, run the transaction below, which also moves the earlier order to `expired` (`expireOrder`'s write) and, if it holds a redemption, releases it. If Stripe reports the session already complete, or the order is now `paid`, nothing is replaced: return "already enrolled". Any other expiry failure is a retryable error and changes nothing. A `pending` order with no session and not yet past `expiresAt` may be mid-creation in another request: the start is refused retryably and changes nothing. The reservation is never released while its session can still be paid.
- **Total above zero**: one transaction composes `claimCouponWrites` (status `reserved`, `reservedUntil` = the new order's `expiresAt` plus 5 minutes) with `startOrder`'s writes (the `pending` order with `amount` = the total and the discount fields, and the connection's `latestCheckoutExpiresAt` raise; `startOrder` gains optional discount and extra-writes parameters, and stays the only creator of pending orders) and its course and enrolment checks, and, if there was an earlier unpaid order, `releaseCouponWrites` for that order's code (if any) and the `pending` to `expired` move. Then the Stripe session is created for `order.amount` with #284's settings (expiry = the order's `expiresAt`) and stored on the order. If the session call fails, the claim is released and the order expired (`expireOrder`, which releases). A repeat with the same code returns the existing open order's `checkoutUrl`.
- **Total zero**: after the replacement step above (so a live paid-checkout session can never charge an enrolled student), one transaction composes the earlier order's expire and release (if any), `claimCouponWrites` (status `redeemed`), a new `helpers/order.ts` writer for the free order (`paid`, `amount` 0, `paidAt`, no session; `accountId` and `mode` from the `active` connection, else "Payments are unavailable right now"; the `latestCheckoutExpiresAt` raise), the enrolment create, or the restore of a `dropped` enrolment with `orderId` set as `settleOrderPaid` does, and the course-published check. No Stripe call. Result: `{ enrolled: true }`. A repeat finds the existing redemption and returns the same.
- **Cancelled claim**: re-read the coupon and answer with the matching message above; `TransactionConflict` is retried up to 3 times, then `CONFLICT`; a refusal as used up first reclaims expired reservations (research R-5) and retries once.

## Paid, expired and undeliverable handling (`helpers/order.ts`; the webhook in `packages/events/src/payments/` does not change)

- Paid: `settleOrderPaid` re-reads the order and, when it has a `couponCode`, adds `confirmCouponWrites` to the transaction that marks it `paid` and creates or restores the enrolment. It takes no payment session, so the free path never needs it.
- Expired: `expireOrder` (called by `session-expired.ts` and by `payment.checkout` when the session call fails) adds `releaseCouponWrites` to the move to `expired` when the order has a code.
- Undeliverable: `refundUndeliverable` (reasons `duplicate`, `unavailable`, `mismatch`) also releases, because the student got the money back and no enrolment from this order.
- A refund after delivery (`refundOrder`) never releases. All are idempotent: each is conditional on the order's status, so a replayed event changes nothing.
