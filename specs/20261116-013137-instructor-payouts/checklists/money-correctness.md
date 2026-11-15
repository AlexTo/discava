# Money Correctness Requirements Checklist: Instructor Revenue Reporting and Payouts

**Purpose**: Unit tests for the requirements: are the money rules (reconciliation, idempotency, refunds, payout correctness, protection of financial data) complete, clear, consistent and measurable?
**Created**: 2026-11-16
**Feature**: [spec.md](../spec.md)

**Note**: This checklist is reviewer-owned. `[x]` means a reviewer judged the requirements-quality question satisfied; it does not mean implementation is done.

## Reconciliation

- [ ] CHK001 Is "reconcile" defined as an exact identity in minor units, for rows, totals, periods and single orders? [Clarity, Spec §FR-003, §FR-007]
- [ ] CHK002 Is it stated which period a sale and a refund fall into, so a closed period cannot silently change? [Clarity, Spec §FR-008]
- [ ] CHK003 Are the report's sums required to equal the underlying earnings and adjustments, and orders and refunds beyond them? [Completeness, Spec §FR-007]
- [ ] CHK004 Is the drill-down's relationship to each row's figures (lines sum to the row) specified? [Consistency, Spec §FR-021]
- [ ] CHK005 Is behaviour specified when figures in more than one currency exist? [Coverage, Spec Edge Cases]

## Idempotency and ordering

- [ ] CHK006 Are paid and refund events required to be safe against repeats, concurrency and reordering? [Completeness, Spec §FR-001, §FR-004, Edge Cases]
- [ ] CHK007 Is the unit of idempotency named for each record (per order and instructor; per refund)? [Clarity, Spec §FR-001, §FR-004]
- [ ] CHK008 Is "never paid out twice" stated with a measurable criterion and its scope (retries, parallel runs)? [Measurability, Spec §FR-012, §SC-006]

## Refunds, disputes and rounding

- [ ] CHK009 Is the share of fee and instructor amount returned on a partial refund defined, including rounding? [Clarity, Spec §FR-004, Edge Cases]
- [ ] CHK010 Is the cap that stops an order netting below zero stated, and is a duplicate refund addressed? [Coverage, Spec §FR-004]
- [ ] CHK011 Is who bears a lost dispute and its fees defined, and the won-after-lost case explicitly excluded? [Gap, Spec Clarifications]
- [ ] CHK012 Is the rounding rule for fee, instructor amount and multi-instructor split deterministic and testable? [Measurability, Spec §FR-003]
- [ ] CHK013 Are refunds for orders with no earning (free, pre-feature) addressed? [Edge Case, Spec Edge Cases]

## Payout correctness

- [ ] CHK014 Are all conditions for sending money listed (active account, hold elapsed, minimum reached)? [Completeness, Spec §FR-012]
- [ ] CHK015 Is every payout status defined with what the instructor sees and what moves it to the next? [Clarity, Spec §FR-013]
- [ ] CHK016 Are requirements defined for a failed or rejected transfer and its retry? [Coverage, Spec Story 4]
- [ ] CHK017 Is recovery of a refund after money was sent defined, including negative balances and closed accounts? [Coverage, Spec §FR-014]
- [ ] CHK018 Are the fee, hold and minimum defined as per-stage settings with defaults and validation limits? [Clarity, Spec §FR-002, §FR-015]
- [ ] CHK019 Is it stated that a changed fee never alters recorded earnings? [Consistency, Spec §FR-002]

## Security and data protection

- [ ] CHK020 Is it stated what financial data Discava must never store (bank, identity details)? [Completeness, Spec §FR-010]
- [ ] CHK021 Are the authenticity and verification requirements for incoming payment-provider events stated? [Completeness, Spec §FR-011]
- [ ] CHK022 Are read limits specified for every role (student, other instructor, anonymous, admin)? [Coverage, Spec §FR-009, §FR-016]
- [ ] CHK023 Is buyer identity excluded from every instructor-facing view, including drill-down? [Consistency, Spec §FR-009, §FR-021]

## Dependencies and assumptions

- [ ] CHK024 Are the assumed order, refund, discount and dispute concepts from the checkout and coupon features listed with a way to reconcile once those specs merge? [Dependency, Assumption]
- [ ] CHK025 Is the tax boundary stated (tax-exclusive amount, out of scope) and consistent with the fee base? [Assumption, Spec Assumptions]
- [ ] CHK026 Is the split among instructors fixed at payment time and consistent with what the report shows? [Consistency, Spec Clarifications]
- [ ] CHK027 Are integer minor-unit storage and display formatting required consistently? [Clarity, Spec §FR-020]
- [ ] CHK028 Is the local stand-in boundary stated, including what only a deployed stage can verify? [Completeness, Spec §FR-018, Assumptions]
