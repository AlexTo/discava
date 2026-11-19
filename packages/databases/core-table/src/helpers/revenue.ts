/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Instructor revenue rules (data-model.md "Rules", research R-5). Pure: every
// amount is an integer in a currency's minor units, so nothing here uses
// floating point, and nothing here knows of orders, entries or timestamps.

const BASIS_POINTS = 10000;

export interface InstructorSale {
  instructorId: string;
  /** The instructor's share of the order's list price. */
  grossMinor: number;
  /** The instructor's share of the discount: gross share minus paid share. */
  discountMinor: number;
  /** The instructor's share of the platform fee. */
  feeMinor: number;
  /** Paid share minus fee share. */
  netMinor: number;
}

export interface InstructorRefund {
  instructorId: string;
  /** The instructor's share of the amount refunded by this step. */
  refundMinor: number;
  /** Fee given back by this step: zero or negative. */
  feeMinor: number;
  /** Fee given back minus the amount refunded: usually negative. */
  netMinor: number;
}

export interface SaleInput {
  grossMinor: number;
  paidMinor: number;
  feeBasisPoints: number;
  instructorIds: readonly string[];
}

export interface RefundInput extends SaleInput {
  /** The refunded total the ledger already holds (`earningOrder.refundedMinor`). */
  recordedRefundedMinor: number;
  /** The order's refunded total; the part above the amount paid is ignored. */
  refundedTotalMinor: number;
}

const requireInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be an integer, got ${value}`);
  }
};

const requireAmount = (name: string, value: number): void => {
  requireInteger(name, value);
  if (value < 0) throw new RangeError(`${name} must not be negative`);
};

const requireBasisPoints = (value: number): void => {
  requireAmount('feeBasisPoints', value);
  if (value > BASIS_POINTS) {
    throw new RangeError('feeBasisPoints must be at most 10000');
  }
};

const sortedRecipients = (instructorIds: readonly string[]): string[] => {
  if (instructorIds.length === 0) {
    throw new RangeError('instructorIds must not be empty');
  }
  const sorted = [...instructorIds].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      throw new RangeError(`Duplicate instructor ${sorted[i]}`);
    }
  }
  return sorted;
};

/**
 * The platform fee on an amount: round-half-up of
 * `amountMinor * feeBasisPoints / 10000`, in integer arithmetic.
 */
export const calculateFee = (
  amountMinor: number,
  feeBasisPoints: number,
): number => {
  requireAmount('amountMinor', amountMinor);
  requireBasisPoints(feeBasisPoints);
  const scaled = amountMinor * feeBasisPoints;
  requireInteger('amountMinor * feeBasisPoints', scaled);
  return Math.floor((scaled + BASIS_POINTS / 2) / BASIS_POINTS);
};

/**
 * Shares an amount equally among the instructors, sorted by ID ascending. The
 * remainder minor units go one each to the first instructors, so the shares
 * always add up to the whole.
 */
export const splitAmount = (
  amountMinor: number,
  instructorIds: readonly string[],
): { instructorId: string; amountMinor: number }[] => {
  requireAmount('amountMinor', amountMinor);
  const recipients = sortedRecipients(instructorIds);
  const base = Math.floor(amountMinor / recipients.length);
  const remainder = amountMinor % recipients.length;
  return recipients.map((instructorId, index) => ({
    instructorId,
    amountMinor: base + (index < remainder ? 1 : 0),
  }));
};

const validateSale = ({
  grossMinor,
  paidMinor,
  feeBasisPoints,
}: SaleInput): void => {
  requireAmount('grossMinor', grossMinor);
  requireAmount('paidMinor', paidMinor);
  requireBasisPoints(feeBasisPoints);
  if (paidMinor > grossMinor) {
    throw new RangeError('paidMinor must not exceed grossMinor');
  }
};

/**
 * What each instructor earns from a sale. The split is applied to the gross,
 * to the amount paid and to the fee; an instructor's discount is their gross
 * share minus their paid share, so no refund ever leaves one a unit out.
 */
export const calculateSale = (input: SaleInput): InstructorSale[] => {
  validateSale(input);
  const { grossMinor, paidMinor, feeBasisPoints, instructorIds } = input;
  const gross = splitAmount(grossMinor, instructorIds);
  const paid = splitAmount(paidMinor, instructorIds);
  const fee = splitAmount(
    calculateFee(paidMinor, feeBasisPoints),
    instructorIds,
  );
  return gross.map(({ instructorId, amountMinor }, index) => ({
    instructorId,
    grossMinor: amountMinor,
    discountMinor: amountMinor - paid[index].amountMinor,
    feeMinor: fee[index].amountMinor,
    netMinor: paid[index].amountMinor - fee[index].amountMinor,
  }));
};

/**
 * What each instructor gives back when the order's refunded total rises from
 * what the ledger holds to `refundedTotalMinor` (capped at the amount paid).
 * Each share is the share of the new total minus the share of the recorded
 * one, so however a refund is cut into steps, and whichever step is seen
 * first, the entries add up to the sale's amounts and fee exactly once the
 * total reaches the amount paid. A total at or below the recorded one returns
 * nothing, and so does an instructor whose share of the step is zero in every
 * figure.
 */
export const calculateRefund = (input: RefundInput): InstructorRefund[] => {
  validateSale(input);
  const {
    paidMinor,
    feeBasisPoints,
    instructorIds,
    recordedRefundedMinor,
    refundedTotalMinor,
  } = input;
  requireAmount('recordedRefundedMinor', recordedRefundedMinor);
  requireAmount('refundedTotalMinor', refundedTotalMinor);
  if (recordedRefundedMinor > paidMinor) {
    throw new RangeError('recordedRefundedMinor must not exceed paidMinor');
  }
  const total = Math.min(refundedTotalMinor, paidMinor);
  if (total <= recordedRefundedMinor) return [];

  const refundedNow = splitAmount(total, instructorIds);
  const refundedBefore = splitAmount(recordedRefundedMinor, instructorIds);
  const feeNow = splitAmount(
    calculateFee(total, feeBasisPoints),
    instructorIds,
  );
  const feeBefore = splitAmount(
    calculateFee(recordedRefundedMinor, feeBasisPoints),
    instructorIds,
  );

  const refunds: InstructorRefund[] = [];
  refundedNow.forEach(({ instructorId }, index) => {
    const refundMinor =
      refundedNow[index].amountMinor - refundedBefore[index].amountMinor;
    const feeReturned =
      feeNow[index].amountMinor - feeBefore[index].amountMinor;
    if (refundMinor === 0 && feeReturned === 0) return;
    refunds.push({
      instructorId,
      refundMinor,
      feeMinor: 0 - feeReturned,
      netMinor: feeReturned - refundMinor,
    });
  });
  return refunds;
};
