# Feature Specification: Coupons and Discount Codes

**Feature Branch**: `20261116-013138-coupons-discount-codes` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Issue #285: instructor-created coupon codes (percent or fixed amount, expiry, usage limit, scoped to a course), applied at checkout. A code that brings the price to zero enrols the student directly without Stripe. Redemption counts stay consistent under concurrency: a code cannot be redeemed beyond its limit under concurrent requests. Depends on #284 (Stripe checkout for paid courses); #286 (payouts) needs the discount recorded on the order."

**Parent issue**: #285

## Clarifications

### Session 2026-11-16

Resolved without asking, using the defaults below (non-interactive run).

- Q: Is a code valid for one course or several? → A: One course. The issue says "per course"; a code belongs to exactly one course and is meaningless elsewhere. Site-wide or multi-course codes are out of scope.
- Q: Can a student use the same code more than once? → A: No. One redemption per student per code, so a shared code cannot be farmed by one account re-buying after a refund. A student who is already enrolled cannot redeem a code at all.
- Q: When does a redemption count against the limit: when the student starts checkout or when they pay? → A: When checkout starts (a reservation). Counting at payment would let simultaneous students all pass the limit check and then all pay. A reservation is released if the checkout expires or fails, and kept once paid.
- Q: Does a refund give the redemption back? → A: No. A refunded order still used its redemption, so a refund neither re-opens the limit nor lets the same student reuse the code.
- Q: How is a percent discount rounded? → A: The discount is the percent of the list price in minor units, rounded down, so the student pays the rounded-up remainder and the discount never exceeds the percent shown. A fixed discount is in the course's currency and is capped at the list price.
- Q: What if a code leaves a payable price below what the payment provider will charge? → A: The code is refused for that course with a clear message ("this code leaves a price too low to pay for"), as is any total that is not zero and below the provider's minimum charge. A total of exactly zero is allowed and is the free path.
- Q: What can an instructor change after a code exists? → A: Disable or re-enable it, change its expiry, and raise or lower its usage limit (never below the count already redeemed or reserved). Its code text, type and value are fixed once created; to change them the instructor makes a new code. A code with any redemption cannot be deleted, only disabled; an unused code can be deleted.
- Q: Which failures does the student see, and do they reveal codes? → A: An unknown code and a code belonging to another course give the same "not valid for this course" message, so codes cannot be probed across courses. Expired, used up, already used by you and disabled each get their own message, since the student already holds the code.
- Q: How are codes typed? → A: Case-insensitive, 4 to 24 characters of letters, digits and hyphens, unique within a course. The instructor types one or asks for a generated one.
- Q: Does a coupon apply to free courses or to any course the instructor does not own? → A: No. A coupon needs a paid course (a price above zero); only the course's instructors manage its codes.
- Q: Do other in-flight specs conflict? → A: No overlap found. Catalogue categories (#333) lists list prices only and never shows a coupon price; notifications (#331) and the instructor dashboard (#332) may later read redemption data but this spec adds no hook for them.

### Session 2026-11-16 (clarify)

Resolved without asking (non-interactive run); each answer is the recommended option.

- Q: How long does a reserved redemption stay held while the student has not paid? → A: As long as the checkout can still be paid: the payment session is created to expire in 30 minutes (the shortest the payment provider allows), and the reservation is released when it expires. A short hold limits how long an abandoned checkout can block a limited code.
- Q: What if the student starts checkout again with a different code, or none, while an earlier unpaid checkout exists? → A: A student has at most one unpaid order per course. Starting again first expires the earlier order's payment session (so it can no longer be paid), then cancels the earlier order, releases its reservation and creates the new one in one write; if that session was already paid, the student is simply enrolled. The same applies when the new total is zero. The same code again returns the same unpaid order.
- Q: At what moment does an expiry date end the code? → A: The instructor picks a date; the code works through the end of that day in UTC and the screen says so. Stored as an instant, so there is one rule everywhere.
- Q: How does the instructor enter a fixed amount? → A: In the course's currency in whole and fractional units as people write them (for example 5.00), stored in minor units; the list shows the same format. Currencies with no minor unit follow #284's price rules.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Instructor creates a discount code for a course (Priority: P1)

An instructor of a paid course opens its Coupons screen and creates a code: the code text (typed or generated), a percent or a fixed amount off, an optional expiry date, an optional maximum number of redemptions. The code appears in the course's list with how many times it has been redeemed.

**Why this priority**: Nothing else can happen without codes, and it is the instructor half of the issue.

**Independent Test**: As an instructor of a paid course, create a percent code and a fixed code; see both listed with zero redemptions; try to create one with a bad value, a duplicate text, or as someone who does not teach the course.

**Acceptance Scenarios**:

1. **Given** an instructor of a paid course, **When** they create a code with a percent from 1 to 100 or a fixed amount, **Then** the code is stored for that course only and listed with its type, value, expiry, limit and redemption count.
2. **Given** a code text already used in that course (ignoring case), **When** the instructor creates another, **Then** it is refused as a duplicate; the same text may exist in a different course.
3. **Given** a percent outside 1 to 100, a fixed amount of zero or less, a fixed amount above the list price, an expiry in the past, or a limit below 1, **When** the instructor submits, **Then** it is refused with a message naming the field.
4. **Given** an unused code, **When** the instructor deletes it, **Then** it is gone; a code with any redemption can only be disabled.
5. **Given** a user who is not an instructor of the course, **When** they create, list, change or delete its codes, **Then** it is refused, and a free course refuses new codes.

---

### User Story 2 - Student applies a code and pays the discounted price (Priority: P1)

On a paid course's page, before paying, a student enters a code. The page shows the list price, the discount and the new total; pressing the pay button starts checkout for the discounted total. After payment the student is enrolled, exactly as for a full-price purchase.

**Why this priority**: This is the point of the feature and what instructors will measure it by.

**Independent Test**: As a student not enrolled in a paid course with a 20% code, apply the code, see the reduced total, start checkout, and check the order records the list price, the discount and the total, and that the code's redemption count went up by one.

**Acceptance Scenarios**:

1. **Given** a valid code, **When** the student applies it, **Then** they see the list price, the discount amount and the total they will pay, and may remove the code.
2. **Given** an applied code, **When** the student starts checkout, **Then** the payment is for the discounted total, and the order records the list price, the code, how it discounted, the discount amount and the total.
3. **Given** a code that is expired, used up, disabled, already used by this student, for another course, or unknown, **When** the student applies it, **Then** the matching message from the Clarifications is shown, no price changes, and nothing is reserved.
4. **Given** the page showed a discounted total, **When** the code expires, is disabled or is used up before the student pays, **Then** starting checkout re-checks the code on the server and refuses with the same messages: the price shown is never trusted.
5. **Given** a checkout started with a code that the student then abandons (the session expires or fails), **Then** the reservation is released and the code's count goes back down.
6. **Given** a student who is already enrolled, **When** they try to apply a code, **Then** it is refused.

---

### User Story 3 - A code that makes the course free enrols the student directly (Priority: P1)

When the total after the code is zero (a 100% code, or a fixed code at least the list price), pressing the button enrols the student immediately: no payment page, no Stripe session. The order is still recorded, with a total of zero.

**Why this priority**: It is in the issue and a different code path (no webhook), so it needs its own proof that enrolment happens exactly once.

**Independent Test**: Apply a 100% code as a student, press Enrol, and check the student is enrolled in a published course, an order with total zero and the discount exists, no Stripe session was created, and the redemption is counted once even if the button is pressed twice.

**Acceptance Scenarios**:

1. **Given** a code bringing the total to zero, **When** the student confirms, **Then** the enrolment, the zero-total order and the redemption are all written together, and the student sees the course as enrolled.
2. **Given** the student presses the button twice or from two tabs, **Then** one enrolment, one order and one redemption exist and both requests succeed with the same result.
3. **Given** the course is archived or unpublished while this runs, **Then** nothing is written, as for any enrolment.
4. **Given** the zero-total order, **Then** #284's rules apply as for any paid order: the student's access follows the order, and a later refund process has nothing to refund.

---

### User Story 4 - A code never goes beyond its usage limit (Priority: P1)

An instructor gives a code a limit of N redemptions. However many students apply it at the same moment, at most N checkouts hold it.

**Why this priority**: It is the issue's acceptance criterion and the rule most likely to break; selling past a promised limit is a real-money failure.

**Independent Test**: With a limit of 3 and ten students starting checkout at the same moment, exactly 3 succeed and 7 are told the code is used up; the count is 3 and the invariant check passes. Repeat with a student retrying the same request.

**Acceptance Scenarios**:

1. **Given** a code with N redemptions left, **When** more than N distinct students start checkout simultaneously, **Then** exactly N succeed and the rest are refused as "used up".
2. **Given** a student who has the code reserved, **When** they start checkout again (a retry, a second tab), **Then** they get the same reservation, not a second one, and the count does not move.
3. **Given** a reservation released by an expired checkout, **When** another student applies the code, **Then** that redemption is available again.
4. **Given** a code with no limit, **Then** redemptions are unlimited but each student still redeems at most once.
5. **Given** the instructor lowers the limit while checkouts are in flight, **Then** it is refused if below what is already redeemed or reserved.

---

### User Story 5 - Instructor manages and reviews codes (Priority: P2)

The instructor sees each code's state (active, expired, used up, disabled), disables or re-enables it, changes its expiry or limit, and sees how many redemptions it has had.

**Why this priority**: Useful control, but a created code already works without it.

**Independent Test**: Disable a code and check a student can no longer apply it; re-enable it; extend its expiry; try to lower its limit below the count.

**Acceptance Scenarios**:

1. **Given** a code, **When** the instructor disables it, **Then** new applications fail as disabled, and checkouts already started with it still complete.
2. **Given** a disabled code, **When** the instructor re-enables it, **Then** it works again if not expired or used up.
3. **Given** the list, **Then** each code shows its status derived from its state, expiry and count, and its redeemed count.
4. **Given** a code text, type or value, **Then** the screen offers no way to edit them after creation.

---

### Edge Cases

- Two students take the last redemption at the same moment: one succeeds, one is told "used up".
- The same student double-submits checkout with a code: one reservation, one order.
- The checkout session expires or the payment fails after reserving: the reservation is released once, and a late "paid" event for an order whose reservation was released is handled by #284's rules; the redemption must still match an order that exists.
- A code expires between applying it and paying: the server re-check refuses; a reservation made before expiry still completes payment.
- The course's list price changes after a code was created: the code follows the new price (a percent code takes its percent of it; a fixed code is capped at it), and orders already made keep their own snapshot. A fixed code created above a lowered price simply gives total zero.
- A fixed code larger than the price gives total zero, never negative.
- A percent of 100 and a fixed code equal to the price both give total zero.
- A total that is not zero but below the provider's minimum charge is refused with a clear message.
- An instructor deletes a code with a live reservation: refused, since it has a redemption.
- Course archived: its codes cannot be applied; its orders and redemptions are kept.
- A student starts checkout with code A, then again with code B before paying: B is validated first and, if it is refused, A's checkout is untouched; otherwise A's payment session is expired, then A's reservation is released and B's taken in one write. A student whose earlier checkout was paid at that moment is enrolled, and B is not claimed.
- A student with an unpaid paid-checkout applies a free-making code: the earlier session is expired first, so it can never charge them after they are enrolled.
- A student reuses a code they already used in the same course: refused as already used, including after a refund.
- A course changes currency: its fixed codes are in the old currency and are refused at checkout and preview with "not valid for this course" until the instructor makes new ones; percent codes keep working.
- A course becomes free (its price is removed) after codes exist: the codes stay stored but preview and checkout refuse them with "not valid for this course", since a free course is enrolled in as usual.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An instructor of a paid course MUST be able to create, list, disable, re-enable, change the expiry or limit of, and delete an unused code for that course. Only the course's instructors MAY do so; free courses MUST NOT accept codes.
- **FR-002**: A code MUST have text (case-insensitive, 4 to 24 characters of letters, digits and hyphens, unique within its course), a type (percent from 1 to 100, or a fixed amount in the course's currency above zero and not above the list price), an optional expiry (a date: the code works through the end of that day in UTC), an optional redemption limit of at least 1, and an enabled flag. Type, value and text MUST NOT change after creation.
- **FR-003**: The price calculation MUST live in one pure function that takes a list price in minor units, the currency and a code, and returns the list price, the discount amount, the total and whether the total is zero. A percent discount is the percent of the list price rounded down; a fixed discount is capped at the list price; the total is never negative. Checkout, the preview and the free path MUST all use this function and nothing else computes a discounted price.
- **FR-004**: A signed-in student MUST be able to apply a code to a published paid course they are not enrolled in and see the list price, discount and total before paying. Applying MUST read only and reserve nothing.
- **FR-005**: Starting checkout with a code MUST re-validate the code on the server (existing, enabled, not expired, not used up, not already used by this student, belongs to this course, resulting total zero or at least the provider's minimum charge) and MUST charge the total the server computes, never an amount sent by the browser.
- **FR-006**: Starting checkout with a valid code MUST reserve one redemption and create the order in one atomic write. The write MUST refuse when the count would exceed the limit, so at most N reservations exist for a limit of N whatever the concurrency. A request that loses a race for the same coupon record may be asked to retry; once every such request has been retried to completion, exactly N hold the code. Repeating the request for the same student, course and code MUST return the same order and reservation.
- **FR-007**: A student MUST have at most one unpaid order per course: starting checkout again (with another code, none, or a free-making code) MUST first expire the earlier order's payment session, and only then cancel the earlier order, release its reservation and create the new one atomically; a reservation MUST NOT be released while its payment session can still be paid. A reservation lasts as long as its payment session can still be paid (30 minutes) and MUST be released exactly once when its checkout expires, is cancelled or fails (a release lost with a missed event is repaired by the next claim that finds the code used up, once the payment session can no longer be paid plus a 5 minute grace), and MUST become permanent when the order is paid or is a zero-total order. A refund MUST NOT release it.
- **FR-008**: When the total is zero, the system MUST create the enrolment, the order (total zero) and the redemption in one atomic write, without creating a Stripe Checkout session, and MUST be idempotent under repeats and concurrency. It MUST apply the same checks as enrolling in a course today (published).
- **FR-009**: Each order MUST record the list price, the currency, the discount type and value as they were, the code text, the discount amount and the total, so that payouts, refunds and reports can reconcile without reading the code, which may later change or be deleted. An order without a code records a discount of zero and no code.
- **FR-010**: Each student MUST redeem a given code at most once. A student enrolled in the course MUST NOT be able to redeem any code for it.
- **FR-011**: Each failure (unknown or other-course, expired, used up, disabled, already used by you, total below the minimum) MUST show its own clear message, except that unknown and other-course MUST look the same.
- **FR-012**: Writes that keep the redemption count, the reservation, the order and the enrolment consistent MUST go through one shared `core-table` helper that every writer (instructor-api, core-api, the checkout webhook, the expiry handler) calls, and invariant checks that a test can break MUST cover: a code's redeemed count equals its live redemptions; no code's count exceeds its limit; each redemption has an order carrying that code and discount; each student has at most one redemption per code; every order's list price minus discount equals its total; a zero-total order with a redemption has its enrolment.
- **FR-013**: Codes, redemptions and the discount fields of orders MUST be retained when a course is archived, and MUST NOT be exposed to anyone but the course's instructors (list) and the redeeming student (their own order).
- **FR-014**: The feature MUST work end to end in local development without an AWS account, including the free path and the paid path against Stripe's test mode as #284 provides it.
- **FR-015**: The feature MUST NOT add site-wide or multi-course codes, auto-applied promotions, referral or affiliate codes, bulk code generation, per-student targeted codes, sale-price or scheduled-price features, or automatic refunds of discounts (see Assumptions).

### Key Entities

- **Coupon**: A code for one course. Has the code text, the course, a type and value, an optional expiry and limit, an enabled flag, who created it and when, and the number of redemptions currently held. Looked up by course and text (applying), and by course (the instructor's list).
- **Coupon redemption**: One per student per code. Records the coupon, the student, the order and whether it is reserved or permanent. Written together with the order and the coupon's count.
- **Order** (from #284): Gains the discount snapshot (FR-009). A zero-total order is created without a Stripe session.
- **Enrolment**: Existing. The free path creates it in the same write as the order and redemption.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of runs, however many students start checkout at the same moment, the number of live redemptions of a code never exceeds its limit, and the data-consistency check passes after every test.
- **SC-002**: A student sees the discounted total within 2 seconds of entering a valid code, and the amount charged equals that total in 100% of orders.
- **SC-003**: A student with a total-zero code is enrolled in one step with no payment page, in under 5 seconds, and exactly once under repeats.
- **SC-004**: 100% of orders made with a code record a list price, discount and total that add up (list minus discount equals total) and agree with the code as it was at the time.
- **SC-005**: 0 cases where a student redeems the same code twice or where a student who is not an instructor of the course reads or changes its codes.
- **SC-006**: 100% of reservations whose checkout expires are released, and a code can be used again afterwards.

## Assumptions

- **Dependency on #284.** The specification for #284 (Stripe checkout) was written in parallel and was not available when this one was written. This spec assumes these concepts from it and keeps all coupon logic behind the price-calculation helper (FR-003) and the one core-table write helper (FR-012), so it survives whatever #284 decides about their shape:
  - A course has a price in minor units and a currency, and a price of zero or none means free.
  - An order record exists, with the student, the course, a status (pending, paid, expired or failed, refunded) and the amount in minor units.
  - A Stripe Checkout session is created on the server for a pending order, a webhook marks the order paid and creates the enrolment exactly once, and an expired or failed session marks the order expired or failed.
  - Refunds revoke or flag access under #284's rules; this spec only requires that a refund not release the redemption.
- **What #286 (payouts) needs.** Each order records list price, discount amount, total, currency, code and discount type and value (FR-009), so earnings reports can show gross, discount and net and reconcile with orders and refunds, and a zero-total order is visible as a no-revenue enrolment. Who bears a discount (the instructor) and the platform fee on a discounted total are #286's decisions; this spec only supplies the numbers.
- The reservation is created when checkout starts, and released by the same mechanism #284 uses to learn that a session expired or failed (the Stripe `checkout.session.expired` webhook, and a local stand-in for it). If #284 does not mark expired orders, a task in the plan adds it.
- Fixed amounts are in the course's currency. Changing a course's currency or price is #284's decision; this spec requires only that the discount calculation use the order's snapshot at checkout and never fail an existing order.
- Percent discounts are whole percents, 1 to 100.
- The provider's minimum charge is the minimum Stripe accepts for the currency, held as one constant per currency near the price helper.
- Rate limiting of code guesses relies on the existing WAF and on codes being at least 4 characters of a mixed alphabet; there is no separate lockout. A generated code has 40 bits of randomness.
- Instructors see only the number of redemptions, not who redeemed. Reviewing who used a code is a follow-up.
- Out of scope: site-wide, multi-course, auto-applied, referral, affiliate, per-student or bulk-generated codes; sale prices and scheduled price changes; emailing codes; discounts on subscriptions or bundles; admin views; coupon analytics; stacking two codes.
- Discava has not launched: no old data or URLs to preserve, so entities, procedures and routes are added outright, with no migration or fallbacks.
- Only the final implementation PR may close #285.
