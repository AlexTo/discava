/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { App, Stack } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { RuntimeConfig } from './runtime-config.js';

describe('RuntimeConfig', () => {
  const create = () => RuntimeConfig.ensure(new Stack(new App(), 'Test'));

  it("holds the portals' connection settings", () => {
    const rc = create();
    rc.set('connection', 'site', { linkedInOrganizationId: '12345' });
    expect(rc.get('connection')).toEqual({
      site: { linkedInOrganizationId: '12345' },
    });
  });

  it.each(['dynamodb', 's3', 'opensearch', 'mediaConvert', 'certificates'])(
    'refuses a %s namespace, which belongs in a deploy-time setting',
    (namespace) => {
      expect(() => create().set(namespace, 'Key', {})).toThrow(
        /only holds the portals' 'connection' settings/,
      );
    },
  );
});
