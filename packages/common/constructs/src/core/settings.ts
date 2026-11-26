/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { settingEnvName } from '@discava/common-server-utils/settings';
import { Stage } from 'aws-cdk-lib';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Gives `fn` a deploy-time setting: one plain environment variable per field
 * of `value`, named `settingEnvName(namespace, key, field)`, which
 * `readSetting` reads. A field left `undefined` sets no variable. A field
 * holding a token from another stack becomes an import in `fn`'s stack.
 */
export const addSetting = (
  fn: LambdaFunction,
  namespace: string,
  key: string,
  value: Record<string, string | number | boolean | undefined>,
): void => {
  for (const [field, fieldValue] of Object.entries(value)) {
    if (fieldValue === undefined) continue;
    fn.addEnvironment(
      settingEnvName(namespace, key, field),
      String(fieldValue),
    );
  }
};

/** The SSM parameter holding the page renderer's settings, one per stage. */
export const pageRendererParameterName = (scope: Construct): string =>
  `/${Stage.of(scope)!.stageName}/page-renderer`;
