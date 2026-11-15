# Data Model: Stripe Checkout for Paid Courses

## `order` (new entity, `packages/databases/core-table/src/entities/order.ts`)

One checkout attempt by one student for one course.

| Attribute | Type | Notes |
|-----------|------|-------|
| `orderId` | string, required, read-only | UUIDv7, like `courseId`, so orders sort by creation |
| `userId` | string, required, read-only | the student (Cognito `sub`) |
| `courseId` | string, required, read-only | |
| `courseTitle` | string, required, read-only | the title when the checkout started (shown to the payer, kept for reports) |
| `listAmount` | number (integer), required, read-only | the course price when the checkout started, minor units. #285 may charge less |
| `amount` | number (integer), required, read-only | what Stripe is asked to charge, minor units. Equal to `listAmount` in this feature |
| `currency` | string, required, read-only | one of the supported ISO codes, upper case |
| `status` | `pending` \| `paid` \| `expired` \| `refunded`, required | see the lifecycle below |
| `expiresAt` | string (ISO), required | when the checkout lapses (start + 1 hour) |
| `checkoutSessionId` | string | Stripe's session ID, set once the session is created |
| `checkoutUrl` | string | the hosted page URL, so a repeated Buy now needs no Stripe call |
| `paymentIntentId` | string | set from the paid session; how a refund finds its order's payment |
| `paidAt` | string (ISO) | set when Stripe confirmed payment (also on an order refunded automatically: the money was taken) |
| `refundedAt` | string (ISO) | set with `status: refunded` |
| `refundedAmount` | number (integer) | total refunded so far; may be set on a `paid` order for a partial refund; never lowered |
| `refundReason` | `requested` \| `duplicate` \| `unavailable` | why it is `refunded`: an operator's refund, a second payment, or a course no longer published |
| `createdAt`, `updatedAt` | as other entities | |

**Lifecycle** (each move is a conditional write on the status it comes from):

```text
pending ──paid session──────────────► paid ──full refund──► refunded (reason requested)
   │                                    └─partial refund─► paid (refundedAmount grows)
   ├──expired session / lapsed────────► expired
   └──paid session, not deliverable──► refunded (reason duplicate | unavailable)
```

`expired` and `refunded` are final. A pending order past `expiresAt` is treated as closed by every reader even if its `expired` event never arrived.

**Indexes** (access patterns, constitution V):

| Pattern | Key | Used by |
|---------|-----|---------|
| Get an order by ID (every webhook event names its order) | primary: pk `orderId`, sk none (constant) | webhook, checkout reuse |
| A student's orders for a course (reuse an open checkout; refuse if already paid) | existing `gsi1pk-gsi1sk-index`: `gsi1pk` = `userId`, `gsi1sk` = `courseId` then `orderId` | `payment.checkout` |

Nothing is listed for the instructor, per course or per period: #286 adds its own index for reports. No scans. The key prefixes ElectroDB adds keep `order` apart from `enrolment`'s and `course`'s use of the same index (a test with `.params()` proves a student-orders query cannot return an enrolment, as the certificates plan did).

## `course` (existing): price attributes

| Attribute | Type | Notes |
|-----------|------|-------|
| `priceAmount` | number (integer), required | minor units; `0` is free; otherwise 100 to 1,000,000 |
| `priceCurrency` | string, required | one of USD, EUR, GBP, AUD, CAD; kept when the price is `0` (a course set back to free keeps its last currency, so the form has a value) |
| `pricedAt` | string (ISO) | set when `priceAmount` goes from `0` to non-zero; removed when it returns to `0`; untouched by a change between two non-zero amounts |

Required with no default and no fallback; existing courses are backfilled by hand (`priceAmount: 0`, `priceCurrency: 'USD'`, no `pricedAt`) for local data and every deployed stage before the entity change is deployed (a `(human)` task). Written only by instructor-api's `course.setPrice` (which also moves `updatedAt` and each instructor's `courseUpdatedAt`) and set to free by `course.create`.

## `enrolment` (existing): `orderId`

Optional string. The order that currently entitles the enrolment: absent for a free enrolment, set by `settleOrderPaid` on create or restore, kept when the enrolment is ended by a refund (so the refund is traceable), replaced by the new order on a re-purchase. Not exposed in API outputs.

## Rules and where they live

`packages/databases/core-table/src/helpers/order.ts` is the only writer of `order`, and the only writer of `enrolment.orderId` and of the paid-restore and refund-end enrolment writes:

1. `startOrder({ coreTable, course, userId, now })`: refuses a free or unpublished course; creates a `pending` order with `listAmount = amount = course.priceAmount`, `expiresAt = now + 1 h`.
2. `attachCheckoutSession(order, { sessionId, url })`: patches the pending order.
3. `findOpenOrder({ coreTable, userId, courseId, now })`: the student's `pending` order with a session and `expiresAt` more than 5 minutes ahead, or none.
4. `settleOrderPaid({ coreTable, order, session, now })`: R-2: one transaction (order to `paid`; enrolment created or restored; course check `published`). Returns `fulfilled`, `already-settled`, or `undeliverable` with the reason (already enrolled, course unavailable). It does not call Stripe, so #285 can call it for a fully discounted order with no session.
5. `refundUndeliverable(order, reason)`: the order move `pending` to `refunded`; the Stripe call is made by the handler before it.
6. `expireOrder(order)`: `pending` to `expired`.
7. `refundOrder({ coreTable, order, refundedTotal, now })`: full: one transaction (order to `refunded` with reason `requested`; enrolment to `dropped` where `orderId` is this order). Partial: raises `refundedAmount`. Both are no-ops on an order already at or beyond that state.

`course.enrol` (free enrolments) keeps its own transaction and gains the `priceAmount = 0` condition; it never sets `orderId`.

## Invariants (`helpers/invariants.ts`; the snapshot gains `orders`)

New:

- `price-shape`: every course has an integer `priceAmount` that is `0` or within 100 to 1,000,000, a currency from the list, and `pricedAt` exactly when `priceAmount > 0`.
- `order-shape`: required attributes present; `listAmount` and `amount` integers within bounds and `amount <= listAmount`; the currency from the list; `paid` has `paidAt` and a payment intent; `refunded` has `refundedAt` and a reason, and `requested` has `paidAt`; `refundedAmount <= amount`; `pending` and `expired` have no `paidAt`; checkout session IDs unique across orders.
- `paid-order-has-enrolment`: for each `paid` order there is an enrolment for its student and course, not `dropped`, with `orderId` equal to the order; and a student has at most one `paid` order per course. (Exactly-once, as data.)
- `enrolment-order-matches`: an enrolment with an `orderId` has that order, for the same student and course; the order is `paid`, or is `refunded` with reason `requested` and the enrolment is `dropped`. An order refunded for `duplicate` or `unavailable` is never an enrolment's order.
- `paid-course-enrolment-paid`: in a course with `priceAmount > 0`, an enrolment with no `orderId` has `createdAt` at most `pricedAt` plus 10 seconds. (The issue's "unpaid users cannot access paid content", as data.)

Widened (existing tests kept, new cases added):

- `completed-at-iff-completed`, enrolments only: `completed` still requires `completedAt`; `completedAt` now requires `completed` or `dropped`. Lesson progress is unchanged.
- `certificate-has-completed-enrolment`: the enrolment may be `completed`, or `dropped` with the same `completedAt`.

Not violations: a free enrolment in a course that is paid now and was enrolled before `pricedAt`; a `pending` order past `expiresAt`; a course set back to free with paid orders; a certificate whose student was refunded. Each ships with a test that breaks it. A test pins that an order alone does not make a student count in `activity-count-matches-students` or trip a `student-records-*` check.
