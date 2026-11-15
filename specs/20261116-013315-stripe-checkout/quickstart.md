# Quickstart: Validating Stripe Checkout

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`. No Stripe account is needed locally.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/core-api,@discava/instructor-api,@discava/events,@discava/common-server-utils,@discava/common-web-utils,@discava/student-portal,@discava/instructor-portal
pnpm nx e2e @discava/e2e        # includes payment.e2e.ts, refund.e2e.ts and the webhook replay race
pnpm build                      # includes synth and checkov for the Payments stack and the new secrets
```

## By hand (local stack)

1. `pnpm dev`; sign in as Alice (instructor), create and publish a course with one text lesson. In its settings set the price to 20.00 USD.
2. As Bob (student), open the course page: it shows $20.00 and **Buy now**. Try the free enrol route by hand if you like (the API refuses it). Choose Buy now: the local Stripe page shows the course and the amount.
3. Choose **Decline card**: the page stays with an error. Choose **Cancel**: back on the course with "Payment cancelled". Buy now again: the same payment page opens (no second order).
4. Choose **Pay**: back on the course, "Confirming your payment", then enrolled within seconds. Complete the lesson.
5. Replay the confirmation five times at once (`POST /stripe/test/replay`): Bob is still enrolled once, with the same progress.
6. Refund fully (`POST /stripe/test/refund`): Bob's page says his enrolment has ended and offers Buy now; his lesson completion is still on record. Buy again and pay: he is back with his progress.
7. As Dan, buy, then refund 5.00 only: Dan keeps access.
8. As Alice, set the price to free: new students enrol without paying; Bob and Dan keep access. Set it back to 20.00 and sign in as a student enrolled earlier: still enrolled; a new student must pay.
9. Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## On a deployed stage (needs a Stripe test-mode account)

1. `pnpm nx deploy @discava/infra "discava-development/*"`. In the AWS console or with the CLI, set the two secrets' values (the Stripe test secret key and, after the next step, the webhook signing secret).
2. In the Stripe dashboard (test mode) add a webhook endpoint at the stage's webhook URL (see the stack output) for `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`; copy its signing secret into the second secret.
3. Buy a course with Stripe's test card 4242 4242 4242 4242: enrolled within seconds. Refund it in the dashboard: access ends. Resend the event from the dashboard: nothing changes.
4. Confirm signed-out and signed-in callers cannot read the secrets or reach the webhook's permissions, and that a request to the webhook URL without a signature is refused with 400.

## Expected data afterwards

- One `paid` order per purchase and one enrolment per student and course, the enrolment pointing at its order.
- A fully refunded student's enrolment is `dropped` with its progress intact; after buying again it points at the new order.
- Core-table invariants pass.
