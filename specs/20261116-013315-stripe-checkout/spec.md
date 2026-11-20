# Feature Specification: Stripe Checkout for Paid Courses

**Feature Branch**: `20261116-013315-stripe-checkout` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Issue #284: Stripe checkout for paid courses. Needed for a marketplace model; today enrolment is free only. Price and currency on a course (instructor sets it; free stays supported). Stripe Checkout session creation, and a webhook handler (Lambda) that creates the enrolment on successful payment; refunds revoke or flag access. A payment/order record; secrets in Secrets Manager. Local dev with Stripe test mode or CLI forwarding. Acceptance: enrolment is created exactly once per paid order (webhook retries, duplicates); unpaid users cannot access paid content, with an invariant added."

**Amendment (2026-11-18)**: "For the platform, I want an admin to be able to set up the Stripe details, not something fixed during deployment." The payment provider connection is configured by an administrator in the admin portal at run time instead of being set by an operator per stage; see User Story 6 and FR-023 to FR-030.

**Amendment (2026-11-19)**: "Ship the learner's refund and unenrol path in the same release as checkout" (#284's scope update). A student can ask for a refund themselves within a stated period, and can leave a course they did not pay for; see User Stories 7 and 8 and FR-031 to FR-040.

**Parent issue**: #284

## Clarifications

### Session 2026-11-16

Resolved without asking, using the recommended defaults below (non-interactive run).

- Q: What does a full refund do to the student's access: end the enrolment with the existing "dropped" state, or add a separate "access revoked" flag beside the status? → A: End it with the existing "dropped" state. Every access check, progress job and list already treats it as not enrolled; a second concept would need a new check in each of those paths. The completion date and progress stay on the record, so two existing consistency checks are widened (Assumptions).
- Q: How long does an unpaid checkout stay open? → A: One hour. Long enough to finish a payment, short enough that a student does not pay a price the instructor has since changed, and the stale pending order closes itself. A student is sent back to the same payment page only while more than five minutes of the hour are left (FR-006), so nobody lands on a page about to expire.
- Q: Which ways to pay does the first version accept? → A: Cards only, which confirm immediately. Delayed methods (bank debits, vouchers) would add "payment pending" and "payment failed later" states that the order lifecycle does not have; they are a follow-up.
- Q: When the student returns from the payment page, does the system ask the payment provider whether it was paid, to enrol them sooner? → A: No. The only way an order becomes paid is the confirmation message (FR-008), so there is one path to test and to keep exactly-once. The return page waits and polls the enrolment (FR-013); the confirmation normally arrives within seconds.
- Q: Can a student buy a course for someone else, or buy several courses in one payment? → A: No. One payment buys one course for the signed-in student; gifts and carts are out of scope.
- Q: Does a student who is refunded lose their certificate? → A: No. Issued certificates stay verifiable (certificates spec #276, FR-011). Revoking them is the maintainer's call and out of scope.

### Session 2026-11-18

Amendment: administrators connect Stripe from the admin portal. Resolved without asking, using the recommended defaults below (non-interactive run).

- Q: What does the administrator enter: every Stripe credential, or one? → A: One, the secret key. The platform registers its own confirmation address with Stripe and keeps the signing secret Stripe returns, so there is no second value to copy and no step in Stripe's dashboard (FR-024). A hosted checkout needs no publishable key.
- Q: Where do the credentials live now that an administrator sets them? → A: Still only in the platform's secrets service (FR-017 stands). What changes is who writes them: an administrator through the admin portal, not an operator by hand. Only non-secret facts (mode, account, last four characters, who changed it and when) are kept in the table and shown.
- Q: May an administrator read a saved key back? → A: No. The page is write-only: it shows that a key is saved, its mode (test or live), the account it belongs to, its last four characters, and who saved it and when (FR-023).
- Q: What happens if Stripe is not connected? → A: Students cannot start a checkout, and instructors cannot give a course a price, until an administrator connects it. Courses that already have a price keep it and show it, and Buy now says payments are unavailable right now (FR-027).
- Q: Can an administrator switch to a different Stripe account, or disconnect? → A: Yes, but only while no checkout is open. A checkout is open for at most an hour, and the page says when the last one ends. Replacing the key with another key for the same account (rotation) is allowed at any time (FR-028). A switch from a test account to a live one is the main case; orders paid under the earlier account keep their record, but later refunds in that account are not seen by the platform, so an operator ends such enrolments by hand.
- Q: What if saving fails halfway (Stripe rejects the key, or the confirmation address cannot be registered)? → A: Nothing changes: the previous connection, if any, keeps working, and the page says what failed (FR-025, FR-026).
- Q: Which administrators? → A: Anyone in the existing administrator group (Carol locally). There is no separate "payments administrator" role.
- Q: Which API serves the settings page, a new administrator-only API or a procedure on the shared signed-in API? → A: Left to the plan, where it is decided as a design question. The spec only requires that the ability to write credentials is held by one administrator-only function and by none of the functions that read them (FR-029).

### Session 2026-11-19

Review of PR #360. Two gaps that left a student without the access or the money they are owed, settled as the reviewer recommended.

- Q: A refunded student's enrolment has ended. If the course is later set to free, can they get back in? → A: Yes. Enrolling in a free course restores the same enrolment with its progress, in the same step that checks the course is free. Before this, the free route handed back the ended enrolment and the paid route refused a free course, so the student was locked out of a course anyone else could enter (US3 scenario 2, US4 scenario 6, FR-004, FR-015).
- Q: A genuine confirmation arrives for a payment whose student, course, amount or currency differ from the order's. Log it and do nothing, or refund? → A: Refund it automatically, like any other payment that cannot be delivered, and record the reason on the order. The message is verified, so the money was really taken; doing nothing would keep it and deliver nothing (FR-009, FR-011, SC-005). The payment page is also told to charge exactly the order's amount in the order's currency, with no conversion to the payer's local currency, so a difference should not arise (FR-005).

### Session 2026-11-19 (learner refunds and leaving a course)

Amendment from #284's scope update. Resolved without asking, using the recommended defaults below (non-interactive run). The first three were confirmed as recommended on 2026-11-20 (T113).

- Q: How long may a student ask for a refund, and under what conditions? → A: Within 14 days of paying, and only while they have not completed the course. One period for the whole platform, a fixed value in one place, not a setting per course or per instructor. Fourteen days matches the common consumer withdrawal period; refusing after completion stops a student finishing the course, keeping the certificate and taking the money back.
- Q: Does a person review each request? → A: No. A request that meets the conditions is refunded at once through the payment provider. There is no order list or refund screen for administrators in this feature, and a queue nobody watches would be worse than no feature. An operator can still refund anything by hand in the provider's dashboard, outside the period too.
- Q: Can a student leave a course they paid for without a refund? → A: No. Leaving ends the enrolment, and the only way back into a priced course is to buy it again, so leaving a paid course outside the refund period would throw away what they paid for. Inside the period the way to leave is the refund; outside it nothing is offered and the page says the refund period has ended.
- Q: Is the refund full or partial? → A: Whatever of the amount charged has not been refunded already. A student who was partly refunded by an operator gets the rest, and the order is then fully refunded.
- Q: When does access end after a request? → A: When the payment provider confirms the refund, by the same message and the same step as an operator's refund (User Story 4). The request itself changes no access. This keeps one path that ends a paid enrolment, as there is one path that starts it.
- Q: What does a student who leaves a free course lose? → A: Nothing they can't get back. The enrolment ends and their progress is kept; enrolling again restores it, by the same step that brings back a refunded student when a course is free.
- Q: A student enrolled for free in a course that has since been given a price wants to leave. Allowed? → A: Yes, with a warning that coming back would mean buying the course. They paid nothing, so there is nothing to protect but their free place, and they are told.
- Q: Is the student told when a refund goes through? → A: Yes, by an in-app notification and an email, through the notifications pipeline (#281), once per refunded order. This replaces the earlier statement that this feature sends no notices of its own. A refund made automatically for an undeliverable payment sends none here, as before.
- Q: Does a refund now revoke a certificate? → A: No change: issued certificates stay verifiable. A student who has completed the course can no longer ask for a refund themselves, which removes the common case. Revocation is proposed separately in #594.
- Q: Is a support contact shown where a refund is refused? → A: No. The platform has no support contact setting, and adding one is left to a follow-up. A refusal says why.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Buy a paid course and start learning (Priority: P1)

A signed-in student opens a paid course's page, sees its price, chooses "Buy now", pays on a hosted payment page, comes back to the course, and is enrolled a few seconds later with access to the content.

**Why this priority**: This is the feature. Without a working purchase there is no marketplace, and "enrolled exactly once per paid order" is the rule most likely to break.

**Independent Test**: As an instructor, publish a course priced at 20.00; as a student, buy it on the (local) payment page and check that, within seconds, the student is enrolled with access, and that exactly one paid order and one enrolment exist. Replay the payment confirmation several times, and concurrently: still one.

**Acceptance Scenarios**:

1. **Given** a published course with a price and a signed-in student who is not enrolled, **When** the student chooses Buy now, **Then** they are taken to a hosted payment page that asks for exactly the course's price and currency, and an order is recorded as pending.
2. **Given** a pending order, **When** the payment succeeds and the payment provider confirms it, **Then** the order becomes paid, the student is enrolled, and the course shows them as enrolled.
3. **Given** the student returns to the course before the confirmation has arrived, **When** the page loads, **Then** it says the payment is being confirmed and updates by itself when the enrolment appears, without asking them to pay again.
4. **Given** the provider sends the same confirmation again (a retry, a duplicate, two deliveries at once), **When** it is processed, **Then** no second enrolment and no second paid order result, and the provider is answered successfully.
5. **Given** a student who started a checkout and has not paid, **When** they choose Buy now again, **Then** they are taken to the same open payment page and no second pending order is created.
6. **Given** a course with no price (free), **When** a student enrols, **Then** it works exactly as today, with no payment page.

---

### User Story 2 - Unpaid users cannot get paid content (Priority: P1)

Whoever has not paid cannot enrol in, or read the content of, a paid course. The browser coming back from the payment page never grants access by itself.

**Why this priority**: The issue's second acceptance criterion, and the money-protecting rule. A hole here gives the product away.

**Independent Test**: Try, as a student who has not paid, to enrol through the free enrolment, to read the course's content, and to fake a return from the payment page: all refused. Then check the data-consistency check after every test.

**Acceptance Scenarios**:

1. **Given** a paid course, **When** a student who has not paid asks to enrol without paying, **Then** it is refused with a message that the course must be bought, and no enrolment is created.
2. **Given** a paid course and a student with no paid order, **When** they request its lessons, files, videos or quizzes, **Then** they are refused as any non-enrolled student is.
3. **Given** a student returning from the payment page with a success marker in the address but no confirmation from the provider, **When** the page loads, **Then** no enrolment exists and the course still offers Buy now once the waiting period ends.
4. **Given** a student enrolled while the course was free, **When** the instructor later gives the course a price, **Then** that student keeps their access, and students who enrol afterwards must pay.
5. **Given** a confirmation that is not genuinely from the payment provider (a missing or wrong signature), or whose amount or currency differs from the order, **When** it arrives, **Then** it is rejected and nothing changes.
6. **Given** the data-consistency check, **When** an enrolment exists in a currently paid course with no paid order and was not made while the course was free, **Then** the check fails.

---

### User Story 3 - Instructor sets a price and currency (Priority: P1)

An instructor of a course sets its price and currency on the course's settings, or sets it back to free. The course page and the catalogue show the price, or "Free".

**Why this priority**: Nothing can be bought until a course has a price, and the issue names it. It is a small slice, but a hard dependency of the purchase.

**Independent Test**: As an instructor, set a price on a draft and a published course, change it, and set it to free; as a non-instructor, try and fail; as a signed-out visitor, see the price on the public course page.

**Acceptance Scenarios**:

1. **Given** an instructor of a course, **When** they set an amount and a currency from the supported list, **Then** it is saved and shown on the course's public page and catalogue card.
2. **Given** a priced course, **When** the instructor sets it to free, **Then** new students enrol without paying, students who bought it keep their access, and a student whose purchase was refunded can enrol again without paying and gets their progress back.
3. **Given** an amount that is not a whole number of the currency's smallest unit, is below the minimum, is above the maximum, or a currency outside the list, **When** the instructor saves, **Then** it is refused with a clear message.
4. **Given** a user who is not an instructor of the course, **When** they try to change its price, **Then** it is refused.
5. **Given** a checkout already open at the old price, **When** the price changes, **Then** that checkout still charges the price it was opened at, and new checkouts use the new one.
6. **Given** a new course, **Then** it starts free.

---

### User Story 4 - A refund takes access away (Priority: P2)

When a purchase is fully refunded (by an operator in the payment provider's dashboard, at the student's own request under User Story 7, or automatically for an undeliverable payment), the student's enrolment ends. Their progress is kept, so buying the course again brings it back.

**Why this priority**: Required by the issue ("refunds revoke or flag access"), but a course can be sold without it; operators can refund by hand and tolerate a short gap until it ships.

**Independent Test**: Buy a course, refund it in the stand-in, and check that the order is refunded, the student is no longer enrolled, their completions remain, and buying again restores the enrolment with the same progress.

**Acceptance Scenarios**:

1. **Given** a paid order, **When** the provider reports it fully refunded, **Then** the order becomes refunded and the student's enrolment ends: they can no longer read the course, and the course page says their enrolment has ended and offers Buy now.
2. **Given** a refunded student, **When** they buy the course again and pay, **Then** a new order is paid and the same enrolment is restored, with the progress and completions they had.
3. **Given** a partial refund, **When** the provider reports it, **Then** the amount refunded is recorded on the order and access is unchanged.
4. **Given** the same refund notice twice, **When** processed, **Then** the outcome is the same as once.
5. **Given** a student who completed the course and received a certificate, **When** the purchase is refunded, **Then** the certificate remains verifiable (see Assumptions).
6. **Given** a refunded student and a course that has since been set to free, **When** they enrol, **Then** the same enrolment is restored without payment, with the progress and completions they had; while the course still has a price, enrolling without paying is refused and Buy now is the way back.

---

### User Story 5 - Abandoned and failed payments leave nothing behind (Priority: P2)

A student who closes the payment page, cancels, or lets it expire is not enrolled and is not charged, and can try again. Their abandoned order closes when its checkout expires.

**Why this priority**: Without it, pending orders pile up and a stale order could block a retry; it rounds off the flow but the paid path works without it.

**Independent Test**: Start a checkout and cancel it; start one and let it expire; check no enrolment, the order closed, and that a new purchase works.

**Acceptance Scenarios**:

1. **Given** a student on the payment page, **When** they cancel, **Then** they return to the course page, which offers Buy now, and nothing is charged or enrolled.
2. **Given** a checkout that expires unpaid, **When** the provider reports the expiry, **Then** the order becomes expired and the student can start a new checkout.
3. **Given** a card that is declined, **When** the student corrects it on the payment page and pays, **Then** the same order succeeds; if they give up, the checkout expires as in the previous scenario.

---

### User Story 6 - An administrator connects Stripe (Priority: P1)

An administrator opens the Payments page of the admin portal, pastes the Stripe secret key, and saves. The platform checks the key with Stripe, registers itself to receive payment confirmations, and shows the connection as active with its mode (test or live). Later the administrator can replace the key or disconnect. Nobody has to edit deployment settings, touch a secrets console or visit Stripe's webhook settings.

**Why this priority**: Nothing can be bought until Stripe is connected, and on a deployed stage this is now the only way to connect it. It is also where money safety is decided: a key must never be readable again, and a half-saved connection must never leave payments silently broken.

**Independent Test**: As an administrator, save a key against the (local) stand-in and see the connection active in test mode; as a student, buy a course; replace the key and buy again; disconnect with a checkout open (refused) and again after it expires (allowed); as a non-administrator, try and fail at every step.

**Acceptance Scenarios**:

1. **Given** an administrator on the Payments page with nothing connected, **When** they save a valid secret key, **Then** the platform verifies it, registers its confirmation address with Stripe, stores the key and the signing secret Stripe returns, and the page shows the connection as active with the mode, the account's name, the last four characters of the key, and who saved it and when.
2. **Given** a connected platform, **When** anyone (including an administrator) views the page, loads any page or calls any API, **Then** the key and the signing secret are never returned, logged or placed in a page.
3. **Given** a key that Stripe rejects, or a key whose confirmation address cannot be registered, **When** the administrator saves it, **Then** it is refused with a message that says which step failed, and any earlier connection keeps working unchanged.
4. **Given** an active connection with no open checkout, **When** the administrator saves a key for a different Stripe account, or disconnects, **Then** it takes effect, the old registration is removed from Stripe as far as it can be, and the page shows the new state.
5. **Given** at least one checkout is open, **When** the administrator saves a key for a different account, or disconnects, **Then** it is refused and the page says when the last open checkout ends.
6. **Given** an active connection, **When** the administrator saves a new key for the same account, **Then** payments keep working throughout, including for checkouts that are open.
7. **Given** a user who is not an administrator, **When** they try to view or change the connection, **Then** it is refused.
8. **Given** nothing connected, **When** a student starts a checkout, or an instructor gives a course a non-zero price, **Then** it is refused with a message that payments are not set up (to the student: unavailable right now; to the instructor: ask an administrator), and a free course is unaffected.

---

### User Story 7 - A student asks for a refund (Priority: P1)

A student who bought a course and changed their mind can get their money back without contacting anyone: the course page says before they pay how long they have, and within that period, if they have not completed the course, one confirmed action refunds them. Their access then ends as it does for any refund (User Story 4).

**Why this priority**: Added by the 2026-11-19 amendment and required for the same release as the purchase. A student asked to pay an instructor they do not know needs to see how they get their money back, and must not depend on reaching an operator to get it.

**Independent Test**: Buy a course in the stand-in, ask for a refund from the course page, and check that the payment is refunded once, the order becomes refunded, the enrolment ends with its progress kept, and the student is told. Then check a request is refused after 14 days and after completing the course.

**Acceptance Scenarios**:

1. **Given** a published course with a price, **When** anyone views its page, **Then** beside the price it states the refund terms: 14 days from purchase, unless the course has been completed.
2. **Given** a student whose purchase was paid less than 14 days ago and who has not completed the course, **When** they choose Request a refund and confirm, **Then** the provider is asked to refund everything not already refunded, and the page says the refund has been requested.
3. **Given** a requested refund, **When** the provider confirms it, **Then** the order becomes refunded and the enrolment ends exactly as in User Story 4, and the student receives one in-app notification and one email saying so.
4. **Given** a student whose purchase was paid more than 14 days ago, **When** they view the course page, **Then** no refund action is offered and the page says the refund period ended on its date; a request sent anyway is refused and nothing is refunded.
5. **Given** a student who has completed the course, **When** they view the course page within the 14 days, **Then** no refund action is offered and the page says why; a request sent anyway is refused.
6. **Given** a student who asks twice, in two tabs or at the same moment, **When** both requests are processed, **Then** the payment is refunded once and the outcome is the same as one request.
7. **Given** a purchase an operator has partly refunded, **When** the student asks for a refund within the period, **Then** the remainder is refunded and the order becomes fully refunded.
8. **Given** a student, **When** they ask for a refund of another student's purchase, or of a course they did not pay for, **Then** it is refused and nothing is revealed about the other purchase.
9. **Given** a purchase taken under a payment connection that has since been replaced by another account or removed, **When** the student asks for a refund, **Then** it is refused with a message that it cannot be refunded here right now, and nothing changes.
10. **Given** a student who was refunded at their own request, **When** they buy the course again, **Then** it works as in User Story 4 scenario 2, and the new purchase has its own 14 days.

---

### User Story 8 - A student leaves a course they did not pay for (Priority: P2)

A student enrolled without paying can leave the course. It no longer counts them as enrolled or appears in their learning; their progress is kept, and enrolling again brings it back while the course is free.

**Why this priority**: Added by the 2026-11-19 amendment. Until now the only thing that ended an enrolment was a refund, so a student could never leave a free course. It does not block selling a course, so it follows User Story 7.

**Independent Test**: Enrol in a free course, complete an item, leave, and check the enrolment has ended and the course is gone from My Learning; enrol again and see the progress back. Check that a student who paid is not offered Leave course.

**Acceptance Scenarios**:

1. **Given** a student enrolled in a course without an order, **When** they choose Leave course and confirm, **Then** their enrolment ends, they can no longer read the course, it leaves My Learning, and the course page says their enrolment has ended.
2. **Given** a student who left a free course, **When** they enrol again, **Then** the same enrolment is restored with the progress and completions they had.
3. **Given** a student whose enrolment was paid for, **When** they view the course page, **Then** Leave course is not offered; a request sent anyway is refused with a message that says to request a refund instead, and the enrolment is unchanged.
4. **Given** a student enrolled for free in a course that now has a price, **When** they choose Leave course, **Then** the confirmation warns that coming back means buying the course, and after leaving the page offers Buy now.
5. **Given** a student who completed a free course and holds its certificate, **When** they leave, **Then** the completion stays on record and the certificate remains verifiable.
6. **Given** a student who leaves twice at the same moment, or leaves while a refund is ending the same enrolment, **When** both are processed, **Then** the enrolment ends once and the data-consistency check passes.

---

### Edge Cases

- The provider's confirmation arrives twice at once, or before the student's browser returns, or after a long delay: the outcome is one paid order and one enrolment, whatever the order.
- The student pays in two tabs or after the first checkout expired and a second began: if both complete, the second payment is refunded automatically and the order says why (already enrolled); the student ends with one enrolment and one net charge.
- The course was archived, or deleted, while the student paid: the payment is refunded automatically and no enrolment is made; the order says why.
- The provider confirms a payment whose student, course, amount or currency differ from the order's: the confirmation is genuine, so the money was taken; it is refunded automatically, no enrolment is made, the order says why (mismatch) and an error is logged for an operator.
- A refunded student's course is later set to free: they enrol again without paying and the same enrolment comes back with its progress.
- A payment for an order the system cannot find: nothing changes and an error is logged for an operator; the provider is answered successfully so it does not retry for days.
- Processing fails (the table is unavailable): the provider is answered with a failure and retries later; the retry completes the work.
- The student's account is deleted or the user record is missing: the order and enrolment are keyed by the Cognito user, not the record, so fulfilment does not depend on it.
- A student tries to open a checkout for a course they are already enrolled in (active or completed): refused with a message; a dropped or refunded student may buy.
- A course is unpublished or archived when Buy now is chosen: not found, as enrolment is today.
- The instructor changes the currency while a checkout is open: the open checkout keeps its currency; a student who paid keeps the enrolment.
- A confirmation for an event type the system does not use: acknowledged and ignored.
- A refund of a payment whose order is already refunded, or whose enrolment is already ended: no change.
- A dispute or chargeback: not handled in this feature (see Assumptions); an operator acts in the provider's dashboard.
- A student who is enrolled for free in a course that becomes paid is never asked to pay, and the consistency check does not flag them.
- Two administrators save at the same moment: the saves take effect one after the other, and the stored key and signing secret always belong to the same registration, never one from each.
- The administrator saves a test-mode key on a stage that real students use: it is allowed, and the page shows "Test mode" prominently so it is not missed; students then "pay" with test cards and are enrolled. The platform does not guess a stage's intent.
- The platform is disconnected while a course still has a price: the course keeps and shows its price, Buy now says payments are unavailable, and students who already paid keep their access.
- A confirmation arrives signed with a signing secret from a connection that has since been replaced: it is rejected like any message that fails verification.
- Saving fails after the key was verified but before everything was stored: nothing is left half-written, and the earlier connection, if any, still works.

- A student asks for a refund and the provider's confirmation is delayed: the page keeps saying the refund has been requested, access continues until the confirmation arrives, and asking again changes nothing.
- A student asks for a refund in the last minute of the 14 days: the decision is made by the server's clock at the moment of the request; a confirmation that arrives after the period still ends the enrolment.
- A student completes the course between loading the page and confirming the request: the request is refused, because completion is checked when the request is made.
- The provider refuses the refund (the payment is disputed, or already fully refunded there): the student is told it could not be refunded here, nothing is recorded as requested, and an error is logged for an operator.
- An operator refunds by hand while a student's request is in flight: one refund results, and the student is notified once.
- A student who was refunded leaves nothing further to leave: Leave course is not offered on an ended enrolment.
- A student leaves a free course, the course is then given a price: the page offers Buy now, as for any ended enrolment in a priced course.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every course MUST have a price: an amount in the currency's smallest unit (a whole number) and a currency from a fixed supported list. An amount of zero means free; free is the default for new courses. A paid amount MUST be within a stated minimum and maximum (see Assumptions).
- **FR-002**: Only instructors of a course MUST be able to set its price and currency, in any course status. A change applies only to checkouts started afterwards and never changes an order or an enrolment that exists.
- **FR-003**: The public course page and the catalogue MUST show a course's price in its currency, or "Free".
- **FR-004**: Free enrolment MUST keep working unchanged for free courses. Enrolling in a course that has a price, other than by a confirmed payment, MUST be refused, and the refusal MUST be decided in the same step that creates the enrolment, so a price set at the same moment cannot be raced. A student whose enrolment ended with a refund MUST be able to enrol again without paying once the course is free, under the same rule, and that MUST restore the same enrolment (FR-015).
- **FR-005**: A signed-in student who is not currently enrolled MUST be able to start a checkout for a published paid course, for themselves, for that one course, paying by card. The amount and currency MUST come from the course, never from the caller. Starting a checkout MUST record a pending order first and send the student to a hosted payment page for that order. The payment page MUST charge exactly the order's amount in the order's currency, with no conversion to the payer's local currency.
- **FR-006**: Starting a checkout again for the same student and course while an earlier one is still open (unpaid, with more than five minutes of its hour left) MUST lead to the same payment page and MUST NOT create a second pending order.
- **FR-007**: An order MUST record the student, the course and its title as they were, the list price, the amount charged and its currency, a status (pending, paid, expired, refunded), when each change happened, the payment provider's references, and for a refund the amount refunded and why. Orders are never deleted.
- **FR-008**: The browser returning from the payment page MUST NOT create an enrolment. Only a confirmation from the payment provider, verified as genuine, MAY mark an order paid.
- **FR-009**: The confirmation endpoint MUST verify each message's signature against a secret held in the platform's secrets service, MUST reject any message that fails it, and MUST check that the order exists and that the paid student, course, amount and currency equal the order's. A genuine message that fails that comparison MUST be handled as an undeliverable payment (FR-011), never ignored.
- **FR-010**: Marking an order paid and creating (or restoring) the student's enrolment MUST happen together, so that each paid order yields exactly one enrolment however many times, and however concurrently, its confirmation is processed. A student MUST NOT have two enrolments in a course.
- **FR-011**: A payment that cannot be delivered (the student is already enrolled, through another paid order or otherwise; the course is no longer published; or the paid student, course, amount or currency differ from the order's) MUST be refunded automatically, and the order MUST record the reason. No verified payment may end with neither an enrolment nor a refund.
- **FR-012**: The confirmation endpoint MUST answer success for messages that were processed, were duplicates, or are of a type it ignores, and MUST answer failure when processing failed so the provider retries.
- **FR-013**: The course page MUST show a "confirming your payment" state for a student with a pending order who has just returned, MUST update to the enrolled state without a manual reload, and MUST show a clear message with a refresh option if the enrolment has not appeared after 60 seconds.
- **FR-014**: A student who has not paid MUST NOT be able to read a paid course's content. Students enrolled while the course was free MUST keep access after it gets a price.
- **FR-015**: A full refund MUST mark the order refunded and end the student's enrolment, keeping their completions, progress and issued certificates. Buying the course again, or enrolling again without paying once the course is free, MUST restore the same enrolment with its progress. A partial refund MUST be recorded on the order without changing access. Repeated refund notices MUST have the same effect as one.
- **FR-016**: A checkout MUST expire one hour after it is started if unpaid. A checkout that is cancelled or expires MUST leave no enrolment and no charge. A cancelled checkout stays open (the student may return to it) until it expires; an expired one MUST close its order as expired, and the student MUST be able to start a new checkout.
- **FR-017**: All payment provider credentials and the signing secret MUST be held only in the platform's secrets service, MUST NOT appear in code, configuration (including per-stage deployment configuration), logs, runtime config files or anything sent to a browser, and MUST be readable only by the functions that need them. They are written at run time by an administrator through the admin portal (FR-023 to FR-030), never set at deployment.
- **FR-018**: The feature MUST work end to end in local development without an AWS account and without a payment provider account: a local stand-in MUST offer a hosted payment page to pay, fail or cancel, send correctly signed confirmations (including deliberate duplicates and refunds) to the same confirmation endpoint code the deployed stage runs, and be selected by the same local-dev switch the other stand-ins use. The administrator's Payments page MUST work against the stand-in the same way as against Stripe (FR-030). Testing against the provider's own test mode MUST be documented as an option for a deployed stage: with a test-mode key saved through the Payments page, and no command-line forwarding needed because the platform registers its own confirmation address.
- **FR-019**: Order and enrolment writes MUST go through shared `core-table` helpers that every writer calls, and invariant checks that a test can break MUST cover: at most one paid order per enrolment and one enrolment per student and course; every course has a valid price (zero, or within the stated bounds, with a supported currency); every paid order has a matching enrolment (not ended unless the order is refunded); every enrolment made by payment points to a paid or refunded order for the same student and course; no enrolment without a paid order in a course that has had a price since before the enrolment; an order's amounts and currency are valid and its status matches its recorded times.
- **FR-020**: Orders MUST carry the list price and the amount charged separately, and fulfilment (marking an order paid and enrolling the student) MUST NOT depend on the payment provider, so that coupons (#285) can discount an order and can enrol directly for a fully discounted one, and payouts (#286) can read amounts and refunds, without reshaping the records.
- **FR-021**: The confirmation endpoint MUST be reachable by the payment provider without signing in, MUST sit behind the platform's default hardening (WAF and throttling per stage config), and MUST NOT share a function with the signed-in APIs.
- **FR-022**: The feature MUST NOT add gifts, carts, delayed payment methods, taxes, invoices, subscriptions or bundles, multiple currencies on one course, coupons, instructor payouts or earnings reports, dispute handling, or emailed receipts of its own, and no admin portal view other than the Payments settings page (see Assumptions and Out of scope).
- **FR-023**: An administrator MUST be able to view the payment connection and to save, replace and remove it from the admin portal's Payments page. The page MUST show whether a connection exists, its mode (test or live), the account's name, the last four characters of the saved key, and who last changed it and when. It MUST NOT show, return or log the key or the signing secret at any time, including to the administrator who saved it. Only administrators MUST be able to see or change it.
- **FR-024**: Saving MUST need only the secret key. The platform MUST verify the key with Stripe, register its own public confirmation address with Stripe for exactly the events it uses (paid, expired, refunded), and store the signing secret Stripe returns, with no step for the administrator in Stripe's dashboard. The mode MUST be read from the key, and the account from Stripe.
- **FR-025**: A save MUST succeed or change nothing. If the key is rejected, lacks a permission the platform needs, or the registration fails, the earlier connection (if any) MUST keep working, nothing half-written MUST remain, and the message MUST say which step failed without echoing the key. The stored key and signing secret MUST always belong to the same registration, including when two administrators save at once.
- **FR-026**: Saving a key for the same account (rotation) MUST NOT interrupt payments: checkouts and confirmations in flight when it happens MUST still complete. Confirmations verified against a connection that has since been replaced MAY be rejected.
- **FR-027**: While nothing is connected, starting a checkout and giving a course a non-zero price MUST be refused with a clear message that payments are not set up. Free courses, free enrolment, existing prices, and the access of students who already paid MUST be unaffected.
- **FR-028**: Saving a key for a different account, and disconnecting, MUST be refused while any checkout is open (a checkout counts as open until its one hour ends, even if it was paid or cancelled sooner, so the platform needs no list of open checkouts), and the refusal MUST say when the last open checkout ends. When allowed, the platform MUST remove its old registration from Stripe on a best-effort basis, and a failure to do so MUST NOT block or undo the change. Orders paid under an earlier connection keep their record; the order MUST record which account took the payment.
- **FR-029**: The ability to write the key and signing secret MUST belong to one administrator-only function. The functions that start checkouts and handle confirmations MUST hold read access only, and no function open to students or instructors MUST be able to write them. Each change MUST be recorded (who, when, what kind: saved, replaced, removed), without the values.
- **FR-030**: In local development the Payments page MUST work against the local stand-in with no payment provider account: the stand-in MUST accept a documented local key, register the confirmation address, and sign confirmations with the secret it returns. The connection MUST be made through the same page or API a deployed stage uses, and the quickstart MUST say so. Local data MUST NOT start pre-connected by a path a deployed stage lacks.

- **FR-031**: The public course page MUST state the refund terms beside the price of every priced course, before a student pays: the length of the refund period and the condition that the course has not been completed. The period MUST be 14 days from the time the payment was confirmed, defined in one place and the same for every course.
- **FR-032**: A signed-in student MUST be able to request a refund of their own paid order from the course page, with a confirmation step, when all of these hold at the moment of the request: the order is paid and is the order their enrolment rests on; it was paid no more than 14 days ago; their enrolment is not completed; no refund of it has been requested already; and the order was paid under the payment account that is connected now. Otherwise the request MUST be refused with a message that says which condition failed, and MUST change nothing.
- **FR-033**: An accepted request MUST ask the payment provider to refund everything of the amount charged that has not been refunded already, exactly once however many times or however concurrently the request is made, and MUST record on the order the time the refund was requested. No administrator review is involved.
- **FR-034**: A refund request MUST NOT itself change the order's status or the enrolment. Only the payment provider's confirmation of the refund does, through the same step as any full refund (FR-015), so a refund requested by a student and one made by an operator have the same outcome.
- **FR-035**: A student MUST be able to see, on the course page, the state of their own purchase of that course: the date the refund period ends while a refund can still be requested, why it cannot be requested when it cannot, that a refund has been requested, and that it has been refunded and when. No student MUST be able to see or act on another student's order, and no order or provider identifier is shown.
- **FR-036**: When an order becomes fully refunded and an enrolment ends with it, the student MUST receive one in-app notification and one email, sent through the notifications pipeline, however many times the confirmation is delivered. The email MUST NOT be one the student can switch off.
- **FR-037**: A student whose enrolment is not ended and has no order (a free enrolment, including one made before the course had a price) MUST be able to leave the course from the course page, with a confirmation step. Leaving MUST end the enrolment with the existing ended state, keeping completions, progress, the completion date and any issued certificate, exactly as a refund does.
- **FR-038**: Leaving MUST be refused for an enrolment that rests on an order, with a message that says to request a refund instead. The system MUST NOT end a paid enrolment by any means other than a full refund.
- **FR-039**: A student who left MUST be able to come back the way a refunded student does: by enrolling again while the course is free, which restores the same enrolment with its progress (FR-004), or by buying it when it has a price. The confirmation for leaving a course that now has a price MUST say that coming back means buying it.
- **FR-040**: The refund request and the leave-course write MUST go through shared `core-table` helpers with the other order and enrolment writes (FR-019), the consistency checks MUST still pass after every test, and the whole of User Stories 7 and 8 MUST work in local development against the stand-in (FR-018).

### Key Entities

- **Price**: Part of a course: an amount (zero is free) and a currency. Set by the course's instructors.
- **Order**: One checkout attempt by one student for one course. Has the student, the account that took the payment, course, title as it was, list price, amount charged, currency, status (pending, paid, expired, refunded), times (including when the student asked for a refund, if they did), the provider's references, and any refund amount and reason. A paid order is what entitles a student to the course.
- **Enrolment**: Existing. Gains a link to the order that paid for it (absent for free enrolments). An ended enrolment (refund) keeps its progress.
- **Payment connection**: One per platform. The administrator's Stripe setup: whether it is active, its mode (test or live), the account's identity and name, the last four characters of the key, the registration Stripe holds, and who changed it and when. The key and the signing secret are not part of it: they live only in the secrets service.
- **Payment confirmation**: A message from the payment provider (paid, expired, refunded). Not stored as such: its effect is the change to an order and an enrolment, made so repeating it changes nothing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of runs, however many times and however concurrently a payment's confirmation is processed, a paid order has exactly one enrolment and a student has exactly one enrolment per course, and the data-consistency check passes after every test.
- **SC-002**: A student who completes payment sees themselves enrolled within 30 seconds of paying, and is never asked to pay twice for the same enrolment.
- **SC-003**: 0 cases where a student without a paid order (and not enrolled while the course was free) can enrol in or read a paid course, including through a forged return from the payment page or a forged or altered confirmation.
- **SC-004**: 100% of full refunds end the student's access, and 100% of the progress they had is back after they buy again.
- **SC-005**: 100% of undeliverable payments (duplicates, unavailable course, a payment that does not match its order) are refunded automatically and explained on the order, and 0 verified payments end with neither an enrolment nor a refund.
- **SC-006**: A contributor can run the whole purchase, cancel, expiry and refund flows locally with no payment provider account, and the secrets service holds the only copy of every credential on a deployed stage.
- **SC-008**: An administrator can connect Stripe from the admin portal in under two minutes with one pasted value, with no deployment, no secrets console and no Stripe dashboard step, and a student can then buy a course.
- **SC-009**: 0 occasions on which a key or signing secret is returned by any API, shown on any page or written to any log, and 100% of failed or concurrent saves leave either the earlier connection or the new one fully working, never a mix.
- **SC-010**: 100% of attempts to view or change the connection by anyone who is not an administrator are refused, and 100% of attempts to start a checkout or price a course while nothing is connected are refused with a message that says why.
- **SC-007**: An instructor can set or clear a price in under a minute and every visitor sees it, or "Free", on the course page.

- **SC-011**: A student within the refund period can go from the course page to a confirmed refund request in under a minute without contacting anyone, and in 100% of runs, however many times and however concurrently they ask, the payment is refunded exactly once and they are notified exactly once.
- **SC-012**: 0 refunds are made at a student's request outside the 14 days, after completion, or for an order that is not theirs; and 0 paid enrolments are ended by leaving.
- **SC-013**: 100% of students who leave a free course and enrol again have the progress they had, and the data-consistency check passes after every test of leaving, including leaving at the same moment as a refund.

## Assumptions

- **Connection is run-time configuration, not deployment configuration.** The stage config holds no Stripe value. The secrets service entries are created empty by the deployment and filled by the administrator's save. Functions cache what they read for a few minutes, so a new key is used within minutes, and at once if the old key is rejected (the function drops its cache and tries again).
- **One platform account.** There is one Stripe connection per platform, not per instructor or per course. The instructor payouts spec (#286) uses the same key for Connect, and any extra permission or Connect setting it needs is checked when it ships.
- **Test mode is allowed anywhere.** A stage's seriousness is the administrator's call, so the platform shows the mode but does not forbid test keys on a stage with real students.
- **Money is whole numbers.** Amounts are integers in the currency's smallest unit, never floating point. The supported currencies are USD, EUR, GBP, AUD and CAD (all two-decimal), a fixed list in one place. A paid amount is at least 1.00 and at most 10,000.00 (100 to 1,000,000 smallest units): above the provider's own minimum and below an amount nobody should type by accident.
- **Free is the zero price, and the attribute is required.** Like the certificate setting, the price is a required attribute of every course, set to zero when a course is created. Existing courses are backfilled by hand before this ships, so no code treats a missing price as free.
- **One price, one currency, per course.** No regional pricing, no sales, no price history beyond what orders snapshot.
- **The payment provider is Stripe, using its hosted Checkout page,** so card details never touch Discava. The marketplace holds the money on one platform account in this feature; instructors are not paid out yet (#286).
- **Confirmation by webhook, state-based idempotence.** Orders move forward only (pending to paid, expired, or refunded; paid to refunded), each move conditioned on the status it comes from, so a repeated or reordered message finds the work done. No separate log of seen messages is kept.
- **A refund ends the enrolment using the existing "dropped" state,** which every access check, progress job and student-facing list already treat as "not enrolled", so no check is added to those paths. The completion date and progress stay on the record, which means the existing rule "a completion date is set exactly when the status is completed" and the certificate rule "a certificate has a completed enrolment" widen to also accept an ended enrolment that has a completion date (see plan).
- **Certificates survive refunds.** An issued certificate stays verifiable, as it does when a course is archived (certificates spec #276, FR-011). Revoking certificates on refund is a decision for the maintainer and out of scope here.
- **Grandfathering is by record, not by flag:** an enrolment without an order is legitimate if it was made while the course was free. The consistency check uses the time the course's price last became non-zero, with 10 seconds of clock tolerance.
- **No special treatment of instructors.** An instructor of a course who enrols in it follows the same rules as any student today.
- **Taxes and invoices are the platform operator's business** (tax settings and receipts in the provider's dashboard). Prices are what the student pays.
- **Disputes and chargebacks are handled by hand** in the provider's dashboard; an operator refunds, which revokes access as above.
- **Dependencies on other specs, none blocking.** Instructor dashboard (#278): paid enrolments count like any other, and revenue figures are instructor payouts' (#286), whose earnings recording has landed (#605): a student's own refund is recorded there as a sale followed by a refund, like an operator's. Catalogue categories (#283): both specs add fields to what a catalogue card shows and what the search index stores; this one adds only the price and no price filter. Notifications (#281): the refund notice of FR-036 uses the pipeline (amendment 2026-11-19); purchase notices could later, and this feature sends no other notice of its own. Announcements (#282): an ended enrolment loses announcements through the same enrolled-student rule.
- **Out of scope here, left to the sibling issues.** Coupons and discount codes, their redemption counts, and enrolling directly for a fully discounted order (#285). Stripe Connect onboarding, the platform fee, instructor earnings reports, payout status and refund adjustments in earnings (#286). Also out of scope: gifts and carts, delayed payment methods (bank debits, vouchers), taxes, invoices, subscriptions, bundles, multiple currencies per course, dispute handling, emailed receipts, a purchase history page, admin portal views other than the Payments settings page (no order list, no refund button, no revenue figures), and a deliberate backfill of orders.
- **A refund is requested by the student but still made by the provider's confirmation** (amendment 2026-11-19). The request calls the provider and records the time; the order and enrolment change only when the confirmation arrives, normally within seconds. A request is therefore safe to repeat, and an operator's refund and a student's cannot disagree.
- **The refund terms are the platform's, not the instructor's** (amendment 2026-11-19): 14 days, not after completion, one fixed value. A setting per course, a longer period, or terms that depend on how much was watched are follow-ups. The terms apply to refunds a student makes themselves; an operator may refund anything by hand.
- **Leaving uses the same ended state as a refund** (amendment 2026-11-19), so nothing new is checked on any access path. The ended state no longer means "refunded": an ended enrolment with an order was refunded, and one without was left. A paid enrolment is never ended by leaving, which keeps the rule that an enrolment's order is paid, or refunded with the enrolment ended.
- **No purchase history page and no support contact** (amendment 2026-11-19). The state of a purchase is shown on its course page only, and a refusal says why without naming whom to contact.
- Discava has not launched: no old data or URLs to preserve, so the price attributes, routes and records are added outright.
- Only the final implementation PR may close #284.
