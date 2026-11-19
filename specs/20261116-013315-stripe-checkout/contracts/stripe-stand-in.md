# Contract: the local Stripe stand-in

Runs in the event runner (`packages/events`, `src/local/stripe-stand-in.ts`) on port 2024 when `LOCAL_DEV=true`; `common-server-utils/local-dev` holds `LOCAL_STRIPE` (the stand-in's accounts and the host and port the `stripe` SDK is pointed at; no key is built in as a secret: keys and signing secrets reach backend code only through the local secrets store, research R-18). Backend code uses the stand-in whenever `isLocalDev()`, as S3 does with S3Mock. State (accounts' endpoints, sessions, payments, refunds) is in memory.

## Stripe API slice it implements (form-encoded, as the SDK sends)

Requests carry the key as a bearer token. The stand-in knows two accounts: `sk_test_local` is `acct_local` ("Local Stripe Account") and `sk_test_local_2` is `acct_local_2`. Any other key gets a 401 in Stripe's error shape, which is how a rejected key is tested. Each account has its own webhook endpoints and its own signing secrets.

- `GET /v1/account`: returns `{ id, business_profile: { name }, settings: { dashboard: { display_name } } }` for the key's account.
- `POST /v1/webhook_endpoints`: validates `url` and `enabled_events`, creates `{ id, url, enabled_events, status: 'enabled', metadata, secret: 'whsec_<random>' }` and returns the `secret` only in this response, as Stripe does. `GET /v1/webhook_endpoints` lists them (without `secret`); `DELETE /v1/webhook_endpoints/:id` removes one. A key marked "restricted without webhook permission" (`rk_test_local_nowebhook`) gets the permission error from create, so that path is testable.

- `POST /v1/checkout/sessions`: validates `mode=payment`, one line item, `client_reference_id`, `metadata`, `expires_at`, success and cancel URLs, and `adaptive_pricing[enabled]=false` (a session without it is a 400 in Stripe's error shape, so dropping the setting of research R-10 fails locally); returns `{ id, url, expires_at, payment_status: 'unpaid', client_reference_id, metadata, amount_total, currency, payment_intent }`. Honours an `Idempotency-Key` header (same key, same session).
- `GET /v1/payment_intents/:id`: returns `{ id, metadata, amount, currency, status }`.
- `POST /v1/refunds`: for a payment intent, full or partial; honours the idempotency key; then delivers `charge.refunded`.

Anything else answers 404 with Stripe's error shape, so a code path that starts to use more of Stripe fails locally rather than silently.

## Hosted page and controls

- `GET /stripe/pay/:sessionId`: a page showing the course title and amount with **Pay**, **Decline card** and **Cancel** buttons (text only). Pay delivers `checkout.session.completed` (`payment_status: paid`) then redirects to `success_url`. Decline shows the card error and stays. Cancel redirects to `cancel_url`. An expired or unknown session shows an "expired" page.
- Test controls for e2e and manual use, each a `POST`: `/stripe/test/replay` (deliver the last event for a session again, optionally N times at once), `/stripe/test/refund` (full or partial, as an operator in the dashboard would), `/stripe/test/expire` (deliver `checkout.session.expired`), `/stripe/test/forge` (deliver a message with a wrong signature or a changed body), `/stripe/test/endpoints` (list what each account has registered, so a test can prove an old registration was removed). They exist only in the stand-in.

## Delivery

Every event is delivered to each endpoint registered for that account whose `enabled_events` include it: a JSON body signed `t=<unix>,v1=<hmac-sha256 of "t.body" with that endpoint's own secret>` and posted to the endpoint's `url`. The URL the platform registers locally is the runner's own `/stripe/webhook`, which calls `handleStripeWebhook`. An account with no endpoint delivers nothing, as Stripe would. A non-2xx answer is retried up to 3 times with a short delay, like Stripe's retries, so a transient failure heals locally too.

## Tests

`stripe-stand-in.test.ts`: both accounts and the 401 for an unknown key; a created endpoint returns its secret once and a signature made with it verifies, one made with another endpoint's does not; delete stops delivery; the restricted key's permission error;  each endpoint's shape against what the `stripe` SDK parses; the signature it produces verifies with `constructEvent`; Pay then redirect; Decline stays; idempotency key reuse; a session created without `adaptive_pricing[enabled]=false` is refused; replay N times; an unknown route is a 404 in Stripe's error shape.
