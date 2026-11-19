/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves asset paths from import.meta.url, which jsdom doesn't provide.)
import { appRouter } from '@discava/admin-api';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { routerToOperations } from '../../core/api/trpc-utils.js';
import { ADMIN_API_DEDICATED_FUNCTIONS, AdminApi } from './admin-api.js';

describe('ADMIN_API_DEDICATED_FUNCTIONS', () => {
  it('serves the two payment writes from their own function', () => {
    expect(ADMIN_API_DEDICATED_FUNCTIONS).toEqual({
      PaymentsConnect: ['payment.connect', 'payment.disconnect'],
    });
  });

  it('names only operations the router has', () => {
    const operations = Object.keys(routerToOperations(appRouter));
    for (const ops of Object.values(ADMIN_API_DEDICATED_FUNCTIONS)) {
      for (const op of ops) expect(operations).toContain(op);
    }
  });

  it('keeps every other operation, payment.status included, on the shared router', () => {
    expect(AdminApi.hasDedicatedFunction('payment.connect')).toBe(true);
    expect(AdminApi.hasDedicatedFunction('payment.disconnect')).toBe(true);
    expect(AdminApi.hasDedicatedFunction('payment.status')).toBe(false);
    expect(AdminApi.hasDedicatedFunction('category.list')).toBe(false);
    expect(AdminApi.hasDedicatedFunction('review.remove')).toBe(false);
  });

  it('builds one function per group, plus the router', () => {
    const stack = new Stack(new App(), 'Stack', {
      env: { account: '111122223333', region: 'ap-southeast-2' },
    });
    const integrations = AdminApi.defaultIntegrations(stack).build();
    expect(integrations['payment.connect'].handler).toBe(
      integrations['payment.disconnect'].handler,
    );
    expect(integrations['payment.connect'].handler).not.toBe(
      integrations['payment.status'].handler,
    );
    expect(integrations['payment.status'].handler).toBe(
      integrations['category.list'].handler,
    );
    expect(
      Object.keys(
        Template.fromStack(stack).findResources('AWS::Lambda::Function'),
      ),
    ).toHaveLength(2);
    // Synthesising the Lambda assets is slow on a busy CI runner.
  }, 60_000);
});
