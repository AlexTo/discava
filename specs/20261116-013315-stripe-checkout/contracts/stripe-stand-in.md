# Contract: the local Stripe stand-in

Runs in the event runner (`packages/events`, `src/local/stripe-stand-in.ts`) on port 2024 when `LOCAL_DEV=true`; `common-server-utils/local-dev` holds `LOCAL_STRIPE` (the stand-in's accounts and the host and port the `stripe` SDK is pointed at; no key is built in as a secret: keys and signing secrets reach backend code only through the local secrets store, research R-18). Backend code uses the stand-in whenever `isLocalDev()`, as S3 does with S3Mock. State (accounts' endpoints, sessions, payments, refunds) is in memory, except the Connect slice below, which is kept in the git-ignored `tmp/local-dev/stripe-connect.json` so a restart of `pnpm dev` does not strand stored payout accounts.

## Stripe API slice it implements (form-encoded, as the SDK sends)

Requests carry the key as a bearer token. The stand-in knows two accounts: `sk_test_local` is `acct_local` ("Local Stripe Account") and `sk_test_local_2` is `acct_local_2`. Any other key gets a 401 in Stripe's error shape, which is how a rejected key is tested. Each account has its own webhook endpoints and its own signing secrets.

- `GET /v1/account`: returns `{ id, business_profile: { name }, settings: { dashboard: { display_name } } }` for the key's account.
- `POST /v1/webhook_endpoints`: validates `url` and `enabled_events`, creates `{ id, url, enabled_events, status: 'enabled', metadata, secret: 'whsec_<random>' }` and returns the `secret` only in this response, as Stripe does. `GET /v1/webhook_endpoints` lists them (without `secret`); `DELETE /v1/webhook_endpoints/:id` removes one. A key marked "restricted without webhook permission" (`rk_test_local_nowebhook`) gets the permission error from create, so that path is testable.

- `POST /v1/checkout/sessions`: validates `mode=payment`, one line item, `client_reference_id`, `metadata`, `expires_at`, success and cancel URLs, and `adaptive_pricing[enabled]=false` (a session without it is a 400 in Stripe's error shape, so dropping the setting of research R-10 fails locally); returns `{ id, url, expires_at, payment_status: 'unpaid', client_reference_id, metadata, amount_total, currency, payment_intent }`. Honours an `Idempotency-Key` header (same key, same session).
- `GET /v1/payment_intents/:id`: returns `{ id, metadata, amount, currency, status }`.
- `POST /v1/refunds`: for a payment intent, full or partial; honours the idempotency key; then delivers `charge.refunded`.

### Connect slice (instructor payouts)

Added by the instructor-payouts spec (`specs/20261116-013137-instructor-payouts`). Connected accounts, account links and transfers belong to the platform account whose key made them: another key sees `404 resource_missing`, and the restricted key gets a permission error from all of these.

- `POST /v1/accounts` (`type=express`): creates `{ id: 'acct_…', type: 'express', metadata, details_submitted: false, payouts_enabled: false, capabilities: { transfers: 'inactive' } }`; idempotent by `Idempotency-Key`. `GET /v1/accounts/:id` reads it back.
- `POST /v1/account_links` (`account`, `type=account_onboarding`, `return_url`, `refresh_url`): returns the URL of a local onboarding page, `GET /stripe/connect/onboard/:token`, with **Complete** (account becomes active: details submitted, transfers `active`, payouts enabled) and **Leave unfinished** (no change) buttons, text only, both redirecting to `return_url`.
- `POST /v1/accounts/:id/login_links`: returns a URL of a local dashboard page.
- `POST /v1/transfers` (`amount`, `currency`, `destination`, `transfer_group`, `metadata`): idempotent by key; refused in Stripe's invalid-request shape for an unknown destination, one of another platform account, or one whose status is not complete. `GET /v1/transfers?transfer_group=` lists a platform account's transfers, optionally of one group.
- Test controls (`POST`): `/stripe/test/connected-accounts/:id/status` with `{ status: 'in_progress' | 'complete' | 'restricted' }`; `/stripe/test/transfers/fail-next` with `{ mode: 'rejected' | 'idempotency_conflict' | 'timeout' }` (the next transfer request is refused definitely, answers an idempotency conflict, or is created and never answered); `GET /stripe/test/transfers` lists every transfer.

Anything else answers 404 with Stripe's error shape, so a code path that starts to use more of Stripe fails locally rather than silently.

## Hosted page and controls

- `GET /stripe/pay/:sessionId`: a page showing the course title and amount with **Pay**, **Decline card** and **Cancel** buttons (text only). Pay delivers `checkout.session.completed` (`payment_status: paid`) then redirects to `success_url`. Decline shows the card error and stays. Cancel redirects to `cancel_url`. An expired or unknown session shows an "expired" page.
- Test controls for e2e and manual use, each a `POST`: `/stripe/test/replay` (deliver the last event for a session again, optionally N times at once), `/stripe/test/refund` (full or partial, as an operator in the dashboard would), `/stripe/test/expire` (deliver `checkout.session.expired`), `/stripe/test/forge` (deliver a message with a wrong signature or a changed body), `/stripe/test/endpoints` (list what each account has registered, so a test can prove an old registration was removed). They exist only in the stand-in.

## Delivery

Every event is delivered to each endpoint registered for that account whose `enabled_events` include it: a JSON body signed `t=<unix>,v1=<hmac-sha256 of "t.body" with that endpoint's own secret>` and posted to the endpoint's `url`. The URL the platform registers locally is the runner's own `/stripe/webhook`, which calls `handleStripeWebhook`. An account with no endpoint delivers nothing, as Stripe would. A non-2xx answer is retried up to 3 times with a short delay, like Stripe's retries, so a transient failure heals locally too.

## Tests

`stripe-stand-in.test.ts`: both accounts and the 401 for an unknown key; a created endpoint returns its secret once and a signature made with it verifies, one made with another endpoint's does not; delete stops delivery; the restricted key's permission error;  each endpoint's shape against what the `stripe` SDK parses; the signature it produces verifies with `constructEvent`; Pay then redirect; Decline stays; idempotency key reuse; a session created without `adaptive_pricing[enabled]=false` is refused; replay N times; an unknown route is a 404 in Stripe's error shape. The Connect slice: each endpoint's shape against what the SDK parses, idempotency of account and transfer creation, isolation between the two platform accounts, each status and failure control, and state surviving a restart.

## Amendment 2026-11-19: learner refunds

The student's refund request uses `POST /v1/refunds`, which the stand-in already implements. Two additions make it testable:

- `POST /v1/refunds` refuses, in Stripe's error shape, a refund that would take the total refunded above the payment's amount (as Stripe does for a charge already fully refunded). A repeated request with the same idempotency key still returns the first refund and delivers nothing new.
- A test control, `POST /stripe/test/refunds`: lists the refunds made for a payment intent or session, with their amounts, so a test can prove that many requests made one refund.
