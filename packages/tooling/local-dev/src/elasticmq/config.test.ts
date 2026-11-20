/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { STREAM_FEATURES } from '@discava/core-table';
import { describe, expect, it } from 'vitest';
import { elasticMqConfig } from './config.js';

describe('elasticMqConfig', () => {
  it('creates a queue and a failure queue for every registered feature', () => {
    const config = elasticMqConfig(STREAM_FEATURES);

    for (const { name, maxReceiveCount } of STREAM_FEATURES) {
      expect(config).toContain(`"stream-${name}-failures" {`);
      expect(config).toContain(`"stream-${name}" {`);
      expect(config).toContain(
        `deadLettersQueue { name = "stream-${name}-failures", maxReceiveCount = ${maxReceiveCount} }`,
      );
    }
  });

  it('creates the router failure queue and a short visibility timeout', () => {
    const config = elasticMqConfig(STREAM_FEATURES);

    expect(config).toContain('"stream-router-failures" {');
    expect(config).toContain('defaultVisibilityTimeout = 10 seconds');
  });

  it('follows the registrations it is given', () => {
    const config = elasticMqConfig([
      { ...STREAM_FEATURES[0]!, name: 'extra', maxReceiveCount: 3 },
    ]);

    expect(config).toContain(
      'deadLettersQueue { name = "stream-extra-failures", maxReceiveCount = 3 }',
    );
    expect(config).not.toContain('search-indexing');
  });
});
