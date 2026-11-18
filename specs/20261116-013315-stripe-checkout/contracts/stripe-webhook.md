# Contract: the Stripe webhook

## Endpoint

`POST /stripe/webhook` on the `StripeWebhookApi` (its own API Gateway REST API, `Payments` stack). No authorizer; the stage's WAF and throttling apply; the only method on the API. Stripe is given the URL by an operator once per stage (a `(human)` task). The Lambda proxy event's body is passed to the handler as the exact bytes received (base64-decoded when `isBase64Encoded`), with the `Stripe-Signature` header (any case).

Locally the event runner serves the same path on port 2024 and calls the same `handleStripeWebhook(rawBody, signature)`.

## Verification

`stripe.webhooks.constructEvent(rawBody, signature, webhookSecret, 300)`. Missing header, bad signature, stale timestamp or unparseable body gives **400** and changes nothing. On a signature failure the cached secret is dropped and read once more before answering (a rotated secret).

## Events handled

| Event | Condition | Effect |
|-------|-----------|--------|
| `checkout.session.completed` | `payment_status = 'paid'` | Find the order by `client_reference_id`. Check it exists, `metadata.userId`/`courseId` match it, `amount_total` equals `order.amount` and `currency` equals `order.currency` (case-insensitively); a mismatch is an error log and a **200** with no change. `settleOrderPaid` (which also stores `paymentIntentId`): `fulfilled` or `already-settled` gives 200. `undeliverable`: create a Stripe refund for the payment intent with idempotency key `refund-<orderId>`, then `refundUndeliverable` with reason `duplicate` or `unavailable` |
| `checkout.session.completed` | any other `payment_status` | Ignored, 200 (cards only) |
| `checkout.session.expired` | | `expireOrder` (a no-op unless `pending`) |
| `charge.refunded` | | Retrieve the payment intent for `metadata.orderId`; `refundOrder` with the charge's `amount_refunded`. A refund of an order already `refunded` or an unknown order is a no-op |
| anything else | | Ignored, 200 |

## Responses

| Outcome | Status |
|---------|--------|
| processed, duplicate, ignored, unmatched order (logged), amount mismatch (logged) | 200 |
| bad or missing signature, malformed body | 400 |
| table or Stripe API failure worth retrying (throttling, 5xx, timeout) | 500 |

The body of every response is empty or `{ "received": true }`. Nothing in a response, log line or error reveals the API key, the signing secret or a card detail; log lines carry the event ID, type and order ID.

## Tests

`stripe-webhook.test.ts`, with signed fixtures: every row above; a replay of the same event twice and twice at once yields one fulfilment (the order helper's fake enforces the conditions); `expired` after `completed` changes nothing; a bad signature, a missing header and a body altered after signing are 400 with no writes; an unmatched order and an amount mismatch are 200 with an error logged and no writes; a table error is 500 and the retry succeeds; the automatic refund is requested once with the idempotency key and the order ends `refunded` with the right reason. `stripe-webhook-handler.test.ts`: base64 bodies, header case, the proxy event shape.

## When payments are not connected

The signing secret comes from the secrets service, written by an administrator's save (research R-14). With nothing connected there is no registration at Stripe, so no message arrives; if one still does (a registration removed late, a replayed old message), it fails signature verification and is a 400 like any bad signature. After a switch to another account, a late message signed for the old registration is rejected the same way (spec edge case); it is the cost of the open-checkout rule, which keeps that window to deliveries Stripe retries after a payment that completed in the last hour. The handler does not read the connection record: the signature is the only gate, as before.
