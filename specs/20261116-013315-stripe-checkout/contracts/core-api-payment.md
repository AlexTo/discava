# Contract: core-api payment and enrolment changes

## `payment.checkout` (mutation, signed in)

Runs on its own dedicated function, `PaymentsCheckout` (added to `CORE_API_DEDICATED_FUNCTIONS` in `packages/common/constructs/src/app/apis/core-api.ts`), which alone may read the Stripe API key secret. A `protectedProcedure` on the table plugin; the student is always `ctx.user.sub`.

Input: `{ courseId: string }`

Output: `{ checkoutUrl: string }`

- The course must be `published`; draft, archived or missing is `NOT_FOUND` (as `enrol`).
- A course with `priceAmount = 0` is `BAD_REQUEST` "This course is free; enrol instead".
- A student whose enrolment is `active` or `completed` is `CONFLICT` "You are already enrolled in this course". A `dropped` student may buy.
- If the student has an open order for the course (`findOpenOrder`), its stored `checkoutUrl` is returned and nothing is written.
- Otherwise: `startOrder` (amounts from the course, never the input), then one Stripe `checkout.sessions.create` with the settings in research R-10 and idempotency key = the order ID, then `attachCheckoutSession`. If Stripe fails, the order is moved to `expired` (best effort) and the call fails with `INTERNAL_SERVER_ERROR` "Couldn't start the payment".
- `success_url` and `cancel_url` use the request's allowed origin (`getAllowedOrigin` from `@discava/common-server-utils/cors`); a request from any other origin gets `FORBIDDEN`.
- Never returns the order, the session ID, or any Stripe field other than the URL.

## `course.enrol` (changed)

Unchanged for free courses. The transaction's course check becomes `status = 'published' AND priceAmount = 0`. When the transaction is cancelled on that check, the course is read again: `published` with a price gives `PRECONDITION_FAILED` "This course must be purchased"; anything else stays `NOT_FOUND`. It never writes `orderId`.

## Course outputs (changed)

`course.publicView`, `course.publicList`, `course.publicSearch` and `course.view` gain `priceAmount: number` and `priceCurrency: string`. `course.myEnrolments` does not. No output exposes `orderId`, `pricedAt` or any order field.

## Tests

`procedures/payment.test.ts`: the cases above, plus: the Stripe client is mocked, and the amount it is asked for is the course's even when the input carries another; a second call returns the first call's URL with one order and one Stripe call; a draft course never reaches Stripe; the success URL's origin is the allowed one. `procedures/enrolment.test.ts` (extend, do not weaken): a priced course is refused with `PRECONDITION_FAILED` and writes nothing; the free paths pass unchanged. `router.test.ts`: `payment.checkout` is not in `PUBLIC_OPERATIONS` and is `UNAUTHORIZED` without a user.
