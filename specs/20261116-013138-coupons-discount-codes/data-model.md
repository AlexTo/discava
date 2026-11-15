# Data Model: Coupons and Discount Codes

## `coupon` (new entity, `packages/databases/core-table/src/entities/coupon.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `courseId` | string, required, read-only | |
| `code` | string, required, read-only | normalised: upper case, 4 to 24 of `A-Z0-9-` |
| `type` | `'percent' \| 'fixed'`, required, read-only | |
| `value` | number, required, read-only | percent: integer 1 to 100; fixed: integer minor units above 0 |
| `currency` | string, required for `fixed`, read-only | the course's currency when created |
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
| `orderId` | string, required, read-only | the order this redemption belongs to (#284's order key) |
| `status` | `'reserved' \| 'redeemed'`, required | `reserved` while the checkout can still be paid |
| `reservedUntil` | string (ISO), required while `reserved`, removed when `redeemed` | session expiry plus 5 minutes |
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

See [contracts/order-discount-fields.md](./contracts/order-discount-fields.md). The order's `status` is the other side of the redemption's: `pending` with `reserved`, `paid` with `redeemed`.

## Rules and where they live (`helpers/coupon-redemption.ts`, the only writers of `redeemedCount` and `couponRedemption`)

- `claimCouponWrites({ coupon, userId, orderId, status, now, reservedUntil })`: items to compose into a transaction: raise `redeemedCount` under the limit condition; create the redemption (`reserved` with `reservedUntil`, or `redeemed` for a zero total).
- `confirmCouponWrites({ courseId, code, userId })`: `reserved` to `redeemed`, conditional on `reserved`, removing `reservedUntil`.
- `releaseCouponWrites({ courseId, code, userId })`: delete the redemption conditional on `reserved`, and lower `redeemedCount` conditional on it being above 0.
- `couponStatus(coupon, now)` and `COUPON_REFUSALS` (the fixed messages, shared by preview and checkout).
- `priceWithCoupon` in `helpers/coupon-price.ts` and the code helpers in `helpers/coupon-code.ts` are pure.

## State transitions

```
(none) --claim--> reserved --confirm--> redeemed
                     |
                     +--release (expired, cancelled, replaced, reclaimed)--> (deleted)
(none) --claim, zero total--> redeemed
```

## Invariants (`helpers/invariants.ts`, each with a breaking test)

| Name | Rule |
|------|------|
| `coupon-count-matches-redemptions` | each coupon's `redeemedCount` equals the number of its redemption records |
| `coupon-within-limit` | `redeemedCount <= maxRedemptions` when a limit exists; fixed coupons have a currency; percent values are 1 to 100 |
| `coupon-redemption-shape` | the coupon exists; `reserved` has `reservedUntil`, `redeemed` does not |
| `coupon-redemption-has-order` | the order exists for that student and course, carries the same code, and is `pending` for `reserved`, `paid` for `redeemed` (a refunded order keeps `redeemed`) |
| `order-discount-adds-up` | every order: `listAmount - discountAmount = totalAmount`, no negatives, and a discount of 0 has no code |
| `free-coupon-order-has-enrolment` | a `paid` order with total 0 and a code has an enrolment for that student and course |

Not violations: a disabled or expired coupon with redemptions; a coupon whose course is archived; a deleted coupon cannot exist with redemptions (the delete is conditioned on `redeemedCount = 0`).
