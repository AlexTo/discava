# Implementation Plan: Coupons and Discount Codes

**Branch**: `20261116-013138-coupons-discount-codes` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261116-013138-coupons-discount-codes/spec.md`

## Summary

A `coupon` entity (one per course and code) and a `couponRedemption` entity (one per student per code) join the core table. All discount maths lives in one pure function, `priceWithCoupon`, and all writes that keep the redemption count, the reservation, the order and the enrolment consistent live in a small set of `core-table` transaction builders (`claimCouponWrites`, `confirmCouponWrites`, `releaseCouponWrites`), the same shape as `studentActivityWrites`. The claim is one DynamoDB transaction that raises the coupon's counter under a condition (enabled, not expired, below the limit), creates the redemption under a not-exists condition, and carries the order write, so the limit holds at any concurrency. instructor-api gains a `coupon` router for the instructor's side, core-api gains `coupon.preview` and a coupon input on #284's checkout start, and a zero-total claim also writes the enrolment so no Stripe session exists. The instructor portal gets a Coupons screen and the student portal a code field on the enrol or pay area.

What the code and the dependency showed that the spec could not:

1. **#284 is not built or specified yet** (no spec PR, no order entity, no course price on `main`). Every task here that touches orders, prices or the webhook is written against the assumed shapes in spec Assumptions, and the first task of the first implementation PR reconciles them with whatever #284 merged (research R-1). Coupon logic never reads Stripe types, only the order, price and course.
2. **One DynamoDB item per coupon serialises claims**, but two transactions on that item at once get `TransactionConflict`, not a failed condition (`core-api/src/lib/transaction.ts` already has this case). The helper retries a conflict a bounded number of times, so under a race "exactly N succeed" holds once retries finish and "never more than N" holds always (research R-3).
3. **A failed claim cannot say why**: DynamoDB reports one failed condition for expired, disabled and used-up alike. The procedure re-reads the coupon after a cancelled claim to choose the message (the safety comes from the condition, the message from the re-read).
4. **A lost "checkout expired" webhook would hold a reservation forever**, so each reservation carries `reservedUntil`, and a claim that finds the code used up first reclaims reservations past it (research R-5).

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `node:crypto` for generated codes, TanStack Router/Query, shadcn (`@discava/common-shadcn`); Stripe and the order entity come from #284 (not added here)

**Storage**: the one core table; new `coupon` and `couponRedemption` entities; discount fields added to #284's `order` entity

**Testing**: vitest per project (with the `@discava/core-table` alias), core-table `helpers/invariants.ts`, instructor and student portal component tests, Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway + CloudFront; `pnpm dev` with Docker locally

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: preview answers in well under 2 s (two keyed gets); the claim is one transaction of at most 6 items

**Constraints**: no second table; no scan in a user request; no new index; no new Lambda or stack resource; a Stripe session is created for the server-computed total only

**Scale/Scope**: tens of codes per course; one redemption per student per code

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | DynamoDB transactions and the existing Lambdas only; Stripe is #284's |
| II. Generators first | Pass | No new project, component or Lambda: extends core-table, instructor-api, core-api and the two portals in place. A new tRPC router inside an existing API is not generator-owned |
| III. Everything runs locally | Pass | The free path and every instructor action run in the local servers with no Stripe. The paid path uses #284's local Stripe test-mode setup; releasing on session expiry uses the same forwarded webhook, and unit tests drive the release helper directly |
| IV. Layered tests | Pass, planned | Unit tests for the price function, the claim, confirm and release builders against an in-memory fake that enforces conditions, each procedure and each component; invariants with breaking tests; an e2e scenario; a concurrency test. Impact check below |
| V. Single-table via ElectroDB | Pass | Two entities, access patterns in [data-model.md](./data-model.md), all keyed. No new index. The one query beyond a get is a partition query (a code's redemptions), not a scan |
| VI. Secure by default | Pass | Management only by the course's instructors; the student-facing procedures read by `ctx.user.sub`; the amount charged is computed on the server; no relaxed default |
| VII. Change freely before launch | Pass | Entities and order fields added outright; no migration, no fallback for orders without discount fields |
| VIII. Repo conventions | Pass | `core-table/src/helpers/coupon-price.ts`, `coupon-code.ts`, `coupon-redemption.ts` (one file per topic); text-only buttons; English docs only |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `enrolment` | Written by the free path (same transaction as order and redemption) | `enrolment-in-published-course`, `completed-at-iff-completed`, `last-activity-at-current`, `student-records-enrolled` | None changed; the free path's course-published check is the one `enrol` uses, and a test proves it. New check ties a zero-total redeemed order to its enrolment |
| `course` | Read: status, price, currency. Not written (a coupon is not a course edit) | `course-has-instructor`, `instructor-course-updated-at`, `enrolment-in-published-course` | None. `instructor-course-updated-at` is untouched because no coupon write changes the course record |
| `order` (#284) | Written with discount fields; status moves on paid, expired, cancelled | #284's own invariants (unpaid users have no access, one enrolment per paid order) | Extend them: a zero-total order is `paid`, so "no access without a paid order" holds for the free path; new check `order-discount-adds-up` |
| `coupon` (new) | Written by instructor-api (create, update, delete) and the claim, confirm and release builders (counter) | none yet | New checks `coupon-count-matches-redemptions`, `coupon-within-limit` |
| `couponRedemption` (new) | Written only by the three builders | none yet | New checks `coupon-redemption-shape`, `coupon-redemption-has-order`, `free-coupon-order-has-enrolment` |
| Stream consumers | `coupon` and `couponRedemption` inserts and modifies must match neither `PROGRESS_STREAM_FILTERS` (itemCompletion and curriculum entities) nor `SEARCH_STREAM_FILTERS` (`course` only) | `progress-stream.test.ts`, `search-stream.test.ts` | Add an assertion to each that coupon and redemption INSERT, MODIFY and REMOVE match neither. The free path's enrolment INSERT behaves as any enrolment's (progress filters ignore it today) |

## Design Decisions (detail in [research.md](./research.md))

1. **One price function.** `priceWithCoupon({ listAmount, currency, coupon })` returns `{ listAmount, discountAmount, totalAmount, isFree }`. Preview, checkout and the free path call it; nothing else computes a discounted price. Percent discounts round down; fixed discounts cap at the list price. It does not know about orders or Stripe, so it survives #284's choices.
2. **Claim, confirm, release as transaction builders.** `core-table/src/helpers/coupon-redemption.ts` exports builders that return the transaction items, to be composed with #284's order write exactly as `studentActivityWrites` is composed with a completion. No procedure writes `coupon.redeemedCount` or a redemption by hand.
3. **Keys.** `coupon`: pk `courseId`, sk `code` (normalised upper case). `couponRedemption`: pk `courseId` + `code`, sk `userId`, so "one per student per code" is the primary key and a code's redemptions are one partition query.
4. **Reservation, then session.** Checkout start claims (order `pending`, redemption `reserved` with `reservedUntil`), then creates the Stripe session for the order's total with a 30-minute expiry, then stores the session on the order. A failure creating the session releases the claim. Paid confirms the redemption; expired, cancelled or replaced releases it.
5. **Zero total skips Stripe.** The claim carries an enrolment create and an order created `paid` with total 0 and a redemption created `redeemed`, in one transaction. A repeat finds the existing redemption and returns the existing enrolment.
6. **Stripe sees only the amount.** The session is a single line for the discounted total (no Stripe coupon objects), so Stripe holds no second copy of the limit; the order holds the breakdown.
7. **Messages by re-read.** A cancelled claim re-reads the coupon and returns the matching message; unknown and other-course codes are the same message.

## Project Structure

### Documentation (this feature)

```text
specs/20261116-013138-coupons-discount-codes/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── instructor-api-coupon.md
│   ├── core-api-coupon-checkout.md
│   ├── order-discount-fields.md
│   └── portal-ui.md
├── checklists/
│   ├── requirements.md
│   └── redemption.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/coupon.ts, coupon-redemption.ts     # new entities (+ index.ts export, service.ts)
│   └── helpers/
│       ├── coupon-code.ts          # normaliseCouponCode(), generateCouponCode() (+ test)
│       ├── coupon-price.ts         # priceWithCoupon(), MIN_CHARGE_MINOR (+ test)
│       ├── coupon-redemption.ts    # claim/confirm/release builders, couponStatus(), refusal messages (+ test)
│       ├── invariants.ts           # coupon and redemption checks (+ tests)
│       └── progress-stream.test.ts, search-stream.test.ts   # coupon records match neither
├── apis/
│   ├── instructor-api/src/
│   │   ├── procedures/coupon.ts    # create, list, update, setEnabled, delete (+ test)
│   │   ├── schema/coupon.ts
│   │   └── router.ts
│   └── core-api/src/
│       ├── procedures/coupon.ts    # preview (+ test)
│       ├── procedures/checkout.ts  # #284's start: couponCode input, claim, free path (+ test)   [file owned by #284]
│       ├── schema/coupon.ts
│       └── router.ts
├── (wherever #284 puts its webhook)  # paid and expired handlers call confirm and release (+ test)
├── websites/
│   ├── instructor-portal/src/routes/_authenticated/my-courses_/$courseId/
│   │   ├── coupons.tsx             # Coupons screen (+ -coupons.test.tsx)
│   │   └── -components/coupons/    # create dialog, row, status badge (+ tests)
│   └── student-portal/src/routes/learn/$courseId/-components/
│       └── coupon-field.tsx        # code field, summary, errors (+ test), used by enrolment-actions.tsx
├── e2e/src/
│   ├── scenarios/coupon.e2e.ts
│   ├── concurrency/coupon-limit.e2e.ts
│   └── helpers/coupon.ts
docs/src/content/docs/en/           # instructor and learner page
```

**Structure Decision**: extend existing packages; no new project. The price function and the builders live in core-table because core-api, instructor-api and the webhook all rely on them (CLAUDE.md "Rules That Span Records").

## Risks

- **R1: #284 lands with different shapes** (order status names, where the webhook lives, how the course price is stored). Mitigation: all coupon logic sits behind `priceWithCoupon` and the three builders, which take plain values; T001 maps the assumed concepts to the merged ones and edits spec Assumptions and the contracts if they differ. Implementation PRs must not start before #284's order entity merged.
- **R2: transaction size and conflict.** The claim is at most 6 items (coupon, redemption, order, course check, enrolment, plus the replaced order's two). Concurrent claims conflict on the coupon item; bounded retry then `CONFLICT`.
- **R3: reservation leak** if a webhook is lost: `reservedUntil` and lazy reclaim (R-5), plus Stripe's own webhook retries.
- **R4: percent rounding and currencies without a minor unit**: one function, table-tested including zero-decimal currencies per #284's price rules.
- **R5: code guessing**: 4 to 24 characters plus the WAF; `coupon.preview` answers unknown and other-course identically.
- **R6: the minimum-charge table** must match the currencies #284 supports; one constant per currency, checked against Stripe's documentation when #284 lands.

## Complexity Tracking

*No constitution violations.*
