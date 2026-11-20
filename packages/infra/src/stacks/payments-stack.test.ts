/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { synth, tableFunctionsMissingAppConfig } from './stack-test-fixture.js';

describe('runtime config (#619)', () => {
  it('gives every function that uses the core table the AppConfig application id and read access', () => {
    const template = synth({})('Payments');
    expect(
      Object.keys(template.findResources('AWS::Lambda::Function')),
    ).not.toEqual([]);
    expect(tableFunctionsMissingAppConfig(template)).toEqual([]);
  });
});
