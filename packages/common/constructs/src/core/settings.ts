/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { settingEnvName } from '@discava/common-server-utils/settings';
import { Stack, Stage } from 'aws-cdk-lib';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Gives `fn` a deploy-time setting: its JSON in the environment variable
 * `settingEnvName(namespace, key)`, which `readSetting` reads. A value
 * holding a token from another stack becomes an import in `fn`'s stack.
 */
export const addSetting = (
  fn: LambdaFunction,
  namespace: string,
  key: string,
  value: unknown,
): void => {
  fn.addEnvironment(
    settingEnvName(namespace, key),
    typeof value === 'string'
      ? JSON.stringify(value)
      : Stack.of(fn).toJsonString(value),
  );
};

/** The SSM parameter holding the page renderer's settings, one per stage. */
export const pageRendererParameterName = (scope: Construct): string =>
  `/${Stage.of(scope)!.stageName}/page-renderer`;
