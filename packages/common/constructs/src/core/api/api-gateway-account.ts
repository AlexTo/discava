/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CfnResource,
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack,
  Stage,
} from 'aws-cdk-lib';
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as url from 'url';
import { suppressRules } from '../checkov.js';

const ApiGatewayAccountKey = '__ApiGatewayAccount__';

/**
 * Stage-scoped singleton (stack-scoped outside a stage) that configures the account-level CloudWatch Logs role
 * used by API Gateway REST APIs for access logging.
 *
 * `AWS::ApiGateway::Account` is a singleton per region per account, so it is
 * managed via an idempotent custom resource: the role is set only when none is
 * already configured, and is never reset on delete. This keeps logging working
 * across multiple stacks sharing an account without one clobbering another.
 */
export class ApiGatewayAccount extends Construct {
  static ensure(scope: Construct): ApiGatewayAccount {
    const stack = Stack.of(scope);
    // Reuse one from any stack in the stage, so REST APIs split across
    // stacks don't each create their own role and provider.
    const existing = (Stage.of(scope) ?? stack).node
      .findAll()
      .find((c): c is ApiGatewayAccount => c instanceof ApiGatewayAccount);
    return existing ?? new ApiGatewayAccount(stack, ApiGatewayAccountKey);
  }

  public readonly resource: CustomResource;

  private constructor(scope: Construct, id: string) {
    super(scope, id);

    const cloudWatchRole = new Role(this, 'CloudWatchRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonAPIGatewayPushToCloudWatchLogs',
        ),
      ],
    });
    cloudWatchRole.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const onEvent = new Function(this, 'OnEvent', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      timeout: Duration.minutes(2),
      code: Code.fromAsset(
        url.fileURLToPath(new URL('./api-gateway-account', import.meta.url)),
      ),
    });
    const { region } = Stack.of(this);
    onEvent.addToRolePolicy(
      new PolicyStatement({
        actions: ['apigateway:GET', 'apigateway:PATCH'],
        resources: [`arn:aws:apigateway:${region}::/account`],
      }),
    );
    onEvent.addToRolePolicy(
      new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [cloudWatchRole.roleArn],
      }),
    );
    // Read-only; inspects whichever role the account currently references
    onEvent.addToRolePolicy(
      new PolicyStatement({ actions: ['iam:GetRole'], resources: ['*'] }),
    );

    const provider = new Provider(this, 'Provider', {
      onEventHandler: onEvent,
    });
    // CDK's provider framework Lambda only carries USER_ON_EVENT_FUNCTION_ARN
    // in its environment. Checkov's secret scan also reads a __file__ key its
    // own parser injects (the template's path), so a CDK-hashed template file
    // name can trip CKV_AWS_45 on it.
    suppressRules(
      provider,
      ['CKV_AWS_45'],
      'Environment only holds the onEvent function ARN; checkov flags its injected template path',
      (c) =>
        CfnResource.isCfnResource(c) &&
        c.cfnResourceType === 'AWS::Lambda::Function',
    );

    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::ApiGatewayAccount',
      properties: { CloudWatchRoleArn: cloudWatchRole.roleArn },
    });
    this.resource.node.addDependency(cloudWatchRole);
  }
}
