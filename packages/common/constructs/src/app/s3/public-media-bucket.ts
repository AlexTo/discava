/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Construct } from 'constructs';
import { PublicBucket, PublicBucketProps } from '../../core/public-bucket.js';

export type PublicMediaBucketProps = Omit<
  PublicBucketProps,
  'runtimeConfigKey'
>;

// Media anyone may see, such as course display images (#76).
export class PublicMediaBucket extends PublicBucket {
  constructor(scope: Construct, id: string, props?: PublicMediaBucketProps) {
    super(scope, id, {
      ...props,
      runtimeConfigKey: 'PublicMediaBucket',
    });
  }
}
