# Contract: core-api payment and enrolment changes

## `payment.checkout` (mutation, signed in)

Runs on its own dedicated function, `PaymentsCheckout` (added to `CORE_API_DEDICATED_FUNCTIONS` in `packages/common/constructs/src/app/apis/core-api.ts`), which alone may read the Stripe API key secret. A `protectedProcedure` on the table plugin; the student is always `ctx.user.sub`.

Input: `{ courseId: string }`

Output: `{ checkoutUrl: string }`

- The course must be `published`; draft, archived or missing is `NOT_FOUND` (as `enrol`).
- Payments must be connected: the connection record is `active`, checked inside `startOrder`'s transaction. Otherwise `PRECONDITION_FAILED` "Payments are unavailable right now" and nothing is written. The Stripe API key is read only after this passes.
- A course with `priceAmount = 0` is `BAD_REQUEST` "This course is free; enrol instead".
- A student whose enrolment is `active` or `completed` is `CONFLICT` "You are already enrolled in this course". A `dropped` student may buy.
- If the student has an open order for the course (`findOpenOrder`), its stored `checkoutUrl` is returned and nothing is written.
- Otherwise: `startOrder` (amounts from the course, never the input), then one Stripe `checkout.sessions.create` with the settings in research R-10 and idempotency key = the order ID, then `attachCheckoutSession`. If Stripe fails, the order is moved to `expired` (best effort) and the call fails with `INTERNAL_SERVER_ERROR` "Couldn't start the payment".
- `success_url` and `cancel_url` use the request's allowed origin (`getAllowedOrigin` from `@discava/common-server-utils/cors`); a request from any other origin gets `FORBIDDEN`.
- Never returns the order, the session ID, or any Stripe field other than the URL.

## `payment.available` (query, signed in)

Input: none. Output: `{ available: boolean }`, true only when the connection is `active`. Reads the connection record only; reveals nothing else (no mode, account or key). The student portal calls it for a priced course to choose between **Buy now** and "Payments are unavailable right now".

## `course.enrol` (changed)

Unchanged for a student with no enrolment in a free course. The transaction's course check becomes `status = 'published' AND priceAmount = 0`. When the transaction is cancelled on that check, the course is read again: `published` with a price gives `PRECONDITION_FAILED` "This course must be purchased"; anything else stays `NOT_FOUND`. It never writes `orderId`.

**A `dropped` enrolment in a free course is restored** (amendment 2026-11-19). Only a full refund writes `dropped`, so this is a refunded student coming back after the course was set to free; without it they would have no way in, since `payment.checkout` refuses a free course. When the create is cancelled because the enrolment exists, `enrol` reads it. `active` or `completed` is returned as today, whatever the course's status or price. `dropped` goes to `restoreFreeEnrolment` (`helpers/order.ts`): one transaction that checks the course is `published` with `priceAmount = 0` and patches the enrolment to `completed` if it has `completedAt`, else `active`, removing `orderId`, conditioned on `status = 'dropped'`. Progress, completions and certificates are as the refund left them.

- The course check fails: the answers above apply. A priced published course is `PRECONDITION_FAILED` "This course must be purchased" (a refunded student buys again); a draft, archived or missing one is `NOT_FOUND`. The enrolment stays `dropped`.
- The enrolment condition fails (a paid restore or a second `enrol` got there first): the enrolment is read again and returned if it is no longer `dropped`.

## Course outputs (changed)

`course.publicView`, `course.publicList`, `course.publicSearch` and `course.view` gain `priceAmount: number` and `priceCurrency: string`. `course.myEnrolments` does not. No output exposes `orderId`, `pricedAt` or any order field.

## Tests

`procedures/payment.test.ts`: the cases above, plus: the Stripe client is mocked, and the amount it is asked for is the course's even when the input carries another; a second call returns the first call's URL with one order and one Stripe call; a draft course never reaches Stripe; the success URL's origin is the allowed one. `procedures/enrolment.test.ts` (extend, do not weaken): a priced course is refused with `PRECONDITION_FAILED` and writes nothing; the free paths pass unchanged; a `dropped` enrolment in a free published course is restored to `completed` when it has `completedAt` and to `active` otherwise, with `orderId` removed and `progressPercent` kept; a `dropped` one in a priced published course is `PRECONDITION_FAILED` and stays `dropped`; in a draft or archived course it is `NOT_FOUND` and stays `dropped`; two `enrol` calls at once restore it once and both return the restored enrolment. `router.test.ts`: `payment.checkout` is not in `PUBLIC_OPERATIONS` and is `UNAUTHORIZED` without a user. `payment.checkout` with no connection, a `changing` one and a `disconnected` one is `PRECONDITION_FAILED` with no order written and no Stripe call; the order carries the connection's `accountId`; `payment.available` is false for those three states and true for `active`.

## Amendment 2026-11-19: learner refunds and leaving a course

### `payment.requestRefund` (mutation, signed in)

Runs on the dedicated `PaymentsCheckout` function, still the only core-api function that may read the Stripe API key.

Input: `{ courseId: string }`

Output: `{ refundRequestedAt: string }`

- The order is the one the caller's enrolment in the course rests on (`enrolment.orderId`); the student is always `ctx.user.sub`. No enrolment, or an enrolment without an order, is `NOT_FOUND` "No purchase to refund", the same answer whether or not anyone else bought the course.
- `refundEligibility` decides, with the server's clock. Refusals are `PRECONDITION_FAILED` and write nothing:
  - `window-ended`: "The 14-day refund period for this course has ended"
  - `completed`: "A course can't be refunded after you have completed it"
  - `progress-limit` (amendment 2026-11-23): "A course can't be refunded after you have completed half of it"
  - `refunded-before` (amendment 2026-11-23): "You were refunded for this course before, so this purchase can't be refunded"
  - `other-account`, or payments not connected: "This purchase can't be refunded here right now"
  - `not-current-order`, `not-paid`: "No purchase to refund"
- `already-requested` is not an error: the stored `refundRequestedAt` is returned and Stripe is not called.
- Otherwise: one Stripe `refunds.create` for the order's `paymentIntentId`, amount `amount - (refundedAmount ?? 0)`, idempotency key `refund-<orderId>`; then `markRefundRequested`. If Stripe fails, nothing is written and the call fails with `INTERNAL_SERVER_ERROR` "Couldn't request the refund".
- It never moves the order to `refunded` and never writes the enrolment: `charge.refunded` does (stripe-webhook.md).
- Never returns the order ID, the payment intent or any other Stripe field.

### `payment.myOrder` (query, signed in)

Input: `{ courseId: string }`

Output: `null` when the caller has no paid or refunded order for the course, otherwise their most recent one as:

`{ status: 'paid' | 'refunded', amount: number, currency: string, paidAt: string, refundWindowDays: number, refundableUntil: string, canRequestRefund: boolean, refundBlockedBy?: 'window-ended' | 'completed' | 'progress-limit' | 'refunded-before' | 'other-account', refundProgressLimitPercent: number, refundRequestedAt?: string, refundedAt?: string }`

Amendment 2026-11-23: `refundBlockedBy` gains `progress-limit` and `refunded-before`, and `refundProgressLimitPercent` is the limit (50) from `core-table`. `myOrder` and `requestRefund` decide with the same inputs: progress computed from the caller's completions and the current curriculum (`computeProgress`), and whether an earlier order of theirs for the course has `refundRequestedAt` and is `refunded`.

Reads only; needs no Stripe key, so it runs on the shared function. This is the one output that exposes order fields, and only to the order's own student.

### `course.unenrol` (mutation, signed in)

Input: `{ courseId: string }`. Output: the enrolment, as `course.myEnrolment` returns it.

- No enrolment for the caller: `NOT_FOUND`.
- The enrolment has an `orderId`: `PRECONDITION_FAILED` "You bought this course; request a refund instead". Nothing is written.
- Already `dropped`: returned as it is.
- Otherwise `unenrolFromCourse`. The course's status and price are not checked: a student can leave a course that has been archived or given a price.

### Changed

- `course.myEnrolment` gains `paidFor: boolean` (the enrolment has an `orderId`). `orderId` itself is still never exposed.
- `course.publicView` gains `refundWindowDays: number` for a priced course, so the terms line and the API cannot disagree. Amendment 2026-11-23: also `refundProgressLimitPercent: number`.
- `course.myEnrolment` (amendment 2026-11-23) gains `refundedBefore: boolean` for a signed-in caller who has an earlier own-request refunded order for the course, so the page can warn before a second purchase (FR-043). No order field is exposed.
- `course.enrol`: its text above says only a full refund writes `dropped`. That no longer holds: leaving writes it too. The behaviour is unchanged and is what brings back a student who left: a `dropped` enrolment in a free course is restored, and in a priced course it is "This course must be purchased".

### Tests

As listed in tasks T090 and T103.
