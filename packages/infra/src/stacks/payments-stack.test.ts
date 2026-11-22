/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  functionsMissingNamedSettings,
  functionsMissingSettings,
  functionsReadingAppConfig,
  synth,
} from './stack-test-fixture.js';

describe('deploy-time settings', () => {
  it('gives every function that uses the core table or search its setting', () => {
    const template = synth({})('Payments');
    expect(
      Object.keys(template.findResources('AWS::Lambda::Function')),
    ).not.toEqual([]);
    expect(functionsMissingSettings(template)).toEqual([]);
  });
});

describe('deploy-time settings per function', () => {
  const template = synth({})('Payments');
  // Function logical-ID prefix to the settings its code reads.
  const required = {
    StripeWebhookApiHandler: ['DISCAVA_DYNAMODB_CORE_TABLE'],
  };

  it('gives each function the settings its code reads', () => {
    expect(functionsMissingNamedSettings(template, required)).toEqual([]);
  });

  it('leaves no function able to read AppConfig', () => {
    expect(functionsReadingAppConfig(template)).toEqual([]);
  });
});
