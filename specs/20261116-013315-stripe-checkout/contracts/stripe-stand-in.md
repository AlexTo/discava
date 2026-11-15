# Contract: the local Stripe stand-in

Runs in the event runner (`packages/events`, `src/local/stripe-stand-in.ts`) on port 2024 when `LOCAL_DEV=true`; `common-server-utils/local-dev` holds `LOCAL_STRIPE` (the keys `sk_test_local` and `whsec_local`, and the host and port the `stripe` SDK is pointed at). Backend code uses the stand-in whenever `isLocalDev()`, as S3 does with S3Mock. State (sessions, payments, refunds) is in memory.

## Stripe API slice it implements (form-encoded, as the SDK sends)

- `POST /v1/checkout/sessions`: validates `mode=payment`, one line item, `client_reference_id`, `metadata`, `expires_at`, success and cancel URLs; returns `{ id, url, expires_at, payment_status: 'unpaid', client_reference_id, metadata, amount_total, currency, payment_intent }`. Honours an `Idempotency-Key` header (same key, same session).
- `GET /v1/payment_intents/:id`: returns `{ id, metadata, amount, currency, status }`.
- `POST /v1/refunds`: for a payment intent, full or partial; honours the idempotency key; then delivers `charge.refunded`.

Anything else answers 404 with Stripe's error shape, so a code path that starts to use more of Stripe fails locally rather than silently.

## Hosted page and controls

- `GET /stripe/pay/:sessionId`: a page showing the course title and amount with **Pay**, **Decline card** and **Cancel** buttons (text only). Pay delivers `checkout.session.completed` (`payment_status: paid`) then redirects to `success_url`. Decline shows the card error and stays. Cancel redirects to `cancel_url`. An expired or unknown session shows an "expired" page.
- Test controls for e2e and manual use, each a `POST`: `/stripe/test/replay` (deliver the last event for a session again, optionally N times at once), `/stripe/test/refund` (full or partial, as an operator in the dashboard would), `/stripe/test/expire` (deliver `checkout.session.expired`), `/stripe/test/forge` (deliver a message with a wrong signature or a changed body). They exist only in the stand-in.

## Delivery

Every event is a JSON body signed `t=<unix>,v1=<hmac-sha256 of "t.body" with the local webhook secret>` and posted to the runner's own `/stripe/webhook`, which calls `handleStripeWebhook`. A non-2xx answer is retried up to 3 times with a short delay, like Stripe's retries, so a transient failure heals locally too.

## Tests

`stripe-stand-in.test.ts`: each endpoint's shape against what the `stripe` SDK parses; the signature it produces verifies with `constructEvent`; Pay then redirect; Decline stays; idempotency key reuse; replay N times; an unknown route is a 404 in Stripe's error shape.
