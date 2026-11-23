# Data Model: Coupons and Discount Codes

## `coupon` (new entity, `packages/databases/core-table/src/entities/coupon.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `courseId` | string, required, read-only | |
| `code` | string, required, read-only | normalised: upper case, 4 to 24 of `A-Z0-9-` |
| `type` | `'percent' \| 'fixed'`, required, read-only | |
| `value` | number, required, read-only | percent: integer 1 to 100; fixed: integer minor units above 0 |
| `currency` | string, required for `fixed`, read-only | the course's `priceCurrency` when created (USD, EUR, GBP, AUD or CAD, upper case, as on the order) |
| `expiresAt` | string (ISO instant), optional | the end of the chosen date, UTC |
| `maxRedemptions` | number, optional | integer of at least 1 |
| `redeemedCount` | number, required, default 0 | reserved plus redeemed; written only by the redemption builders |
| `enabled` | boolean, required, default true | |
| `createdBy` | string, required, read-only | instructor's user id |
| `createdAt`, `updatedAt` | as other entities | |

**Status shown to instructors** (derived, never stored): `disabled`, `expired` (now past `expiresAt`), `used up` (count at limit), else `active`.

## `couponRedemption` (new entity, `.../entities/coupon-redemption.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `courseId`, `code` | string, required, read-only | the coupon |
| `userId` | string, required, read-only | the student |
| `orderId` | string, required, read-only | the order this redemption belongs to (#284's `orderId`) |
| `status` | `'reserved' \| 'redeemed'`, required | `reserved` while the checkout can still be paid |
| `reservedUntil` | string (ISO), required while `reserved`, removed when `redeemed` | the order's `expiresAt` (one hour after checkout starts) plus 5 minutes |
| `createdAt`, `updatedAt` | as other entities | |

A released reservation is deleted, so "already used by you" never counts it.

## Indexes (access patterns, constitution V)

| Pattern | Key | Used by |
|---------|-----|---------|
| Get a coupon by course and code (apply, claim, preview) | primary: pk `courseId`, sk `code` | `coupon.preview`, checkout start, builders |
| List a course's coupons | same pk, query on the entity's sk prefix | `coupon.list` (instructor-api) |
| Get one student's redemption of a code (idempotent claim, "already used") | primary: pk `courseId` + `code`, sk `userId` | claim, confirm, release |
| List a code's redemptions (lazy reclaim of expired reservations) | same pk | claim (only when refused as used up) |

No scans in a user request. The invariant loader may scan (tooling). No new global secondary index.

## `order` (#284) gains discount fields

See [contracts/order-discount-fields.md](./contracts/order-discount-fields.md): `listAmount` and `amount` (the total) already exist; `discountAmount`, `couponCode`, `couponType` and `couponValue` are added, all present or all absent. The order's `status` (`pending`, `paid`, `expired`, `refunded`) is the other side of the redemption's: `pending` with `reserved`, `paid` with `redeemed`.

The builders are composed into `helpers/order.ts` (the only writer of `order` and of `enrolment.orderId`): `startOrder` for a paid total, a new free-order writer for a zero total, `settleOrderPaid` (confirm), `expireOrder` and `refundUndeliverable` (release). Orders are found by `orderId` or `byStudentCourse`.

## Rules and where they live (`helpers/coupon-redemption.ts`, the only writers of `redeemedCount` and `couponRedemption`)

- `claimCouponWrites({ coupon, userId, orderId, status, now, reservedUntil })`: items to compose into a transaction: raise `redeemedCount` under the limit condition; create the redemption (`reserved` with `reservedUntil`, or `redeemed` for a zero total).
- `confirmCouponWrites({ courseId, code, userId })` (composed into `settleOrderPaid`): `reserved` to `redeemed`, conditional on `reserved`, removing `reservedUntil`.
- `releaseCouponWrites({ courseId, code, userId })` (composed into `expireOrder` and `refundUndeliverable`): delete the redemption conditional on `reserved`, and lower `redeemedCount` conditional on it being above 0.
- `couponStatus(coupon, now)` and `COUPON_REFUSALS` (the fixed messages, shared by preview and checkout).
- `priceWithCoupon({ listAmount, coupon })` (no currency: every supported currency has two decimals) and `MIN_CHARGE_MINOR` (exactly USD, EUR, GBP, AUD, CAD; `minimumCharge` throws for another currency) in `helpers/coupon-price.ts` and the code helpers in `helpers/coupon-code.ts` are pure.

## State transitions

```
(none) --claim--> reserved --confirm--> redeemed
                     |
                     +--release (expired, replaced after its session was expired, refunded as undeliverable, reclaimed)--> (deleted)
(none) --claim, zero total--> redeemed
```

## Invariants (`helpers/invariants.ts`, each with a breaking test)

| Name | Rule |
|------|------|
| `coupon-count-matches-redemptions` | each coupon's `redeemedCount` equals the number of its redemption records |
| `coupon-within-limit` | `redeemedCount <= maxRedemptions` when a limit exists; fixed coupons have a currency; percent values are 1 to 100 |
| `coupon-redemption-shape` | the coupon exists; `reserved` has `reservedUntil`, `redeemed` does not |
| `coupon-redemption-has-order` | the order exists for that student and course and carries the same `couponCode`; it is `pending` for `reserved`, and `paid`, or `refunded` with reason `requested` (a refund after delivery keeps `redeemed`), for `redeemed`. An `expired` order, or one refunded as `duplicate`, `unavailable` or `mismatch`, has no redemption |
| `order-discount-adds-up` | every order: `listAmount - (discountAmount ?? 0) = amount`, no negatives, and `discountAmount`, `couponCode`, `couponType` and `couponValue` are all present or all absent (#284's `order-shape` already bounds `amount` between 0 and `listAmount`) |
| `free-coupon-order-has-enrolment` | a `paid` order with `amount` 0 and a code has an enrolment for that student and course whose `orderId` is the order, unless the enrolment later ended (`dropped`) |

Not violations: a disabled or expired coupon with redemptions; a coupon whose course is archived; a deleted coupon cannot exist with redemptions (the delete is conditioned on `redeemedCount = 0`).
