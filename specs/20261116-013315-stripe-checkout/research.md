# Research: Stripe Checkout for Paid Courses

## R-1: Idempotence by order state, not by event log

**Decision**: Every handler move is a conditional write on the order's current status: `pending` to `paid`, `expired` or `refunded`; `paid` to `refunded`. A repeated message finds the order already moved, does nothing, and the endpoint still answers 200. No table of processed Stripe event IDs.

**Rationale**: The state conditions are needed anyway (they are what stops two concurrent deliveries both enrolling), so an event-ID table would be a second write that cannot replace them. It would also need a TTL and a cleanup story. State-based moves also tolerate Stripe delivering events out of order (an `expired` after `completed` finds a paid order and changes nothing).

**Alternatives**: a `stripeEvent` entity keyed by event ID, written first in a transaction with the order change (exact replay detection, but extra writes, a TTL, and still needs state checks for reordering); relying on Stripe's retry semantics alone (no protection against concurrent delivery).

## R-2: Fulfilment as one transaction

**Decision**: `settleOrderPaid` reads the order, the enrolment and the course, then writes in one `transactWrite`: order `pending` to `paid` (condition: status is `pending`), the enrolment (create with `orderId` conditioned on not existing; or, for a `dropped` one, patch status to `completed` if it has `completedAt` else `active`, set `orderId`, conditioned on status `dropped`), and a check that the course is `published`. A cancelled transaction is re-read and decided again (at most three times); a lost race on the order means someone else fulfilled it, so it returns.

**Rationale**: Exactly-once across the order and the enrolment needs both to commit together: a crash between two separate writes would leave a paid student without access, or an enrolment without a paid order. It is the shape `course.enrol` already uses.

**Alternatives**: a stream handler on the order's `paid` change creating the enrolment (a third consumer of the table stream, new filter and event-source wiring, a window where the order is paid and the student is not enrolled, repair logic); creating the enrolment first and the order second (the unpaid-access window the invariant forbids).

## R-3: A refund ends the enrolment with `dropped`

**Decision**: A full refund runs one transaction: order `paid` to `refunded` (with `refundedAt`, `refundedAmount`, reason `requested`), and the enrolment to `dropped`, conditioned on its `orderId` being this order. `completedAt`, `progressPercent`, item completions and certificates stay. Re-purchase restores the same record (R-2).

**Rationale**: `dropped` is already honoured by every reader. A new flag or status would need a check added to each of: `requireEnrolment`, `my-enrolments`, the recalculation, the activity writes, the portal actions, and the announcement and notification audiences in the in-flight specs. The cost is two widened invariants (below), which is smaller and in one file.

**Alternatives**: a new `revoked` status (a new state every reader must learn, and the `completed-at-iff-completed` check still needs widening); an `accessRevokedAt` attribute beside the status (same fan-out of checks); deleting the enrolment (loses progress and breaks `student-records-enrolled`, which expects records to keep an enrolment).

**Invariant widening**: `completed-at-iff-completed` for enrolments becomes: `completed` requires `completedAt`; `completedAt` requires `completed` or `dropped`. `certificate-has-completed-enrolment` accepts an enrolment that is `completed`, or `dropped` with the same `completedAt`. Both keep every existing breaking test and gain tests for the newly accepted and newly refused cases.

**Partial refunds** only add to `refundedAmount` (never lower it) and leave access alone. **Disputes** are not handled.

## R-4: Undeliverable payments are refunded automatically

**Decision**: When a paid session arrives for an order that cannot be fulfilled (the student already has a non-`dropped` enrolment from another order, or the course is not `published` or is gone), the handler calls Stripe `refunds.create` for the payment with idempotency key `refund-<orderId>`, then moves the order `pending` to `refunded` with `refundReason` `duplicate` or `unavailable`, keeping `paidAt`. A crash between the two steps retries both safely (Stripe returns the same refund; the order move is conditional). The `charge.refunded` event this causes finds the order already `refunded` and does nothing.

**Rationale**: "Exactly once per paid order" must also cover the duplicate-payment case, and silently keeping the student's money for a product they cannot receive is wrong. A refund is the conventional answer and needs no human.

**Alternatives**: leave it `paid` and flag for review (needs an operator and a queue that does not exist); a lock record to make a second checkout impossible (an extra conditional-put entity and a lease to expire, and still cannot stop a payment already in flight; the refund path is needed regardless); block the second checkout by checking for an open order (done: `findOpenOrder` reuse reduces duplicates, but cannot close the race).

## R-5: Where the webhook lives

**Decision**: A standalone Lambda in `packages/events` (`src/payments/stripe-webhook-handler.ts`) behind a new `StripeWebhookApi` construct: one REST API, one `POST /stripe/webhook` method with no authorizer, the stage's WAF and throttling, default hardened. It has its own stack, `Payments`, ordered after `Data`. Its role has table read/write, the two secrets' read, and nothing else.

**Rationale**: Stripe cannot send a Cognito token and signs the raw body; core-api's router parses and validates tRPC calls. A separate function keeps the signed-in code free of the webhook's permissions and the signing secret (FR-021, constitution VI). The webhook function holds the table's write access that fulfilment needs, which is why it is not part of core-api's shared router.

**Alternatives**: a Lambda function URL (no WAF in front); adding a non-tRPC route to core-api's API (shares the API's custom domain and throttling but couples a public route to the signed-in API's construct and its dedicated-function bookkeeping); EventBridge's Stripe partner event source (needs a partner-event-source setup per account and region, and a local equivalent; not the "one way to deploy" this repo wants); an HTTP API (no WAF association).

**Generators**: `ts#lambda-function` generates the handler wrapper in `packages/events`; nothing generates this API Gateway shape (Constitution II, plan table).

## R-6: Secrets

**Decision**: Two Secrets Manager secrets in the `Data` stack: `StripeApiKey` (the restricted secret key) and `StripeWebhookSigningSecret`. CDK creates them empty; an operator sets the values once per stage (a `(human)` task, documented). KMS-encrypted per stage config. Read at runtime with the AWS SDK and cached in the Lambda for its lifetime (about 5 minutes with a refresh on a signature failure, so a rotated webhook secret is picked up). The checkout function reads only the API key; the webhook function reads both. Secret names reach functions as environment variables holding ARNs, never values.

**Rationale**: Issue requirement; two secrets give least privilege. Reading at runtime (not resolving into CloudFormation or Lambda environment values) keeps values out of templates and logs.

**Alternatives**: one JSON secret (the checkout function could read the webhook secret); SSM SecureString parameters (cheaper, but the issue names Secrets Manager); `SecretValue.unsafePlainText` or env vars (values in the template or console).

## R-7: The local Stripe stand-in

**Decision**: `packages/events/src/local/stripe-stand-in.ts`, mounted in the event runner (port 2024). It implements, over HTTP and form-encoded like Stripe: `POST /v1/checkout/sessions`, `GET /v1/payment_intents/:id`, `POST /v1/refunds`; a hosted page at `/stripe/pay/:sessionId` with Pay, Decline and Cancel buttons; webhook delivery to the same `handleStripeWebhook` function the deployed Lambda wraps, signed with `Stripe-Signature` using the local webhook secret; and test controls (`POST /stripe/test/...`) to replay an event, refund, expire a session, and send a bad-signature message. Sessions and payments are held in memory (documented: restarting `pnpm dev` loses open checkouts; an open local order is closed by its `expiresAt`). The `stripe` SDK is pointed at it with host, port and protocol settings from `common-server-utils/local-dev`.

**Rationale**: Constitution III. The in-repo pattern is a stand-in per AWS service run by the event runner or a Docker container (OIDC, S3Mock). Running the real handler locally means local e2e exercises signature verification and fulfilment, not a fake of them. In memory is enough: checkouts live an hour and a stuck local order is the same as an expired one.

**Alternatives**: `stripe-mock` Docker image (stubs API responses, no hosted page and no webhooks, so nothing to click or deliver); the Stripe CLI `listen --forward-to` against Stripe's test mode (needs a Stripe account, network and a human, so it cannot run in CI; kept as the documented deployed/optional route); a hosted-page-free "auto-pay" mode (cannot test cancel, decline or expiry in a browser).

## R-8: Price handling

**Decision**: `priceAmount` is an integer in minor units; `priceCurrency` one of USD, EUR, GBP, AUD, CAD. One module, `common-web-utils/price`, owns the currency list, the bounds (0, or 100 to 1,000,000), `validatePrice`, `parsePriceInput` (a typed "19.99" to 1999 without floating point arithmetic: split on the decimal point) and `formatPrice` (`Intl.NumberFormat` with the currency, dividing by 100 by string positions or `amount / 100` for display only). Orders keep `listAmount` (the course's price when the checkout started) and `amount` (what is charged; equal in this feature).

**Rationale**: Floating point never touches stored or compared money. One module avoids the portals and APIs disagreeing on the list. Two amounts on the order is what coupons (#285) need without reshaping.

**Alternatives**: decimal strings (needs parsing everywhere); a `Money` object attribute (ElectroDB maps and `.where` conditions on nested fields are clumsy); more currencies or zero- and three-decimal ones (each needs its own exponent and Stripe rules; deferred).

## R-9: Grandfathering free enrolments

**Decision**: `course.pricedAt` is set when `priceAmount` changes from zero to non-zero and removed when it returns to zero (a price change between two non-zero values leaves it). The `paid-course-enrolment-paid` invariant: for a course with `priceAmount > 0`, an enrolment with no `orderId` must have `createdAt` at most `pricedAt` plus 10 seconds. The same transaction that creates a free enrolment checks the course's `priceAmount` is `0`, so a free enrolment cannot be created after the price becomes non-zero, apart from the clock skew between two Lambdas.

**Rationale**: The issue asks for an invariant that unpaid users cannot hold paid content, and free-then-paid courses are normal. A time marker on the course lets the check be pure data, with no flag on each enrolment.

**Alternatives**: `source: 'free' | 'paid'` on the enrolment (cannot tell whether free was legitimate at the time, so checks nothing); a price version counter checked in the enrolment transaction (exact, but an extra attribute and condition on every enrolment for a rare case); no grandfathering (breaks existing students when a price is set).

## R-10: Checkout session settings

**Decision**: `mode: 'payment'`, `payment_method_types: ['card']`, one line item (name: course title, `unit_amount` = order amount, currency = order currency, quantity 1), `client_reference_id` = orderId, `metadata` = `{ orderId, userId, courseId }` on both the session and `payment_intent_data`, `expires_at` = now + 1 hour, `success_url` = `<origin>/learn/<courseId>?checkout=success`, `cancel_url` = `<origin>/learn/<courseId>?checkout=cancelled`, `customer_email` omitted (Stripe asks). The origin comes from `getAllowedOrigin` on the request, which only returns an origin on the stage's CORS allow-list, so a caller cannot make Stripe redirect elsewhere. An idempotency key of the order ID is sent on session creation.

**Rationale**: Cards confirm at once, so `checkout.session.completed` is always final (Clarifications). Metadata on the payment intent lets `charge.refunded` find the order with one `payment_intents.retrieve`. The allowed-origin rule is the same one the PDF's verification URL uses in the certificates plan.

**Alternatives**: Stripe Prices and Products created per course (extra objects to keep in step with the course and its changing price, and orders need the snapshot anyway); `customer` objects (not needed until receipts or saved cards).

## R-11: Handling the webhook's outcomes

**Decision**: `handleStripeWebhook(rawBody, signature)` verifies with `stripe.webhooks.constructEvent` (raw body, signature header, the secret, a five-minute tolerance), then routes on `event.type`: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`; anything else is acknowledged. Responses: 400 for a missing or bad signature or malformed body (Stripe does not retry meaningfully and an attacker learns nothing), 200 for processed, duplicate, ignored and unmatched, 500 for a failure worth retrying (table throttling or errors, Stripe API errors during an automatic refund). An unmatched order logs an error with the session ID and returns 200.

**Rationale**: Stripe retries on non-2xx for up to three days, so 5xx is "try again" and everything final is 2xx. The body is passed as the exact bytes API Gateway received (base64-decoded when flagged), because any re-serialisation breaks the signature.

## R-12: Return page

**Decision**: The success URL's `?checkout=success` shows "Confirming your payment" and polls `course.myEnrolment` every 2 s for up to 60 s, then shows a retry message that says the payment is not lost and to refresh in a minute, never a second Buy now while a paid order may be in flight. It trusts only the enrolment the API returns, so editing the URL changes only the message.

**Rationale**: One fulfilment path (Clarifications). The 60 s is twice the 30 s success criterion.

## R-13: Enrol refusal wording and codes

**Decision**: `course.enrol` on a published priced course throws `PRECONDITION_FAILED` "This course must be purchased". Draft, archived or missing stays `NOT_FOUND`. `payment.checkout` on a free course throws `BAD_REQUEST` "This course is free; enrol instead"; for an already-enrolled student, `CONFLICT` "You are already enrolled in this course".

**Rationale**: The portal can tell "buy instead" from "not found" by code, as `enrolErrorMessage` already does for other codes.
