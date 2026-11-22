/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { functionsMissingSettings, synth } from './stack-test-fixture.js';

describe('deploy-time settings', () => {
  it('gives every function that uses the core table or search its setting', () => {
    const template = synth({})('Payments');
    expect(
      Object.keys(template.findResources('AWS::Lambda::Function')),
    ).not.toEqual([]);
    expect(functionsMissingSettings(template)).toEqual([]);
  });
});
