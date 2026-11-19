/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { suppressRules } from '@discava/common-constructs';
import type {
  CoreApiComponentConfig,
  InstructorApiComponentConfig,
} from '@discava/common-infra-config';
import { CfnResource, RemovalPolicy, type Stack } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import type { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { apiLimits } from './api-limits.js';

/**
 * What the three API stacks derive from a stage's config for their API
 * construct: the limits (for `defaultIntegrations` and the API), the
 * certificate, and the props the constructs take the same way.
 *
 * `id` is the API construct's id (e.g. `AdminApi`), which the certificate
 * import and the access log group's path are named after.
 */
export const trpcApiProps = (
  stack: Stack,
  id: string,
  config: CoreApiComponentConfig | InstructorApiComponentConfig | undefined,
) => {
  const enableKmsEncryption = config?.enableKmsEncryption ?? true;
  const limits = apiLimits(config);
  const certificate = config?.certificateArn
    ? Certificate.fromCertificateArn(
        stack,
        `${id}Certificate`,
        config.certificateArn,
      )
    : undefined;

  return {
    limits,
    certificate,
    props: {
      enableWaf: config?.enableWaf ?? true,
      throttle: limits.throttle,
      enableTracing: limits.enableTracing,
      enableKmsEncryption,
      enableKeyRotation: config?.enableKeyRotation ?? true,
      removalPolicy:
        (config?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
      domainName: config?.domainName,
      certificate,
    },
    // Call once the API construct exists: it suppresses on the log group
    // that's already in the tree.
    suppressLogGroupKmsRule: () => {
      if (enableKmsEncryption) return;
      suppressRules(
        stack,
        ['CKV_AWS_158'],
        'KMS encryption disabled for this stage',
        (c) =>
          CfnResource.isCfnResource(c) &&
          c.cfnResourceType === 'AWS::Logs::LogGroup' &&
          c.node.path.includes(`/${id}/AccessLogs`),
      );
    },
  };
};

/**
 * The handler of one operation of an API, for a grant beyond the baseline
 * (table + AppConfig). A procedure missing from the API's
 * `<NAME>_DEDICATED_FUNCTIONS` fails synth instead of silently handing its
 * permissions to the shared router function that serves every other
 * procedure.
 *
 * @param apiName the API's name, e.g. `core-api`
 */
export const privilegedHandler = <
  Integrations extends Record<string, { handler: LambdaFunction }>,
>(
  api: { hasDedicatedFunction(op: string): boolean },
  apiName: string,
  integrations: Integrations,
  op: keyof Integrations & string,
) => {
  if (!api.hasDedicatedFunction(op)) {
    const constant = `${apiName.toUpperCase().replaceAll('-', '_')}_DEDICATED_FUNCTIONS`;
    throw new Error(
      `${apiName} operation '${op}' is served by the shared router; add it to ${constant} before granting it extra permissions`,
    );
  }
  return integrations[op].handler;
};
