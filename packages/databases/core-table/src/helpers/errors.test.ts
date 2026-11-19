/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  cancellationReasons,
  failedAt,
  failedConditions,
  hasFailedCondition,
  hasTransactionConflict,
} from './errors.js';

const ok = { code: 'None' };
const failed = { code: 'ConditionalCheckFailed' };
const conflict = { code: 'TransactionConflict' };

describe('cancellationReasons', () => {
  it('returns the reasons, or none when there are none', () => {
    expect(cancellationReasons([ok, failed])).toEqual([ok, failed]);
    expect(cancellationReasons(undefined)).toEqual([]);
  });
});

describe('failedAt', () => {
  it('is true only for the item whose condition failed', () => {
    const reasons = [ok, failed, undefined];
    expect(failedAt(reasons, 0)).toBe(false);
    expect(failedAt(reasons, 1)).toBe(true);
    expect(failedAt(reasons, 2)).toBe(false);
    expect(failedAt(reasons, 5)).toBe(false);
  });

  it('checks a range of items when given an end', () => {
    const reasons = [ok, ok, failed];
    expect(failedAt(reasons, 0, 2)).toBe(false);
    expect(failedAt(reasons, 0, 3)).toBe(true);
    expect(failedAt(reasons, 2)).toBe(true);
  });
});

describe('failedConditions', () => {
  it('says per item whether its condition failed', () => {
    expect(failedConditions([ok, failed, conflict])).toEqual([
      false,
      true,
      false,
    ]);
    expect(failedConditions(undefined)).toEqual([]);
  });
});

describe('hasFailedCondition', () => {
  it('is true when any item failed its condition', () => {
    expect(hasFailedCondition([ok, undefined, failed])).toBe(true);
    expect(hasFailedCondition([ok, conflict])).toBe(false);
    expect(hasFailedCondition([])).toBe(false);
  });
});

describe('hasTransactionConflict', () => {
  it('is true when any item was cancelled by a conflicting transaction', () => {
    expect(hasTransactionConflict([ok, conflict])).toBe(true);
  });

  it('is false for failed conditions, no reasons or none at all', () => {
    expect(hasTransactionConflict([ok, failed])).toBe(false);
    expect(hasTransactionConflict([])).toBe(false);
    expect(hasTransactionConflict(undefined)).toBe(false);
  });
});
