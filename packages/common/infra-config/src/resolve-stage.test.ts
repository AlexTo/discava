/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import { listStageNames, resolveStage } from './resolve-stage.js';

const PROJECT_PATH = 'packages/infra';
const STAGE = 'discava-development';
const ENV_KEY = 'DISCAVA_DEVELOPMENT_INFRA_STUDENT_PORTAL_DOMAIN_NAMES';
const NOTIFICATIONS_KEY =
  'DISCAVA_DEVELOPMENT_INFRA_NOTIFICATIONS_FROM_ADDRESS';

afterEach(() => {
  delete process.env[ENV_KEY];
  delete process.env[NOTIFICATIONS_KEY];
});

describe('resolveStage', () => {
  it('lists the configured stage names for the infra project', () => {
    expect(listStageNames(PROJECT_PATH)).toEqual(
      expect.arrayContaining([STAGE, 'discava-production']),
    );
  });

  it('applies an env var override on top of the static stages.config.ts entry', () => {
    const withoutOverride = resolveStage(PROJECT_PATH, STAGE);
    expect(withoutOverride?.infra?.studentPortal?.domainNames).toBeUndefined();

    process.env[ENV_KEY] = 'learn.example.com';
    const withOverride = resolveStage(PROJECT_PATH, STAGE);

    expect(withOverride?.infra?.studentPortal?.domainNames).toEqual([
      'learn.example.com',
    ]);
    // Unrelated static config for the stage is preserved.
    expect(withOverride?.infra?.studentPortal?.enableWaf).toBe(false);
  });

  it('has no notification sender committed, only from the env var', () => {
    expect(
      resolveStage(PROJECT_PATH, STAGE)?.infra?.notifications,
    ).toBeUndefined();

    process.env[NOTIFICATIONS_KEY] = 'notifications@example.com';

    expect(resolveStage(PROJECT_PATH, STAGE)?.infra?.notifications).toEqual({
      fromAddress: 'notifications@example.com',
    });
  });

  it('relaxes the Stripe webhook API for development only', () => {
    expect(resolveStage(PROJECT_PATH, STAGE)?.infra?.payments?.enableWaf).toBe(
      false,
    );
    // Production has no entry, so the component's hardened defaults apply.
    expect(
      resolveStage(PROJECT_PATH, 'discava-production')?.infra?.payments
        ?.enableWaf,
    ).not.toBe(false);
  });

  it('returns undefined for a stage with no configuration at all', () => {
    expect(resolveStage(PROJECT_PATH, 'does-not-exist')).toBeUndefined();
  });
});
