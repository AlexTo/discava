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

**Free restore** (amendment 2026-11-19, PR review): a refund is the first writer of `dropped`, and `course.enrol` returns an existing enrolment whatever its status. So a refunded student whose course was later set to free would get the `dropped` record back from `enrol`, be refused by `requireEnrolment`, and be refused by `payment.checkout` (the course is free): no way in, against US3 scenario 2. `course.enrol` therefore restores a `dropped` enrolment through `restoreFreeEnrolment`, in one transaction with the course check `published` and `priceAmount = 0` (so a price set at the same moment cannot be raced, as FR-004 asks of a new enrolment), to `completed` if it has `completedAt` else `active`, removing `orderId` so `enrolment-order-matches` holds (an enrolment naming a `refunded` order must be `dropped`). `paid-course-enrolment-paid` still holds if the course is priced again: the enrolment's `createdAt` is older than the new `pricedAt`, which is the same grandfathering any free student gets. A payment still in flight for an order opened at the old price finds the restored enrolment and is refunded as `duplicate` (R-4). Rejected: stating the lock-out as intended (the student keeps progress they can never reach, in a course anyone else may enter for free); deleting the `dropped` enrolment so the create succeeds (loses `completedAt` and progress, and breaks `certificate-has-completed-enrolment`).

**Leaving** (amendment 2026-11-19): a refund is no longer the only writer of `dropped`. A student may leave an enrolment that has no order (R-22), by a write in the same file with the same shape, so the widened invariants above already accept it and no reader changes. What still holds, and is now the rule that matters: an enrolment with an `orderId` reaches `dropped` only through this transaction.

**Partial refunds** only add to `refundedAmount` (never lower it) and leave access alone. **Disputes** are not handled.

## R-4: Undeliverable payments are refunded automatically

**Decision**: When a paid session arrives for an order that cannot be fulfilled (the student already has a non-`dropped` enrolment from another order, the course is not `published` or is gone, or the session's student, course, amount or currency differ from the order's), the handler calls Stripe `refunds.create` for the payment with idempotency key `refund-<orderId>`, then moves the order `pending` to `refunded` with `refundReason` `duplicate`, `unavailable` or `mismatch`, keeping `paidAt`. A crash between the two steps retries both safely (Stripe returns the same refund; the order move is conditional). The `charge.refunded` event this causes finds the order already `refunded` and does nothing.

**A session that does not match its order** (amendment 2026-11-19, PR review) was first specified as an error log and a 200 with no change. That is wrong: the event has passed `constructEvent`, so it is a genuine payment, and the student would be charged with no enrolment, no refund and no retry. It is now a third undeliverable reason, `mismatch`, decided before `settleOrderPaid` is called: the handler refunds the payment intent in full (no `amount`, so the refund is right in whatever currency Stripe charged) and moves the order to `refunded`. A mismatch should not happen with the session settings of R-10 (the amount and currency are the order's and Adaptive Pricing is off); the refund is the guarantee that holds if a setting is lost, the account's defaults change, or #285's discount path computes a different amount.

**Rationale**: "Exactly once per paid order" must also cover the duplicate-payment case, and silently keeping the student's money for a product they cannot receive is wrong. A refund is the conventional answer and needs no human.

**Alternatives**: leave it `paid` and flag for review (needs an operator and a queue that does not exist); a lock record to make a second checkout impossible (an extra conditional-put entity and a lease to expire, and still cannot stop a payment already in flight; the refund path is needed regardless); block the second checkout by checking for an open order (done: `findOpenOrder` reuse reduces duplicates, but cannot close the race).

## R-5: Where the webhook lives

**Decision**: A standalone Lambda in `packages/events` (`src/payments/stripe-webhook-handler.ts`) behind a new `StripeWebhookApi` construct: one REST API, one `POST /stripe/webhook` method with no authorizer, the stage's WAF and throttling, default hardened. It has its own stack, `Payments`, ordered after `Data`. Its role has table read/write, the two secrets' read, and nothing else.

**Rationale**: Stripe cannot send a Cognito token and signs the raw body; core-api's router parses and validates tRPC calls. A separate function keeps the signed-in code free of the webhook's permissions and the signing secret (FR-021, constitution VI). The webhook function holds the table's write access that fulfilment needs, which is why it is not part of core-api's shared router.

**Alternatives**: a Lambda function URL (no WAF in front); adding a non-tRPC route to core-api's API (shares the API's custom domain and throttling but couples a public route to the signed-in API's construct and its dedicated-function bookkeeping); EventBridge's Stripe partner event source (needs a partner-event-source setup per account and region, and a local equivalent; not the "one way to deploy" this repo wants); an HTTP API (no WAF association).

**Generators**: `ts#lambda-function` generates the handler wrapper in `packages/events`; nothing generates this API Gateway shape (Constitution II, plan table).

## R-6: Secrets (amended 2026-11-18: written by an administrator at run time)

**Decision**: Two Secrets Manager secrets in the `Data` stack, as before: `StripeApiKey` and `StripeWebhookSigningSecret`. The deployment creates them but no operator fills them: an administrator's save does (R-14). They are KMS-encrypted per stage config. Read at runtime with the AWS SDK and cached in the Lambda for about 5 minutes; a signature failure drops the webhook secret cache and retries once, and a Stripe authentication error drops the key cache and retries once, so a rotated value is picked up at once. The checkout function reads only the API key; the webhook function reads both; only the admin-only connect function (R-14) may write either, and it also reads the API key to remove the old registration. Secret ARNs reach functions as environment variables, never values. CDK's default generated value in a new secret is never used: readers check the connection record (R-15) before they trust a secret, and a webhook verified against the generated value fails its signature.

**Rationale**: Issue requirement and FR-017: values stay out of code, config, templates and logs. Two secrets keep the signing secret away from the checkout function: a function that could read it could forge a paid confirmation and enrol a student for free.

**Alternatives**: one JSON secret (the checkout function could read the signing secret); SSM SecureString parameters (cheaper, but the issue names Secrets Manager); storing the key in the table (a table read would expose it to every function with table access, including signed-in APIs); `SecretValue.unsafePlainText` or env vars (values in the template or console); an operator setting the values at deploy time (the original design, replaced because the owner wants administrators to manage Stripe without a deployment).

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

**Decision**: `mode: 'payment'`, `payment_method_types: ['card']`, one line item (name: course title, `unit_amount` = order amount, currency = order currency, quantity 1), `client_reference_id` = orderId, `metadata` = `{ orderId, userId, courseId }` on both the session and `payment_intent_data`, `expires_at` = now + 1 hour, `adaptive_pricing: { enabled: false }` (amendment 2026-11-19), `success_url` = `<origin>/learn/<courseId>?checkout=success`, `cancel_url` = `<origin>/learn/<courseId>?checkout=cancelled`, `customer_email` omitted (Stripe asks). The origin comes from `getAllowedOrigin` on the request, which only returns an origin on the stage's CORS allow-list, so a caller cannot make Stripe redirect elsewhere. An idempotency key of the order ID is sent on session creation.

**Rationale**: Cards confirm at once, so `checkout.session.completed` is always final (Clarifications). Adaptive Pricing, when an account has it on, lets a payer be charged in their local currency, and the session's `amount_total` and `currency` then describe that presentment charge instead of the order's; it is switched off on every session so the webhook's comparison with the order is always valid, whatever the account's default. A session that differs anyway is refunded (R-4). Metadata on the payment intent lets `charge.refunded` find the order with one `payment_intents.retrieve`. The allowed-origin rule is the same one the PDF's verification URL uses in the certificates plan.

**Alternatives**: Stripe Prices and Products created per course (extra objects to keep in step with the course and its changing price, and orders need the snapshot anyway); `customer` objects (not needed until receipts or saved cards).

## R-11: Handling the webhook's outcomes

**Decision**: `handleStripeWebhook(rawBody, signature)` verifies with `stripe.webhooks.constructEvent` (raw body, signature header, the secret, a five-minute tolerance), then routes on `event.type`: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`; anything else is acknowledged. Responses: 400 for a missing or bad signature or malformed body (Stripe does not retry meaningfully and an attacker learns nothing), 200 for processed, duplicate, ignored and unmatched, and for a session that does not match its order once it has been refunded (R-4), 500 for a failure worth retrying (table throttling or errors, Stripe API errors during an automatic refund). An unmatched order logs an error with the session ID and returns 200.

**Rationale**: Stripe retries on non-2xx for up to three days, so 5xx is "try again" and everything final is 2xx. The body is passed as the exact bytes API Gateway received (base64-decoded when flagged), because any re-serialisation breaks the signature.

## R-12: Return page

**Decision**: The success URL's `?checkout=success` shows "Confirming your payment" and polls `course.myEnrolment` every 2 s for up to 60 s, then shows a retry message that says the payment is not lost and to refresh in a minute, never a second Buy now while a paid order may be in flight. It trusts only the enrolment the API returns, so editing the URL changes only the message.

**Rationale**: One fulfilment path (Clarifications). The 60 s is twice the 30 s success criterion.

## R-13: Enrol refusal wording and codes

**Decision**: `course.enrol` on a published priced course throws `PRECONDITION_FAILED` "This course must be purchased". Draft, archived or missing stays `NOT_FOUND`. `payment.checkout` on a free course throws `BAD_REQUEST` "This course is free; enrol instead"; for an already-enrolled student, `CONFLICT` "You are already enrolled in this course".

**Rationale**: The portal can tell "buy instead" from "not found" by code, as `enrolErrorMessage` already does for other codes.

## R-14: The administrator's connect flow

**Decision**: `payment.connect({ secretKey })` on admin-api (R-19), served by a dedicated function that alone may write the two secrets. In order: (1) check the key's shape (`sk_` or `rk_` with `test_` or `live_`; a `pk_` key gets its own message) and read the mode from the prefix; (2) call Stripe `accounts.retrieve()` with it, which fails for a bad key and gives the account ID and name; (3) read the connection record (R-15) and decide: **same account** (rotation) writes only the new key and updates the record (the existing registration and signing secret stay valid, so rotation is one atomic write); **new account or first connection** takes the change lease (R-16), deletes any leftover endpoint of ours at the same URL (a crashed earlier attempt), calls `webhookEndpoints.create` with the platform's public webhook URL, the API version the SDK is pinned to, exactly `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`, and metadata naming the stage, writes the returned signing secret then the key, then marks the record active and releases the lease; (4) for a switch, deletes the old endpoint with the old key (best effort: failure is logged and shown as a warning, never undoes the change). `payment.disconnect` takes the lease (same open-checkout rule), deletes the endpoint with the stored key (best effort), overwrites both secrets with a placeholder, marks the record `disconnected`. Every outcome writes a `paymentChange` row (R-16). Stripe's error text is mapped to a short message for the page ("Stripe rejected this key", "This key lacks permission to create webhook endpoints", "Couldn't register the confirmation address") and never echoes the key.

**Rationale**: One pasted value (FR-024). Registering ourselves removes the dashboard step that the signing secret needed, and `webhookEndpoints.create` is the only moment Stripe reveals the signing secret. Rotation touching one secret keeps FR-026 free of ordering problems.

**Alternatives**: the administrator pastes the key and the signing secret (two values, a dashboard step, and no way to check the endpoint is registered); storing the key and re-registering on every save (the signing secret changes under in-flight confirmations, breaking FR-026); Stripe's OAuth-style Connect onboarding for the platform account (not offered for an account's own keys).

**Open point for implementation**: whether a *restricted* key can call `accounts.retrieve()` and `webhookEndpoints.create`. The save treats a permission error as "this key lacks permission" without guessing; T-tasks confirm against Stripe's test mode with a restricted key and document the permission list.

## R-15: Connection record and the open-checkout window

**Decision**: A singleton `paymentConnection` record in the core table holds the non-secret facts: `status` (`active`, `changing`, `disconnected`; absent until the first save), `mode`, `accountId`, `accountName`, `keyLast4`, `webhookEndpointId`, `webhookUrl`, `latestCheckoutExpiresAt`, `leaseUntil`, `changedBy`, `changedAt`. Starting a checkout is one transaction: a condition that the record is `active`, the order Put, and an update of `latestCheckoutExpiresAt` to the larger of itself and the new order's `expiresAt` (conditioned on the value read, retried up to 3 times on contention). The new order stores the record's `accountId`. "Any checkout open" is `now < latestCheckoutExpiresAt`. Taking the change lease for a switch or disconnect is one conditional update: `status = active`, `latestCheckoutExpiresAt <= now`, set `status = changing` and `leaseUntil = now + 2 minutes`. A `changing` record whose lease has passed may be taken over by the next save. While `changing`, checkout and `setPrice` refuse as if unconnected (FR-027).

**Rationale**: "Is any checkout open" has no cheap query (orders are indexed by student, not globally, and the constitution forbids scans in a request). A running maximum answers it conservatively: the block can outlast an early payment or cancellation, which only delays a rare admin action by at most an hour, and the page says exactly when. Doing the check and the flip in one conditional write means a checkout cannot slip in between "no open checkouts" and "changing". The lease makes a crash during the multi-step switch recoverable instead of leaving payments stuck.

**Alternatives**: a global index of pending orders (a new index for a rare admin action); counting open orders on the record (an expiry event can be lost, so the count can stay wrong forever); a scan of orders (forbidden, and grows); allowing a switch while checkouts are open and keeping the old signing secret too (two live signing secrets, verification against both, and a second account's refunds that the new key cannot issue).

## R-16: Consistency of key and signing secret, concurrency, audit

**Decision**: The pair is made consistent by sequence plus the lease, not by an atomic write across two secrets: rotation writes one secret; a switch writes the signing secret and then the key only while the record is `changing`, during which no checkout starts and (because the switch needed no open checkout) none is in flight. Two administrators saving at once: the second finds the lease taken and gets "Another change is in progress, try again in a minute". A rotation does not need the lease but is conditioned on the record's `revision` (an integer incremented by each write), so a rotation racing a switch loses cleanly. Each change appends a `paymentChange` row (kind `connected`, `replaced`, `switched`, `disconnected`, `failed`; who, when, mode, account ID and last four characters; never a value). A failed save also appends a `failed` row with the step that failed, so an operator can see attempts.

**Rationale**: FR-025 and FR-029 without a second secrets-service feature. The lease window is short and only affects a rare action.

**Alternatives**: one JSON secret holding both (atomic, but loses the least-privilege split of R-6); Secrets Manager version staging labels to flip both secrets together (they are two secrets, and labels are per secret).

## R-17: The registered confirmation address

**Decision**: The Payments stack exports the webhook API's URL (its custom domain when the stage has one). The admin-api connect function receives it as the environment variable `STRIPE_WEBHOOK_URL`, which creates a stack order of `Data`, `Payments`, `AdminApi`. The URL used is stored on the record as `webhookUrl`; `payment.status` reports `addressChanged: true` when the stored value differs from the current one (a custom domain was added later), and the page says to save the key again to re-register (a save for the same account then re-registers instead of only rotating, because the URL changed).

**Rationale**: Registering the address is only correct while it is current; a deployment that changes it must not leave payments silently dead.

**Alternatives**: re-register on every deploy (needs a custom resource holding the key); ignore the change (silent failure).

## R-18: Local development without Secrets Manager

**Decision**: Locally the "secrets service" is a git-ignored directory, `tmp/local-dev/secrets/`, holding one file per secret. `common-server-utils/stripe/secrets.ts` reads and writes it when `isLocalDev()` and Secrets Manager otherwise, behind the same functions. `reset-local-data` deletes the directory with the table (otherwise the record would say active with no key). Nothing is pre-connected: `pnpm dev` starts disconnected, and the quickstart, the e2e helper and a documented one-liner connect through admin-api with the stand-in's key `sk_test_local`. The stand-in gains accounts (`sk_test_local` is `acct_local`, `sk_test_local_2` is `acct_local_2`, any other key is a 401), and `webhookEndpoints` create, list and delete, with a signing secret per endpoint and delivery to each registered endpoint's URL (contracts/stripe-stand-in.md).

`LOCAL_CHECKOUT_TTL_SECONDS` (read through `common-server-utils/local-dev`, ignored unless `LOCAL_DEV=true`) shortens a checkout's life so a contributor and the e2e switch scenario need not wait an hour for the open-checkout window to close.

**Rationale**: The writing path must be the real one (FR-030), so it needs a writable local store. A file is shared by the three dev servers on one machine and needs no new Docker service.

**Alternatives**: a local table item (puts a secret into the table the whole stack can read, against R-6); pre-connecting at `pnpm dev` start (a path a deployed stage does not have, so the admin flow would go untested); environment variables (cannot be written at run time).

## R-19: Which API serves the Payments page

**Decision**: The shared `admin-api` that the catalogue categories spec (#283) scaffolds with `ts#trpc-api` and connects to the admin portal with `connection`, as the course reviews spec (#279) also assumes; if it is not on `main` when this feature's admin phase starts, that phase runs the same generators and records what they produced, and #283 reuses the result. `payment.status` runs on the shared admin router (reads the table only). `payment.connect` and `payment.disconnect` run on one dedicated function, `PaymentsConnect`, using a dedicated-function mechanism for admin-api like core-api's `CORE_API_DEDICATED_FUNCTIONS` (the task confirms the generated admin-api offers it, and adds the same mechanism by hand if not). That function holds the only write access to both secrets.

**Rationale**: The admin API is already planned and admin-only, so no extra API is created; keeping the write permission on its own function means the categories and reviews procedures, which share the router, cannot write credentials, and nothing open to students or instructors can (FR-029).

**Alternatives**: an admin-group-checked procedure in core-api (puts a credential-writing permission in or beside a function every signed-in user reaches, and mixes authorisation models, the reason instructor-api exists); a second, payments-only admin API (more infrastructure for one page); letting the shared admin router write the secrets (broader than FR-029 allows).

## R-20: A student's refund request asks Stripe; the confirmation still makes the change

Added by the 2026-11-19 amendment (User Story 7).

**Decision**: `payment.requestRefund` checks eligibility, calls Stripe `refunds.create` for the order's payment intent (amount: what has not been refunded yet; idempotency key `refund-<orderId>`), then writes `refundRequestedAt` on the order with a conditional write (`status = paid`, attribute absent). It does not move the order or touch the enrolment. Stripe then sends `charge.refunded`, and the handler of R-3 does what it does for an operator's refund. The procedure runs on the dedicated `PaymentsCheckout` function, which already holds the only core-api read permission on the API key.

**Rationale**: it keeps one path that ends a paid enrolment, as R-1 and FR-008 keep one path that starts one, so the exactly-once reasoning and its tests are reused, not rewritten. Stripe is called before the write so that a crash between the two leaves a real refund and no mark, which the confirmation repairs; the other order would leave a mark and no refund, which nothing repairs. The idempotency key makes a repeated or concurrent request the same refund. `refundRequestedAt` is display state (the page says "Refund requested") and the guard against a second Stripe call; it is not a status, so the lifecycle and every conditional move in R-1 are unchanged.

**Alternatives**: move the order to `refunded` and end the enrolment in the procedure (two writers of the same move, racing the confirmation that will arrive anyway, and a second place to keep the R5 guard); a new `refund_requested` status (every conditional move from `paid` and the `order-shape` rule would have to learn it); a queue for an administrator to approve (there is no admin order screen in this feature, and an unwatched queue leaves students waiting); mark first, then call Stripe (see above); a new dedicated function for refunds (a second function reading the key, for one call).

**Open point**: Stripe's idempotency keys expire after about 24 hours. A second request after that would not be deduplicated by the key, so the `refundRequestedAt` guard, not the key, is what prevents it; if Stripe has already refunded in full it refuses a second refund anyway. The stand-in must refuse a refund above the remaining amount so tests cover this.

## R-21: The refund terms: 14 days, not after completion, one constant

Added by the 2026-11-19 amendment.

**Decision**: `REFUND_WINDOW_DAYS = 14` in `core-table/src/helpers/order.ts`, counted from the order's `paidAt` and decided by the server's clock at the moment of the request. A completed enrolment is not eligible. `refundEligibility` is a pure function returning the reason, used by `requestRefund` to decide and by `payment.myOrder` to tell the page what to show. The number reaches the portal through `course.publicView` and `payment.myOrder`, never as a second literal.

**Rationale**: a student must be able to read the terms before paying (FR-031), so they have to be simple enough for one line. Fourteen days is the usual consumer withdrawal period. Completion is the one condition that is both easy to state and closes the obvious abuse (finish, keep the certificate, take the money back), and it is already a field on the enrolment; it also means the earlier decision that certificates survive refunds needs no change. One platform-wide value fits "one price, one currency, per course": the marketplace, not each instructor, holds the money in this feature.

**Alternatives**: 30 days (the largest marketplace's period; more generous, and longer exposure once payouts in #286 pay instructors out); a progress threshold such as "less than 30% watched" (harder to state, and progress changes when an instructor adds content); a per-course or per-instructor setting (a settings surface and a per-order snapshot of the terms, for a choice nobody has asked to make); an administrator setting (same snapshot problem; can follow). These are the maintainer's to confirm (T113); changing the number is a one-line change, and changing the completion rule is one branch in `refundEligibility`.

**Not legal advice**: consumer law on digital content differs by country (some allow the right of withdrawal to be waived once the content is used, some do not). The terms here are the platform's own minimum, and an operator can always refund by hand.

## R-22: Leaving a course: `dropped`, for unpaid enrolments only

Added by the 2026-11-19 amendment (User Story 8).

**Decision**: `course.unenrol` calls `unenrolFromCourse` in `helpers/order.ts`: one conditional write, enrolment to `dropped` where the status is `active` or `completed` and there is no `orderId`. Completions, progress, `completedAt` and certificates stay. An enrolment with an `orderId` is refused. Coming back is `course.enrol`, which already restores a `dropped` enrolment in a free course (the 2026-11-19 free restore in R-3), or `payment.checkout` if the course has a price.

**Rationale**: `dropped` already means "not enrolled" to every reader (R-3), and the free restore already exists, so leaving and coming back need one new write and no new read path. Refusing a paid enrolment keeps `enrolment-order-matches` exactly as written (an enrolment's order is `paid`, or `refunded` with the enrolment `dropped`): a `dropped` enrolment resting on a `paid` order would be a student who paid and has no access, which that rule exists to catch. It also spares a student a mistake that costs money, since the way back into a priced course is to buy it. The write lives in `order.ts` because that file is the single writer of every move to `dropped`, and the condition on `orderId` is the same attribute the refund-end write is conditioned on, so the two cannot both win.

**Alternatives**: let a paid student leave and come back for free on the strength of their `paid` order (needs a third restore path and a rule that a `paid` order may have a `dropped` enrolment, weakening the check that catches lost access); delete the enrolment (loses progress, breaks `student-records-enrolled`); a separate "hidden from My Learning" flag instead of leaving (does not remove the student from the course's counts, announcements or notifications, which is what leaving is for).

**A grandfathered enrolment** (made while the course was free, in a course that now has a price) has no `orderId`, so it can be left; the student is warned that coming back means buying. After leaving it is a `dropped` enrolment older than `pricedAt`, which R-9's check does not flag because it only examines enrolments that are not `dropped`.

**Counts**: the instructor analytics already count `dropped` enrolments for refunds; leaving feeds the same figure, so "dropped" there now means refunded or left. No stream filter changes (an enrolment MODIFY matches neither the progress nor the search filter).

## R-23: Telling the student the refund went through

Added by the 2026-11-19 amendment (FR-036). It replaces the earlier position that this feature sends no notices.

**Decision**: a notification type `order.refunded` (student portal; email policy `required`; params the course title, course ID and formatted amount; link to the course page), published by the `charge.refunded` handler on every full-refund notice, after `refundOrder`, when the order is `refunded` with `refundReason` `requested` and the student's enrolment still names it. The publish uses `dedupeKey: orderId`, so `publishNotification` returns `'duplicate'` for a repeat. `refundOrder` is unchanged.

**Rationale**: the page a student is looking at updates by itself, but an operator's refund, or a confirmation that arrives after they have left the page, would otherwise end their access with no word. Publishing is idempotent and separate from the move, so a publish that fails after the move (version-conflict retries exhausted, a table error, a timeout) fails the delivery, Stripe redelivers, `refundOrder` returns early as the order is no longer `paid`, and the handler publishes again; the dedupe key makes every later repeat a no-op. That gives exactly one notification with no separate record of "notified". `required` because it is about the student's money and their access, like a receipt, not something to opt out of. It is the same notification for a student's request and an operator's refund, since the outcome is the same.

**Alternatives**: put `notificationWrites` in `refundOrder`'s own transaction (atomic, but a notification state version conflict would cancel the order and enrolment move, and it widens a writer other paths share); publish only when `refundOrder` made the move (at most once, not exactly once: a failed publish is never retried); publish from `requestRefund` (tells the student before the money has moved, and misses operator refunds); rely on Stripe's own refund email (off by default, operator-configured, and says nothing about access); also notify for automatic refunds of undeliverable payments (worth doing, but those students were never enrolled and the course-page states already cover them; left as it was).
