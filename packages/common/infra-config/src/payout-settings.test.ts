/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { validatePayoutSettings } from './payout-settings.js';
import { listStageNames, resolveStage } from './resolve-stage.js';
import type { PayoutSettings } from './stages.types.js';

const valid: PayoutSettings = {
  platformFeeBasisPoints: 2000,
  holdDays: 14,
  minimumPayoutMinor: 1000,
};

const check = (overrides: Partial<PayoutSettings>) =>
  validatePayoutSettings('stage', { ...valid, ...overrides });

describe('validatePayoutSettings', () => {
  it('accepts the documented defaults', () => {
    expect(() => check({})).not.toThrow();
  });

  it('accepts a fee of 0 and of 10000 basis points', () => {
    expect(() => check({ platformFeeBasisPoints: 0 })).not.toThrow();
    expect(() => check({ platformFeeBasisPoints: 10000 })).not.toThrow();
  });

  it('accepts a hold of 0 days and a minimum of 0', () => {
    expect(() => check({ holdDays: 0, minimumPayoutMinor: 0 })).not.toThrow();
  });

  it.each([-1, 10001, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a fee of %s basis points',
    (value) => {
      expect(() => check({ platformFeeBasisPoints: value })).toThrow(
        /platformFeeBasisPoints/,
      );
    },
  );

  it.each([-1, 1.5, Number.NaN])('rejects %s hold days', (value) => {
    expect(() => check({ holdDays: value })).toThrow(/holdDays/);
  });

  it.each([-1, 0.5, Number.NaN])('rejects a minimum of %s', (value) => {
    expect(() => check({ minimumPayoutMinor: value })).toThrow(
      /minimumPayoutMinor/,
    );
  });

  it('rejects a value that is not a number', () => {
    expect(() => check({ holdDays: '14' as unknown as number })).toThrow(
      /holdDays/,
    );
  });
});

describe('configured stages', () => {
  it('give every stage payout settings that pass validation', () => {
    const names = listStageNames('packages/infra');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const payouts = resolveStage('packages/infra', name)?.payouts;
      expect(payouts, name).toBeDefined();
      expect(() =>
        validatePayoutSettings(name, payouts as PayoutSettings),
      ).not.toThrow();
    }
  });
});
