# Quickstart: Validating Revenue Reporting and Payouts

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/instructor-api,@discava/events,@discava/instructor-portal,@discava/common-infra-config
pnpm nx e2e @discava/e2e        # includes earnings.e2e.ts and the double-delivery race
pnpm build                      # includes synth and checkov for the router's stack and the Payouts stack
```

## By hand (local stack)

1. `pnpm dev`. As Alice (instructor), publish a priced course (from the checkout feature).
2. As Bob, buy it with the local Stripe stand-in; as Dan, buy it with a coupon. Within seconds Alice's Earnings page shows two orders, the discount, the fee and the net for the month.
3. Refund part of Bob's order in the stand-in. Refresh: a refund line appears, Refunds and Net change, and gross - discounts - refunds - fee equals net in the row and the total.
4. Show orders on the course row: the lines add up to the row and show no buyer.
5. Set up payouts as Alice (stand-in onboarding): the status becomes Active. Trigger the payout run (`POST` to the event runner's `/payout-run`, with hold days set to 0 for the local stage): a payout shows as Sent. Trigger it again: nothing new.
6. Refund after sending: a negative balance shows as an amount to be deducted from the next payout.
7. Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## On `discava-development` (human)

Complete real Stripe test-mode onboarding, run a test purchase and refund, let the daily schedule (or a manual invoke) run, and confirm the transfer in the Stripe dashboard.

## Expected data afterwards

- One sale entry per instructor per paid order, one refund entry per refund, day summaries equal to their entries, and every core-table invariant passing.
