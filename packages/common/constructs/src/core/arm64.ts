/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CfnResource, type IAspect } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

/**
 * Runs every Lambda function in its scope on ARM (Graviton): about 20%
 * cheaper per GB-second than x86_64, and as fast or faster for our bundled
 * Node.js, which has no native modules.
 *
 * An aspect rather than each construct's `architecture` prop, because it also
 * reaches the functions CDK creates itself (custom resource providers'
 * frameworks, S3 auto-delete), which don't take one. Applied to the whole
 * stage in ApplicationStage.
 *
 * The one it can't reach is CDK's cross-region export reader, which CDK adds
 * while synthesizing, after aspects run. It only runs during deploys.
 */
export class Arm64Functions implements IAspect {
  visit(node: IConstruct): void {
    if (
      CfnResource.isCfnResource(node) &&
      node.cfnResourceType === 'AWS::Lambda::Function'
    ) {
      node.addPropertyOverride('Architectures', ['arm64']);
    }
  }
}
