# Feature Specification: Instructor Revenue Reporting and Payouts

**Feature Branch**: `spec/instructor-payouts` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Issue #286: instructors need to see and receive earnings once courses are paid. Stripe Connect onboarding for instructors; platform fee configurable per stage. Earnings report per course and period; payout status. Refund adjustments. Depends on the payments issue. Acceptance: report totals reconcile with orders and refunds."

**Parent issue**: #286

**Depends on**: #284 (Stripe checkout and orders) and #285 (coupons), both being specified in parallel. Their specs are not on `main` yet; the order, refund and discount concepts this spec relies on are listed in Assumptions.

## Clarifications

### Session 2026-11-16

Resolved without asking, using the recommended defaults below (non-interactive run).

- Q: Who bears a lost dispute (chargeback) and Stripe's dispute fee? → A: The instructor amount of that order is reversed in full, like a full refund; Stripe's dispute fee and any shortfall are borne by the platform.
- Q: Can an instructor's course be sold, and earnings accrue, before they have connected a payout account? → A: Yes. Earnings accrue as "Waiting for account setup" and are sent once the account is active; nothing blocks the sale.
- Q: What periods can the report cover? → A: A UTC calendar month (default: the current month) or a custom date range of at most 366 days; longer or inverted ranges are refused with a clear message.
- Q: Does the report let an instructor see the orders behind each figure? → A: Yes. Each course row expands to a paged list of its sales and refunds in the period (order reference, date, amount lines), with no buyer identity, so totals can be checked line by line.
- Q: How is an order shared among a course's instructors, and can the fee differ per course? → A: Equally among the instructors at payment time, and the fee is one percentage per stage, never per course or per instructor.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what I earned, per course and period (Priority: P1)

An instructor opens an Earnings page in the instructor portal and picks a period (a calendar month, or a custom date range). For each of their paid courses they see how many orders were paid, the gross sales, discounts given, refunds, the platform fee and their net earnings, plus a total row. The numbers add up: gross minus discounts minus refunds minus fee equals net, and every figure can be traced back to orders and refunds.

**Why this priority**: This is the issue's acceptance criterion ("report totals reconcile with orders and refunds") and the first thing instructors need once courses are paid. It is useful even before any money moves.

**Independent Test**: Create paid orders for two courses (one with a coupon discount), refund one in part, open Earnings for the period, and check each column against the orders and refunds, and that the total row equals the sum of the course rows.

**Acceptance Scenarios**:

1. **Given** an instructor with paid orders in a period, **When** they open Earnings for that period, **Then** each course shows orders, gross, discounts, refunds, platform fee and net, and a total row sums them.
2. **Given** any report, **Then** gross minus discounts minus refunds minus platform fee equals net for every row and for the total, to the minor unit.
3. **Given** an order paid in one period and refunded in a later one, **When** the instructor views each period, **Then** the sale appears in the first and the refund (negative) in the second, and the two periods together net to zero for that order.
4. **Given** a course with no orders in the period, **Then** it is shown with zeros (or omitted from the rows with a clear empty state if the instructor has no paid courses at all), never an error.
5. **Given** an instructor, **When** they open Earnings, **Then** they see only their own share of their own courses, never another instructor's figures or any buyer's identity.
6. **Given** a course taught by two instructors, **Then** each sees their own share of every order, and the shares add up to the order's instructor amount.
7. **Given** a course row, **When** the instructor expands it, **Then** a paged list shows each sale and refund of the period (order reference, date, gross, discount, fee, net) whose lines sum to the row's figures, with no buyer identity.
8. **Given** a custom range longer than 366 days or ending before it starts, **Then** the report is refused with a clear message.

---

### User Story 2 - Connect my Stripe account to get paid (Priority: P1)

An instructor starts payout setup from the Earnings page, completes Stripe's hosted onboarding (identity and bank details, which Discava never sees), and comes back to the portal. The page shows their payout account status: not started, in progress, active, or restricted (needs more information), with a way to continue or to open their Stripe dashboard.

**Why this priority**: No payout can happen without a connected account. Onboarding also tells the instructor what Stripe still needs from them.

**Independent Test**: As an instructor with no account, start setup, complete onboarding (a local stand-in locally; Stripe test mode when deployed), and see the status become active. Start again partway and see "in progress".

**Acceptance Scenarios**:

1. **Given** an instructor with no payout account, **When** they choose Set up payouts, **Then** they are sent to Stripe-hosted onboarding and returned to the Earnings page.
2. **Given** onboarding is incomplete, **When** the instructor returns, **Then** the page shows "In progress" and a Continue setup action.
3. **Given** Stripe reports the account can receive payouts, **Then** the page shows "Active".
4. **Given** Stripe later restricts the account (more information required), **Then** the page shows "Restricted" with a Fix account action, and no new payouts are sent until it is active again, while earnings keep accruing.
5. **Given** an active account, **When** the instructor chooses Open Stripe dashboard, **Then** they land on their own Stripe dashboard.
6. **Given** a user who is not an instructor, **Then** they cannot start onboarding or read any payout account.

---

### User Story 3 - Earnings follow orders, discounts and refunds automatically (Priority: P1)

Whenever a student's payment for a course succeeds, the instructor's earnings for it are recorded: the amount the student actually paid (after any coupon), less the platform fee for the stage, shared among the course's instructors. When that payment is later refunded (fully or partly), or a dispute is lost, a matching negative adjustment is recorded. Nothing is recorded twice when Stripe resends an event.

**Why this priority**: The report and every payout are only as right as these records. Exactly-once recording and exact refund adjustment are the rules most likely to break.

**Independent Test**: Deliver the same paid event twice and concurrently: one earning is recorded. Refund 30% of the order: the adjustment is 30% of the instructor amount and of the fee, to the minor unit. Refund the rest: the earning is exactly zero.

**Acceptance Scenarios**:

1. **Given** a paid order, **When** the payment is confirmed, **Then** the course's instructors' earnings are recorded once, from the amount paid after discount, with the platform fee in effect at that time.
2. **Given** the same payment event delivered again or at the same time as itself, **Then** no second record is created.
3. **Given** a partial refund, **Then** a negative adjustment is recorded for the refunded share of the instructor amount and of the fee; further refunds adjust again, and total adjustments never exceed the original earning.
4. **Given** a full refund or a lost dispute, **Then** the order's earning nets to exactly zero.
5. **Given** an order paid in full by a 100% coupon (amount paid is zero), **Then** no earning is recorded.
6. **Given** the platform fee setting changes, **Then** earnings already recorded keep the fee they were recorded with.

---

### User Story 4 - Get paid, and see the payout status (Priority: P2)

Once an instructor's account is active, earnings that have passed the stage's hold period are sent to their Stripe account automatically, so instructors don't request payouts. The Earnings page shows what is on hold (with its release date), what is ready, what was sent (with date and amount), and what failed or is blocked and why. If a refund arrives after money was sent, the amount is deducted from the next payout.

**Why this priority**: This delivers the "receive" half of the issue, but it only matters once reporting and onboarding exist, and a first release could stop at reporting.

**Independent Test**: With an active account and earnings past the hold period, run the payout run and see the transfer recorded and shown as sent. Run it again: nothing is sent twice. Refund an already sent order: a reversal or a deduction is recorded and the balance shown is correct.

**Acceptance Scenarios**:

1. **Given** an active account and earnings older than the hold period, **When** the payout run happens, **Then** their balance is sent as one payout and shown as Sent with its date and amount.
2. **Given** earnings still inside the hold period, **Then** they show as On hold with a release date and are not sent.
3. **Given** a payout run repeated or retried, **Then** the same earnings are never sent twice.
4. **Given** an account that is not active, **Then** earnings stay as Waiting for account setup and are sent after it becomes active, with nothing lost.
5. **Given** a payout that Stripe rejects, **Then** it shows as Failed with a reason, its earnings go back to ready, and a later run retries them.
6. **Given** a refund after the money was sent, **Then** the adjustment is deducted from the instructor's next payout (money is not pulled back from their Stripe account), and the balance never silently hides a negative amount.
7. **Given** a balance below the stage's minimum payout amount, **Then** it is held as Ready until it reaches the minimum.

---

### User Story 5 - Operators set the platform fee and payout rules per stage (Priority: P2)

A maintainer sets the platform fee percentage, the hold period in days and the minimum payout amount in the stage configuration, and deploys. Each stage can differ (development charges a test fee, production the real one).

**Why this priority**: Required by the issue ("configurable per stage"), but a sensible default lets the rest work.

**Independent Test**: Deploy two stages with different fees; the same order yields different fees on each.

**Acceptance Scenarios**:

1. **Given** a stage with a fee of 20%, **When** an order of 100.00 is paid, **Then** the platform fee recorded is 20.00 and the instructor amount 80.00.
2. **Given** a stage config with an invalid fee (below 0 or above 100%), **Then** the build or deployment rejects it.
3. **Given** a fee of 0%, **Then** instructors earn the whole amount paid.

---

### Edge Cases

- Rounding: the platform fee is rounded to the nearest minor unit (half up) and the instructor amount is the remainder, so fee plus instructor amount always equals the amount paid. Splitting among instructors gives any leftover minor units to the first instructor by ID, deterministically.
- A course whose instructors change after a sale: the split is fixed when the earning is recorded; later changes do not move past earnings.
- A course taught by an instructor with no account: their share accrues as Waiting for account setup; other instructors are paid.
- A refund larger than what remains of an earning (duplicate refund events): adjustments are capped so an order never nets below zero.
- A refund event for an order that has no earning (unpaid, free, or recorded before this feature): ignored with no error.
- Orders in different currencies: figures are never summed across currencies; the report shows a section per currency.
- A dispute (chargeback) lost: treated as a full refund of that order; a dispute won after loss is out of scope.
- A refund arriving after the instructor's account was closed: stays as a negative balance, shown as such.
- Stripe retries or reorders events (refund before paid event is processed): the records settle to the same result once both are processed.
- A report period that starts in the future: an empty state. A range that ends before it starts or is longer than 366 days: a clear validation message, never a crash.
- A lost dispute: the instructor amount is reversed in full; Stripe's dispute fee is the platform's cost and never shown to or charged to the instructor.
- Taxes: out of scope; amounts are as recorded on the order (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When an order's payment is confirmed, the system MUST record exactly one earning per instructor of the order's course, derived from the amount the student actually paid (after discounts). Recording MUST be idempotent against repeated, retried and concurrent events.
- **FR-002**: The platform fee MUST be a percentage set per stage in the stage configuration, defaulting to a documented value, and MUST be validated at build time to be between 0 and 100 inclusive. The fee in effect when an earning is recorded MUST be stored with it and never recalculated.
- **FR-003**: Fee and instructor amount MUST always add up exactly to the amount paid, in the order's currency's minor units, with the rounding rule in Edge Cases.
- **FR-004**: When an order is refunded (in part or in full) or a dispute is lost, the system MUST record a negative adjustment for the refunded share of the instructors' amounts and of the fee, idempotently per refund, capped so the order's earning never goes below zero.
- **FR-005**: Earnings and adjustments MUST be recorded only through one shared `core-table` helper that every writer calls. The invariant checks MUST include that, per order, adjustments never exceed the earning, fee plus instructor amounts equal the amount paid, and each earning matches a paid order and a course instructor at the time.
- **FR-006**: Instructors MUST be able to read an earnings report for a period (calendar month or custom range, in UTC), showing per course and in total: paid orders, gross, discounts, refunds, platform fee and net, per currency.
- **FR-007**: Report figures MUST reconcile: for every row and total, gross minus discounts minus refunds minus fee equals net, and the figures MUST equal the sums of the underlying earnings and adjustments. A test MUST fail when they diverge, and the invariant checks MUST include the same identity per order.
- **FR-008**: A sale counts in the period of its payment time and a refund in the period of the refund, so a period's report never changes after the period ends except for late-arriving refunds, which appear in their own period.
- **FR-009**: The report and every earnings read MUST be limited to the calling instructor's own share of their own courses and MUST NOT expose buyer identity or other instructors' figures.
- **FR-010**: Instructors MUST be able to start, resume and finish Stripe Connect onboarding from the portal, see their account's status (not started, in progress, active, restricted), and open their Stripe dashboard. Discava MUST NOT store bank or identity details.
- **FR-011**: The account status MUST be refreshed from Stripe when the instructor opens the Earnings page, when they return from onboarding, and before each payout, so a stale status never causes money to be sent to a restricted account.
- **FR-012**: Earnings MUST be sent to an instructor's Stripe account automatically, only when the account is active, only after the stage's hold period, only when the balance reaches the stage's minimum payout, and never twice for the same earnings.
- **FR-013**: The Earnings page MUST show payout status per amount: On hold (with release date), Waiting for account setup, Ready, Sent (date, amount), Failed (reason), plus the current balance and any negative balance.
- **FR-014**: A refund after sending MUST be carried as a deduction on the instructor's next payout, MUST NOT be pulled back from their Stripe account in this feature, and MUST be visible to them as a negative balance.
- **FR-015**: The hold period and minimum payout amount MUST be per-stage configuration, validated at build time.
- **FR-016**: Students, other instructors and anonymous users MUST NOT be able to read any earning, payout or payout account; only instructors read their own, and only an instructor may start onboarding.
- **FR-017**: Revenue calculation (fee, split, refund share) MUST live in one pure helper used by the recording code, the report and the tests, so its rules are written once.
- **FR-018**: The feature MUST work end to end in local development without an AWS account or a Stripe account, against a local stand-in for the Stripe Connect calls, including recording, reporting, onboarding status and the payout run.
- **FR-019**: The feature MUST NOT add tax calculation or reporting, invoices, instructor-visible buyer lists, admin payout dashboards, multi-currency conversion, platform-funded coupons or manual payout requests (see Assumptions).
- **FR-020**: Money amounts MUST be stored and calculated as integers in minor units, never floating point, and shown formatted for the instructor's locale and the order's currency.
- **FR-021**: Each course row MUST expand to a paged list of that period's sales and refunds (order reference, date, gross, discount, refund, fee, net) that sums to the row, without buyer identity. A period is a UTC calendar month or a custom range of at most 366 days, and any other range MUST be refused with a clear message.
- **FR-022**: A course's earnings MUST accrue even when an instructor has no active payout account; the sale is never blocked by payout setup.

### Key Entities

- **Order**: Existing from #284: the buyer, the course, the gross price, any discount from a coupon (#285), the amount paid, the currency, and its paid or refunded state.
- **Earning**: One per order per instructor, recording the instructor's amount, their share of the platform fee, the fee percentage used, the currency, and when it was recorded. Never edited after it is recorded.
- **Adjustment**: A negative entry tied to one earning and one refund or dispute, with the refunded amounts and when it happened.
- **Payout account**: One per instructor: the link to their Stripe account and its status.
- **Payout**: A transfer of a set of earnings and adjustments to the instructor's Stripe account, with amount, status, date and failure reason.
- **Stage payout settings**: The platform fee percentage, hold days and minimum payout, from stage configuration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of test runs, the report totals equal the sum of the underlying orders and refunds to the minor unit, and the data-consistency check passes after every test.
- **SC-002**: However many times or how concurrently a paid or refund event is delivered, each order has exactly one earning per instructor and each refund exactly one adjustment.
- **SC-003**: An instructor sees a paid order in their report within 30 seconds of the payment.
- **SC-004**: An instructor opens a month's report in under 3 seconds regardless of how many orders their courses have had.
- **SC-005**: An instructor can complete payout setup and see their account status in under 5 minutes of their own time, with Stripe's hosted flow doing the identity and bank steps.
- **SC-006**: 0 cases where an earning is paid out twice, or paid out to an account that is not active.
- **SC-007**: 0 cases where a student, another instructor or an anonymous user can read an instructor's earnings or payout account.

## Assumptions

- **Order concepts from #284 and #285** (those specs are not yet on `main`; reconcile when they merge): an order record carries the buyer, course, gross price, discount amount, amount paid, currency in minor units, and a status moving from paid to refunded or partially refunded, driven by Stripe webhook events; refunds arrive as events identified by a refund ID, and a lost dispute is delivered like a full refund. All reporting reads these through one revenue-calculation helper, so a mismatch with the final order shape touches that helper and the event mapping only.
- Coupons are funded by the instructor: the platform fee and the instructor amount are both computed on the amount paid after discount. Platform-funded promotions are out of scope.
- Taxes are out of scope: the order's amount is treated as the revenue to split. If checkout later collects tax, the order must expose the tax-exclusive amount, and this feature reads that.
- The platform fee covers Stripe's own processing fees; instructors are never shown or charged them separately.
- A course taught by several instructors splits the instructor amount equally, with the rounding rule in Edge Cases, among the instructors at the time of payment.
- Money moves by Stripe Connect Express accounts, with the platform charging the student and later transferring the instructors' amounts (the choice and its alternatives are in research.md). Payouts from Stripe to the instructor's bank follow Stripe's own schedule; Discava shows its transfer status and links to the Stripe dashboard for the rest.
- The hold period defaults to 14 days, the minimum payout to a small stage-set amount, and the fee to a documented default; the payout run is automatic and daily. Instructors cannot request an early payout.
- Reports are in UTC and in the order's currency; no conversion across currencies.
- Earnings recorded before this feature (any orders paid before it ships) do not exist: Discava has not launched, so there is no historical data to backfill.
- Locally, the Stripe Connect calls run against a stand-in (the same one #284's checkout uses, extended with accounts, transfers and reversals, or a stand-in added here if it has none); payout transfers, account verification and real money movement are checked only on a deployed stage in Stripe test mode.
- Out of scope: reversing transfers on Stripe's side (refunds after sending are deducted from the next payout instead), a Stripe webhook for account changes (status is pulled when needed), tax, invoices, instructor-visible buyer data, admin payout dashboards, currency conversion, platform-funded coupons, manual payout requests, payout schedule choice per instructor, subscriptions and revenue sharing rules other than equal split.
- Discava has not launched: no old data or URLs to preserve, so the new records, routes and stage settings are added outright.
- The instructor dashboard spec (#332) may later surface a revenue summary; this feature exposes the report procedure it can reuse and adds no dashboard card itself.
- Only the final implementation PR may close #286.
