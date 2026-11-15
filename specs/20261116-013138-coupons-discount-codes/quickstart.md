# Quickstart: Coupons and Discount Codes

Prerequisite: #284 (Stripe checkout) is merged, so a course can have a price. See [contracts/](./contracts/) and [data-model.md](./data-model.md) for shapes.

## Automated (what the agent runs)

```sh
pnpm nx run @discava/core-table:test        # price function, code helpers, claim/confirm/release, invariants
pnpm nx run @discava/instructor-api:test    # coupon procedures
pnpm nx run @discava/core-api:test          # preview, checkout with a code, router
pnpm nx run @discava/instructor-portal:test # Coupons screen
pnpm nx run @discava/student-portal:test    # code field
pnpm nx affected --target build             # includes lint, typecheck, synth
```

PR CI additionally runs `pnpm nx e2e @discava/e2e`, including `coupon.e2e.ts` and `concurrency/coupon-limit.e2e.ts`.

## By hand (a reviewer, local stack: `pnpm dev`)

1. Sign in as Alice (instructor) and give a published course a price. Open its Coupons screen and create `SPRING20` (20% off, no limit) and `FREEBIE` (100% off, limit 2).
2. Sign in as Bob. On the course page enter `spring20` (lowercase): the list price, the 20% discount and the new total show. Remove the code and apply `FREEBIE`: the button reads "Enrol for free". Press it: Bob is enrolled with no payment page.
3. As Dan, apply `FREEBIE` and enrol. As a fourth student, apply it: "used up" (limit 2).
4. As Alice, disable `SPRING20`; a student applying it sees "turned off". Try to delete `FREEBIE`: refused (it has redemptions). Try to lower its limit below 2: refused.
5. With Stripe test mode, start a checkout with `SPRING20`, go back and start again with no code, then try to pay the first Stripe page: it is expired. Then start again with `SPRING20` (Stripe test mode forwarding, per #284's local setup) and pay: the Stripe page shows the discounted total, and after payment the order shows list price, discount and total.
6. Save screenshots of each step, including any failure, to `tmp/screenshots/pr-<number>/`.

## On `discava-development` (a reviewer)

Start a paid checkout with a limited code, abandon it, wait for the 30-minute session expiry, and check the code's count drops by one; confirm a real payment with a code records the discount on the order.
