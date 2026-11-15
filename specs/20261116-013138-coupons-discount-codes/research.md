# Research: Coupons and Discount Codes

## R-1: Building on a checkout that does not exist yet

**Decision**: Treat #284's order, course price and webhook as assumed concepts (spec Assumptions) and keep coupon logic in three places that take plain values: `priceWithCoupon` (amounts in, amounts out), the claim, confirm and release builders (they return transaction items to compose with the order write), and the two coupon APIs. The first task of the first implementation PR reads #284's merged code and records the mapping (status names, order key, where the webhook runs, price attribute) in the PR, editing this folder if it differs. No implementation PR starts before #284's order entity has merged.

**Rationale**: #284 was being specified in parallel and had no spec PR when this was written, so anything deeper would be guessing. The builders pattern is the one `studentActivityWrites` already uses for "a rule several writers rely on", so #284's order write composes with it without #285 owning orders.

**Assumptions to check when #284 lands**: order status set (`pending`, `paid`, `expired`, `cancelled`, `refunded`); the order's key (student and course, or an order id); a zero-total order may be created `paid`; the checkout start procedure's name and result; Stripe session expiry is configurable; the webhook handles `checkout.session.completed` and `checkout.session.expired`; supported currencies and zero-decimal handling.

**Alternatives**: wait for #284 before writing this spec (rejected: the issue is independent enough to specify now); build coupons as Stripe Coupon or Promotion Code objects (R-4).

## R-2: Where the redemption count lives and how the limit holds

**Decision**: `redeemedCount` on the `coupon` item, raised by a DynamoDB transaction update with the condition `enabled AND (no expiresAt OR expiresAt > now) AND (no maxRedemptions OR redeemedCount < maxRedemptions)`. The same transaction creates the redemption (`attribute_not_exists`), so a student cannot hold a code twice, and carries the order write.

**Rationale**: a conditional counter on one item is the standard way to cap concurrent claims in DynamoDB; the transaction ties the counter, the per-student record and the order together, so there is no state where the count and the records disagree except through a bug the invariant catches.

**Alternatives**: count redemptions by querying them (a read-then-write race, rejected); a counter updated by a stream handler (eventually consistent, would allow overselling); a Lambda-level lock (no cross-Lambda guarantee).

## R-3: Transaction conflicts under a race

**Decision**: concurrent transactions touching the coupon item may be cancelled with `TransactionConflict` instead of a failed condition. The claim retries a conflict up to 3 times with a random 50 to 150 ms delay, then surfaces `CONFLICT` (the existing `transactionConflict()` in core-api). Concurrency tests assert the hard rule (never more than N live redemptions, invariants pass) and, with callers retrying a `CONFLICT`, that exactly N end up holding the code.

**Rationale**: the spec's "exactly N succeed" is reachable only when conflicts are retried; the safety rule never depends on it.

## R-4: Stripe sees only the amount

**Decision**: the Checkout session carries one line item for the server-computed total (`price_data`, the course title) and expires in 30 minutes. No Stripe Coupon or Promotion Code is created.

**Rationale**: Stripe coupons would hold a second copy of the limit and the expiry, race with ours, and need syncing when an instructor edits a code. The order already records the breakdown. A zero total never reaches Stripe (it refuses a session below its minimum anyway).

**Alternatives**: Stripe Promotion Codes (second source of truth, no per-student rule we control); sending list price plus a negative line (not supported for Checkout).

## R-5: Reservation lifecycle and leaks

**Decision**: a redemption is `reserved` (with `reservedUntil` = session expiry plus 5 minutes) or `redeemed`. Paid confirms it (`reserved` to `redeemed`, conditional on `reserved`). Expired or cancelled releases it, and so does a replaced order, but only after its session has been expired (R-10): the redemption item is deleted and the counter lowered, in one transaction conditioned on the redemption still being `reserved` (so releasing twice does nothing). A claim that is refused as used up first queries that code's redemptions, releases those `reserved` past `reservedUntil` through the same release builder (with #284's helper marking the order expired), and tries once more.

**Rationale**: Stripe retries a failed webhook for days but not forever; without the reclaim, one lost event would hold a limited code's last slot indefinitely. The grace period exists because a session cannot be paid after its expiry, so a reclaim after `reservedUntil` can never race a payment.

**Alternatives**: a scheduled sweep Lambda (a new component, not warranted); count only paid redemptions (allows overselling, the issue's one hard rule).

## R-6: Why the paid path is not raced end to end in e2e

**Decision**: the limit race in `packages/e2e` uses a 100% code, so every winner takes the free path, which needs no Stripe. The paid path's claim is the same builder; its race is a unit test against an in-memory fake that enforces the conditions, and a `(human)` check on `discava-development` with Stripe test keys.

**Rationale**: PR CI has no Stripe credentials, and a concurrency test must not call a third party. Both paths run one claim builder, so the race proves the shared rule.

## R-7: Order fields #286 needs

**Decision**: the order records `listAmount`, `discountAmount`, `totalAmount`, `currency`, `couponCode`, `couponType`, `couponValue`, with amounts in minor units, written at claim time and never edited. Contract in [contracts/order-discount-fields.md](./contracts/order-discount-fields.md).

**Rationale**: payouts reconcile gross, discount and net per order and must not depend on a code that may later be disabled, edited or deleted.

## R-8: Code format and generation

**Decision**: stored upper case, 4 to 24 of `A-Z`, `0-9`, `-`; a typed code is trimmed and upper-cased on input. A generated code is 8 Crockford base32 characters (40 bits, no `I L O U`) shown as `XXXX-XXXX`, from `crypto.randomBytes`, retried on a duplicate within the course.

**Rationale**: matches how certificate IDs are normalised, and 40 bits is enough because a code is scoped to a course and behind the WAF.

## R-9: Price rules

**Decision**: percent discount = `floor(listAmount * percent / 100)`; fixed discount = `min(value, listAmount)`; total = list minus discount. A total above zero but below `MIN_CHARGE_MINOR[currency]` is refused. Amounts are integers in minor units; the instructor enters a decimal in the course currency and the portal converts with the currency's exponent.

**Rationale**: integer maths avoids float drift; rounding the discount down means the percent shown is never exceeded.

## R-10: Replacing an unpaid order while its session is still payable

**Decision**: when a student starts checkout again (another code, none, or a code that makes the course free) and has an unpaid order with a Stripe session, the server first validates the new request read-only, then expires the old session with `checkout.sessions.expire`, and only after that succeeds runs the one transaction that cancels the old order, releases its reservation and writes the new claim. If Stripe says the session is already complete or the order is `paid`, nothing is replaced and the student is told they are already enrolled. Any other expiry failure is retryable and changes nothing. The free path uses the same step.

**Rationale**: releasing a reservation while its session can still be paid lets a limit-1 code go to a second student while the first still pays the old session, so two discounted purchases go through; and a free-path enrolment made beside a live session could later charge an enrolled student. An expired session cannot be paid, so releasing afterwards is safe. Validating first means a refused new code never costs the student their earlier checkout; only losing a race after validation can, and the student simply restarts.

**Alternatives**: keep the reservation until `reservedUntil` and let the expired event release it (rejected: a student who changes their mind would hold a limited code's slot, and be refused it as "used up" by their own earlier reservation, for up to 30 minutes); cancel the order and release in the same transaction without expiring (rejected: the double use above).
