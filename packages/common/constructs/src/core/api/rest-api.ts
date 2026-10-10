/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Annotations,
  Stage as CdkStage,
  CfnOutput,
  IAspect,
  RemovalPolicy,
  Stack,
} from 'aws-cdk-lib';
import {
  RestApi as _RestApi,
  RestApiProps as _RestApiProps,
  AccessLogFormat,
  AuthorizationType,
  Cors,
  IResource,
  LogGroupLogDestination,
  Resource,
  Stage,
  ThrottleSettings,
} from 'aws-cdk-lib/aws-apigateway';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  CfnLoggingConfiguration,
  CfnWebACL,
  CfnWebACLAssociation,
} from 'aws-cdk-lib/aws-wafv2';
import { Construct, IConstruct } from 'constructs';
import { suppressRules } from '../checkov.js';
import { RuntimeConfig } from '../runtime-config.js';
import { ApiGatewayAccount } from './api-gateway-account.js';
import {
  ApiIntegrations,
  OperationDetails,
  RestApiIntegration,
} from './utils.js';

/**
 * Properties for creating a RestApi construct.
 *
 * @template TIntegrations - Record mapping integration keys to their integrations
 * @template TOperation - String literal type representing operation names
 */
export interface RestApiProps<
  TIntegrations extends ApiIntegrations<TOperation, RestApiIntegration>,
  TOperation extends string,
> extends _RestApiProps {
  /**
   * Unique name for the API, used in runtime configuration
   */
  readonly apiName: string;
  /**
   * Map of operation names to their API path and HTTP method details
   */
  readonly operations: Record<TOperation, OperationDetails>;
  /**
   * Map of integration keys to their API Gateway integrations
   */
  readonly integrations: TIntegrations;
  /**
   * Whether to enable AWS WAFv2 with the default managed ruleset
   * (AWSManagedRulesCommonRuleSet and AWSManagedRulesKnownBadInputsRuleSet)
   * and associate it with the API's default stage.
   *
   * @default true
   */
  readonly enableWaf?: boolean;
  /**
   * Default throttling limits applied to all methods on the API's default stage.
   *
   * @default { rateLimit: 10000, burstLimit: 5000 }
   */
  readonly throttle?: ThrottleSettings;
  /**
   * Whether to encrypt the API access log group with a customer-managed KMS key.
   * When disabled, CloudWatch Logs still encrypts log data at rest using an
   * AWS-owned key.
   *
   * @default true
   */
  readonly enableKmsEncryption?: boolean;
  /**
   * Whether to enable automatic key rotation on the KMS key used to encrypt
   * the access log group. Only used when `enableKmsEncryption` is `true`.
   *
   * @default true
   */
  readonly enableKeyRotation?: boolean;
  /**
   * What happens to the access log group (and its KMS key, if any) when it's
   * removed from the stack or the stack is deleted.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * A CDK construct that creates and configures an AWS API Gateway REST API.
 *
 * This class extends the base CDK RestApi with additional functionality:
 * - Type-safe operation and integration management
 * - Automatic resource creation based on path patterns
 * - Integration with runtime configuration for client discovery
 *
 * @template TOperation - String literal type representing operation names
 * @template TIntegrations - Record mapping integration keys to their integrations
 */
export class RestApi<
  TOperation extends string,
  TIntegrations extends ApiIntegrations<TOperation, RestApiIntegration>,
> extends Construct {
  /** The underlying CDK RestApi instance */
  public readonly api: _RestApi;

  /** Map of integration keys to their API Gateway integrations */
  public readonly integrations: TIntegrations;

  /** The WAFv2 Web ACL associated with the API's default stage, if WAF is enabled */
  public readonly webAcl?: CfnWebACL;

  constructor(
    scope: Construct,
    id: string,
    {
      apiName,
      operations,
      integrations,
      enableWaf = true,
      throttle = { rateLimit: 10000, burstLimit: 5000 },
      enableKmsEncryption = true,
      enableKeyRotation = true,
      removalPolicy = RemovalPolicy.RETAIN,
      domainName,
      ...props
    }: RestApiProps<TIntegrations, TOperation>,
  ) {
    super(scope, id);
    this.integrations = integrations;

    // Account-level CloudWatch role required for REST API access logging
    const account = ApiGatewayAccount.ensure(this);

    // KMS key for encrypting logs at rest, usable by CloudWatch Logs
    const logsKey = enableKmsEncryption
      ? new Key(this, 'LogsKey', { enableKeyRotation, removalPolicy })
      : undefined;
    logsKey?.grantEncryptDecrypt(
      new ServicePrincipal(`logs.${Stack.of(this).region}.amazonaws.com`),
    );

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: RetentionDays.ONE_YEAR,
      encryptionKey: logsKey,
      removalPolicy,
    });

    // Create the API Gateway REST API
    this.api = new _RestApi(this, 'Api', {
      // Without this the console shows every API by its construct id
      // ("Api"); prefixing the stage tells stages sharing an account apart.
      restApiName: [CdkStage.of(this)?.stageName, apiName]
        .filter(Boolean)
        .join('-'),
      ...props,
      domainName,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(accessLogs),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        ...props.deployOptions,
        methodOptions: {
          ...props.deployOptions?.methodOptions,
          // Default throttling applied to all resource paths and methods
          '/*/*': {
            throttlingRateLimit: throttle.rateLimit,
            throttlingBurstLimit: throttle.burstLimit,
            ...props.deployOptions?.methodOptions?.['/*/*'],
          },
        },
      },
    });
    // Ensure the account-level role is configured before the stage is created
    this.api.deploymentStage.node.addDependency(account.resource);

    if (enableWaf) {
      this.webAcl = new CfnWebACL(this, 'WebAcl', {
        defaultAction: { allow: {} },
        scope: 'REGIONAL',
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${apiName}WebAcl`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: 'CRSRule',
            priority: 0,
            statement: {
              managedRuleGroupStatement: {
                name: 'AWSManagedRulesCommonRuleSet',
                vendorName: 'AWS',
                // Count instead of Block: the CRS 8 KB body limit is too restrictive for most APIs.
                ruleActionOverrides: [
                  {
                    name: 'SizeRestrictions_BODY',
                    actionToUse: { count: {} },
                  },
                ],
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${apiName}WebAcl-CRS`,
              sampledRequestsEnabled: true,
            },
            overrideAction: {
              none: {},
            },
          },
          {
            name: 'KnownBadInputsRule',
            priority: 1,
            statement: {
              managedRuleGroupStatement: {
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
                vendorName: 'AWS',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${apiName}WebAcl-KnownBadInputs`,
              sampledRequestsEnabled: true,
            },
            overrideAction: {
              none: {},
            },
          },
        ],
      });

      new CfnWebACLAssociation(this, 'WebAclAssociation', {
        resourceArn: this.api.deploymentStage.stageArn,
        webAclArn: this.webAcl.attrArn,
      });

      // Send WAF request logs to CloudWatch. The log group name must start with
      // `aws-waf-logs-` to satisfy the WAFv2 logging destination requirement.
      const wafLogGroup = new LogGroup(this, 'WebAclLogs', {
        logGroupName: `aws-waf-logs-${apiName}-${this.node.addr.slice(-8)}`,
        retention: RetentionDays.ONE_YEAR,
        encryptionKey: logsKey,
        // The log group name is deterministic, so retaining it on delete would
        // orphan it and block re-creation (e.g. after a rolled-back deploy).
        removalPolicy: RemovalPolicy.DESTROY,
      });

      new CfnLoggingConfiguration(this, 'WebAclLoggingConfig', {
        resourceArn: this.webAcl.attrArn,
        logDestinationConfigs: [wafLogGroup.logGroupArn],
      });
    }

    suppressRules(
      this.api,
      ['CKV_AWS_120'],
      'Caching not required for this use case',
      (c) => c instanceof Stage,
    );

    // Resolve the integration for a given operation.
    // If the operation has a dedicated integration, use it; otherwise fall back to $router.
    const resolveIntegration = (op: TOperation): RestApiIntegration => {
      const record = integrations as Record<string, RestApiIntegration>;
      if (op in record) {
        return record[op];
      }
      if ('$router' in record) {
        return record['$router'];
      }
      throw new Error(
        `No integration found for operation '${op}' and no $router integration available`,
      );
    };

    // Create API resources and methods for each operation
    (Object.entries(operations) as [TOperation, OperationDetails][]).forEach(
      ([op, details]) => {
        const integration = resolveIntegration(op);
        const resource = this.getOrCreateResource(
          this.api.root,
          (details.path.startsWith('/')
            ? details.path.slice(1)
            : details.path
          ).split('/'),
        );
        const method = resource.addMethod(
          details.method,
          integration.integration,
          integration.options,
        );
        // Checkov flags any non-OPTIONS method without an authorizer as open
        // backend access. That's correct by default, but a handful of
        // operations are deliberately public (see e.g. CoreApi's
        // PUBLIC_OPERATIONS) via integration.options.authorizationType set
        // to NONE - suppress just those, not the whole API.
        if (integration.options?.authorizationType === AuthorizationType.NONE) {
          suppressRules(
            method,
            ['CKV_AWS_59'],
            'Intentionally public operation - see integration.options.authorizationType on this operation',
          );
        }
      },
    );

    // Register the API URL in runtime configuration for client discovery.
    // When a custom domain is configured, its base path mapping serves the
    // API without the deployment stage's path prefix (e.g. /prod/), so
    // clients should call the domain (plus configured base path, if any)
    // directly rather than the generated execute-api URL.
    const rc = RuntimeConfig.ensure(this);
    rc.set('connection', 'apis', {
      ...rc.get('connection').apis,
      [apiName]: domainName
        ? `https://${domainName.domainName}/${domainName.basePath ? `${domainName.basePath}/` : ''}`
        : this.api.url!,
    });

    // The API Gateway hostname a custom domain's DNS record points at (a
    // d-*.execute-api.<region>.amazonaws.com name), which differs from the
    // execute-api URL in the Endpoint output RestApi adds by default.
    // Target for the custom domain's DNS record
    if (domainName) {
      new CfnOutput(this, `${apiName}DomainNameAlias`, {
        value: this.api.domainName!.domainNameAliasDomainName,
      });
      new CfnOutput(this, `${apiName}DomainNameAliasHostedZoneId`, {
        value: this.api.domainName!.domainNameAliasHostedZoneId,
      });
    }
  }

  /**
   * Recursively creates or retrieves API Gateway resources based on a path pattern.
   *
   * @param resource - The parent API Gateway resource
   * @param pathParts - Array of path segments to create or retrieve
   * @returns The API Gateway resource at the end of the path
   */
  private getOrCreateResource(
    resource: IResource,
    [nextPathPart, ...pathParts]: string[],
  ): IResource {
    if (!nextPathPart) {
      return resource;
    }
    const childResource =
      resource.getResource(nextPathPart) ?? resource.addResource(nextPathPart);
    return this.getOrCreateResource(childResource, pathParts);
  }
}

export class AddCorsPreflightAspect implements IAspect {
  private getAllowedOrigins: () => readonly string[];
  constructor(getAllowedOrigins: () => readonly string[]) {
    this.getAllowedOrigins = getAllowedOrigins;
  }
  public visit(node: IConstruct): void {
    if (node instanceof Resource) {
      const preflightMethod = node.addCorsPreflight({
        allowOrigins: [...this.getAllowedOrigins()],
        allowMethods: Cors.ALL_METHODS,
        allowCredentials: true,
      });
      // The preflight *request* never carries credentials, so this method is
      // intentionally created with AuthorizationType.NONE while still
      // inheriting the resource's Cognito authorizationScopes default. That
      // combination is invalid, but harmless here since API Gateway never
      // applies scopes to an unauthorized method - acknowledge it rather
      // than let it print as a warning on every route.
      Annotations.of(preflightMethod).acknowledgeWarning(
        '@aws-cdk/aws-apigateway:invalidAuthScope',
        "AuthorizationScopes is inherited from the resource's default method options but ignored for this CORS preflight OPTIONS method, which intentionally uses AuthorizationType.NONE.",
      );
    }
  }
}
