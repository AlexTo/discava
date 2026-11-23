# Quickstart: Validating Stripe Checkout

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`. No Stripe account is needed locally.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/core-api,@discava/instructor-api,@discava/events,@discava/common-server-utils,@discava/common-web-utils,@discava/student-portal,@discava/instructor-portal
pnpm nx e2e @discava/e2e        # includes payment.e2e.ts, refund.e2e.ts, learner-refund.e2e.ts, leave-course.e2e.ts and the replay and refund-request races
pnpm build                      # includes synth and checkov for the Payments stack and the new secrets
```

## By hand (local stack)

0. `pnpm dev`; sign in as Carol (admin) at the admin portal and open **Payments**. Nothing is connected. Paste `sk_test_local` and choose **Connect Stripe**: the page shows "Connected", "Test mode", "Local Stripe Account" and "Key ending ····ocal". Before this, as Bob try Buy now on any priced course (or as Alice try to set a price): both are refused with "payments aren't set up".
1. Sign in as Alice (instructor), create and publish a course with one text lesson. In its settings set the price to 20.00 USD.
2. As Bob (student), open the course page: it shows $20.00 and **Buy now**. Try the free enrol route by hand if you like (the API refuses it). Choose Buy now: the local Stripe page shows the course and the amount.
3. Choose **Decline card**: the page stays with an error. Choose **Cancel**: back on the course with "Payment cancelled". Buy now again: the same payment page opens (no second order).
4. Choose **Pay**: back on the course, "Confirming your payment", then enrolled within seconds. Complete the lesson.
5. Replay the confirmation five times at once (`POST /stripe/test/replay`): Bob is still enrolled once, with the same progress.
6. Refund fully (`POST /stripe/test/refund`): Bob's page says his enrolment has ended and offers Buy now; his lesson completion is still on record. Buy again and pay: he is back with his progress.
7. As Dan, buy, then refund 5.00 only: Dan keeps access.
8. As Alice, set the price to free: new students enrol without paying; Bob and Dan keep access. Refund Dan's order fully (`POST /stripe/test/refund`): his page says his enrolment has ended and offers **Enrol now**; choose it: he is back without paying, with his progress. Set it back to 20.00 and sign in as a student enrolled earlier: still enrolled; a new student must pay.
9. Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## A student's own refund, and leaving a course (local)

Added by the 2026-11-19 amendment. Continue from the steps above, connected, with Alice's course priced at 20.00 USD and holding at least two items.

1. Signed out, open the course page: under the price it says "14-day refund while you've completed less than half of the course. One refund per course." (amended 2026-11-23)
2. As a new student (the local sign-in page's "Someone else" form), buy the course and complete one item. The course page says "You can request a refund until <date>" and offers **Request a refund**; **Leave course** is not shown.
3. Choose **Request a refund**: the dialog shows $20.00 and says access ends and progress is kept. Confirm. The page says "Refund requested", then within seconds "Your enrolment has ended. Refunded on <date>." with **Buy now**. The notification bell has one "refunded" notification, and the local inbox (`http://localhost:2024/inbox`) has one email.
4. Check `POST /stripe/test/refunds` on the stand-in shows exactly one refund of 2000 for that payment. Replay the refund notice (`POST /stripe/test/replay`): nothing changes and no second notification appears.
5. The page beside **Buy now** says that buying again can't be refunded. Buy again and pay: the completed item is back, no refund action is offered, and the page says "You were refunded for this course before, so this purchase can't be refunded." (amended 2026-11-23)
5a. With a course of four items: as one new student, buy it and complete one item (25%), then request a refund: it is accepted. As another, buy it and complete two items (50%). The page says "Refunds end once you've completed half of the course." Call `payment.requestRefund` by hand straight after the last completion: refused, even before the progress figure updates.
6. Complete every item. The page now says "A course can't be refunded after you have completed it." and offers no button. Call `payment.requestRefund` by hand if you like: refused.
7. As Dan (partly refunded in step 7 above, 5.00), request a refund: the stand-in shows a second refund of 1500, and his order is fully refunded.
8. As Alice, create and publish a free course with two items. As Bob, enrol, complete one item, and choose **Leave course**: the dialog says progress is kept. Confirm: "Your enrolment has ended." with **Enrol now**, and the course is gone from My Learning. Enrol again: the completed item is back.
9. As Alice, give that course a price. As another student who enrolled while it was free, choose **Leave course**: the dialog adds "This course now has a price. To come back you would need to buy it." After leaving, the page offers **Buy now**.
10. Save screenshots of the terms line, both dialogs, the requested state and both ended states to `tmp/screenshots/pr-<number>/`.

The end of the 14 days is covered by unit tests (T089, T090) and is not checked by hand: there is no local setting that shortens it. To see the "refund period ended" text, set the order's `paidAt` back by hand in the local table.

## Connecting, replacing and disconnecting (local)

1. As Carol, with Bob's checkout open (step 2 above, unpaid), paste `sk_test_local_2` (a different account) and save: refused with the time the open checkout ends. Paste `sk_test_local` again as a rotation: allowed, and Bob's open checkout still completes.
2. Paste `sk_bad`: "Stripe rejected this key", nothing changes. Paste `rk_test_local_nowebhook`: "This key can't create webhook endpoints", nothing changes. Check `GET /stripe/test/endpoints` shows exactly one endpoint for `acct_local`.
3. With `LOCAL_CHECKOUT_TTL_SECONDS=30 pnpm dev` (local only: shortens a checkout's life so this step needn't wait an hour), after the open checkout's 30 seconds have passed, save `sk_test_local_2`: allowed, the old endpoint disappears from `acct_local`, a new one appears on `acct_local_2`, and a confirmation signed for the old registration is rejected (`/stripe/test/forge`).
4. **Disconnect**: Buy now shows "Payments are unavailable right now"; Alice cannot set a price; prices already set remain; Bob (already paid) keeps access.
5. As Alice or Bob open `/payments` in the admin portal's URL: refused.
6. `pnpm nx run @discava/common-scripts:reset-local-data` (with `pnpm dev` stopped) removes `tmp/local-dev/secrets/` too, so a restart is disconnected again.

## On a deployed stage (needs a Stripe test-mode account)

1. `pnpm nx deploy @discava/infra "discava-development/*"`. Nothing is set in the AWS console: no secret values and no Stripe webhook.
2. Sign in to the stage's admin portal as an administrator, open **Payments**, and paste a Stripe test-mode secret key (a restricted key with the documented permissions, or the test secret key). The page shows Connected, Test mode and your account. In the Stripe dashboard (test mode) the stage's endpoint now exists for `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`.
3. Buy a course with Stripe's test card 4242 4242 4242 4242: enrolled within seconds. Refund it in the dashboard: access ends. Resend the event from the dashboard: nothing changes.
3a. (amendment 2026-11-19) Buy again with the test card, then choose **Request a refund** on the course page: the refund appears in the Stripe dashboard within seconds with no dashboard step, access ends, and the refund email arrives. Leave a free course and enrol again.
4. Confirm signed-out and signed-in callers cannot read the secrets or reach the webhook's permissions, that a request to the webhook URL without a signature is refused with 400, that an instructor and a student calling the admin payment procedures get `FORBIDDEN`, and that the checkout and webhook functions cannot call `PutSecretValue` (read their roles).
5. Replace the key with a rolled key for the same account: payments keep working. Switch to a different test account (after open checkouts end): the old endpoint is gone from the first account's dashboard.

## Expected data afterwards

- One `paid` order per purchase and one enrolment per student and course, the enrolment pointing at its order.
- A fully refunded student's enrolment is `dropped` with its progress intact; after buying again it points at the new order; after enrolling again in a course set to free it is restored with no `orderId`.
- A student's own refund leaves the same records as an operator's, plus `refundRequestedAt` on the order; a `paid` order with `refundRequestedAt` and an `active` enrolment exists only for the seconds before the confirmation arrives.
- A student who left has a `dropped` enrolment with no `orderId` and its progress intact; no `dropped` enrolment rests on a `paid` order.
- One `order.refunded` notification per fully refunded order that ended an enrolment.
- Core-table invariants pass.
