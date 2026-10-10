/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CfnOutput,
  CfnResource,
  Duration,
  Lazy,
  RemovalPolicy,
  Stack,
  Stage,
} from 'aws-cdk-lib';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  CfnUserPoolGroup,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  type MfaSecondFactor,
  OAuthScope,
  StandardThreatProtectionMode,
  UserPool,
  UserPoolClient,
  UserPoolDomain,
} from 'aws-cdk-lib/aws-cognito';
import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from 'aws-cdk-lib/aws-cognito-identitypool';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  CfnLoggingConfiguration,
  CfnWebACL,
  CfnWebACLAssociation,
} from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { suppressRules } from './checkov.js';
import { findCloudFrontDomainNames } from './cloudfront.js';
import { RuntimeConfig } from './runtime-config.js';

const WEB_CLIENT_ID = 'WebClient';

/** Local dev server origins permitted to complete the sign-in redirect */
const LOCAL_CALLBACK_URLS = [
  'http://localhost:4200',
  'http://localhost:4300',
  'http://localhost:4201',
  'http://localhost:4301',
  'http://localhost:4202',
  'http://localhost:4302',
];

/**
 * The set of portal roles provisioned as Cognito user pool groups. Lower
 * precedence values win when a user is ever placed in more than one group.
 */
const USER_POOL_GROUPS = [
  { name: 'admin', precedence: 0 },
  { name: 'instructor', precedence: 1 },
  { name: 'student', precedence: 2 },
] as const;

export type UserRole = (typeof USER_POOL_GROUPS)[number]['name'];

export interface UserIdentityProps {
  /**
   * Whether to enable AWS WAFv2 with the default managed ruleset
   * (AWSManagedRulesCommonRuleSet and AWSManagedRulesKnownBadInputsRuleSet)
   * and associate it with the user pool.
   *
   * @default true
   */
  readonly enableWaf?: boolean;

  /**
   * Whether users must configure MFA, may optionally configure MFA, or cannot use MFA at all.
   *
   * @default Mfa.REQUIRED
   */
  readonly mfa?: Mfa;

  /**
   * The MFA methods available to users when MFA is not off.
   *
   * @default { sms: true, otp: true }
   */
  readonly mfaSecondFactor?: MfaSecondFactor;

  /**
   * What happens to the user pool when it's removed from the stack or the
   * stack is deleted.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Prevent the user pool from being deleted while this is enabled.
   *
   * @default true
   */
  readonly deletionProtection?: boolean;
}

/**
 * Creates a UserPool and Identity Pool with sane defaults configured intended for usage from a web client.
 */
export class UserIdentity extends Construct {
  public readonly region: string;
  public readonly identityPool: IdentityPool;
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly userPoolDomain: UserPoolDomain;
  public readonly userPoolGroups: Record<UserRole, CfnUserPoolGroup>;

  /** The WAFv2 Web ACL associated with the user pool, if WAF is enabled */
  public readonly webAcl?: CfnWebACL;

  constructor(
    scope: Construct,
    id: string,
    {
      enableWaf = true,
      mfa = Mfa.REQUIRED,
      mfaSecondFactor = { sms: true, otp: true },
      removalPolicy = RemovalPolicy.RETAIN,
      deletionProtection = true,
    }: UserIdentityProps = {},
  ) {
    super(scope, id);

    this.region = Stack.of(this).region;
    this.userPool = this.createUserPool(
      mfa,
      mfaSecondFactor,
      removalPolicy,
      deletionProtection,
    );
    this.userPoolGroups = this.createUserPoolGroups(this.userPool);

    if (enableWaf) {
      this.webAcl = this.createWebAcl(
        id,
        this.userPool,
        LOCAL_CALLBACK_URLS.length > 0,
      );
    }
    this.userPoolDomain = this.createUserPoolDomain(this.userPool);
    this.userPoolClient = this.createUserPoolClient(this.userPool);
    this.identityPool = this.createIdentityPool(
      this.userPool,
      this.userPoolClient,
    );
    this.createManagedLoginBranding(
      this.userPool,
      this.userPoolClient,
      this.userPoolDomain,
    );

    RuntimeConfig.ensure(this).set('connection', 'cognitoProps', {
      region: Stack.of(this).region,
      identityPoolId: this.identityPool.identityPoolId,
      userPoolId: this.userPool.userPoolId,
      userPoolWebClientId: this.userPoolClient.userPoolClientId,
    });

    suppressRules(
      this.userPool,
      ['CKV_AWS_111'],
      'SMS Role requires wildcard resource',
      (c) => c.node.path.includes('/smsRole/'),
    );

    new CfnOutput(this, `${id}-UserPoolId`, {
      value: this.userPool.userPoolId,
    });

    new CfnOutput(this, `${id}-UserPoolClientId`, {
      value: this.userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, `${id}-IdentityPoolId`, {
      value: this.identityPool.identityPoolId,
    });
  }

  private createUserPool = (
    mfa: Mfa,
    mfaSecondFactor: MfaSecondFactor,
    removalPolicy: RemovalPolicy,
    deletionProtection: boolean,
  ) => {
    const userPool = new UserPool(this, 'UserPool', {
      removalPolicy,
      deletionProtection,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      mfa,
      featurePlan: FeaturePlan.PLUS,
      // Audit-only logs threat assessments without blocking sign-in. Switch to FULL_FUNCTION to enforce automatic responses.
      standardThreatProtectionMode: StandardThreatProtectionMode.AUDIT_ONLY,
      mfaSecondFactor,
      signInCaseSensitive: false,
      signInAliases: { username: false, email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      selfSignUpEnabled: true,
      standardAttributes: {
        phoneNumber: { required: false },
        email: { required: true },
        givenName: { required: true },
        familyName: { required: true },
      },
      autoVerify: {
        email: true,
        phone: true,
      },
      keepOriginal: {
        email: true,
        phone: true,
      },
    });
    // Retain the SMS role alongside the pool so the pool can still be updated and deleted manually
    const poolCfn = userPool.node.defaultChild as CfnResource;
    const smsRoleNode = userPool.node.tryFindChild('smsRole');
    if (smsRoleNode) {
      const smsRoleCfn = smsRoleNode.node.defaultChild as CfnResource;
      smsRoleCfn.cfnOptions.deletionPolicy = poolCfn.cfnOptions.deletionPolicy;
      smsRoleCfn.cfnOptions.updateReplacePolicy =
        poolCfn.cfnOptions.updateReplacePolicy;
    }
    return userPool;
  };

  private createUserPoolGroups = (userPool: UserPool) =>
    Object.fromEntries(
      USER_POOL_GROUPS.map(({ name, precedence }) => [
        name,
        new CfnUserPoolGroup(
          this,
          `${name.charAt(0).toUpperCase()}${name.slice(1)}Group`,
          {
            userPoolId: userPool.userPoolId,
            groupName: name,
            precedence,
          },
        ),
      ]),
    ) as Record<UserRole, CfnUserPoolGroup>;

  private createWebAcl = (
    id: string,
    userPool: UserPool,
    allowsLocalCallback: boolean,
  ) => {
    const webAcl = new CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${id}WebAcl`,
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
              // EC2MetaDataSSRF_QUERYARGUMENTS treats the loopback redirect_uri the
              // Hosted UI receives during local sign-in as an SSRF attempt. Counted
              // only while a local callback URL is allowed; every other rule blocks.
              ruleActionOverrides: allowsLocalCallback
                ? [
                    {
                      name: 'EC2MetaDataSSRF_QUERYARGUMENTS',
                      actionToUse: { count: {} },
                    },
                  ]
                : undefined,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${id}WebAcl-CRS`,
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
            metricName: `${id}WebAcl-KnownBadInputs`,
            sampledRequestsEnabled: true,
          },
          overrideAction: {
            none: {},
          },
        },
      ],
    });

    new CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: userPool.userPoolArn,
      webAclArn: webAcl.attrArn,
    });

    // Send WAF request logs to CloudWatch. The log group name must start with
    // `aws-waf-logs-` to satisfy the WAFv2 logging destination requirement.
    const wafLogGroup = new LogGroup(this, 'WebAclLogs', {
      logGroupName: `aws-waf-logs-${id}-${this.node.addr.slice(-8)}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    suppressRules(
      wafLogGroup,
      ['CKV_AWS_158'],
      'Using default CloudWatch log encryption for WAF logs',
    );

    new CfnLoggingConfiguration(this, 'WebAclLoggingConfig', {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [wafLogGroup.logGroupArn],
    });

    return webAcl;
  };

  private createUserPoolDomain = (userPool: UserPool) =>
    new UserPoolDomain(this, 'UserPoolDomain', {
      userPool,
      cognitoDomain: {
        domainPrefix: `discava-${Stack.of(this).account}`,
      },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

  private createUserPoolClient = (userPool: UserPool) => {
    const lazilyComputedCallbackUrls = Lazy.list({
      produce: () =>
        LOCAL_CALLBACK_URLS.concat(
          // The whole stage, not just this stack: the portals' distributions
          // can live in a different stack from the user pool.
          (Stage.of(this) ?? Stack.of(this)).node
            .findAll()
            .filter(
              (child): child is Distribution => child instanceof Distribution,
            )
            .flatMap(findCloudFrontDomainNames)
            .map((domain) => `https://${domain}`),
        ),
    });

    return userPool.addClient(WEB_CLIENT_ID, {
      authFlows: {
        userPassword: true,
        userSrp: true,
        user: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
        callbackUrls: lazilyComputedCallbackUrls,
        logoutUrls: lazilyComputedCallbackUrls,
      },
      preventUserExistenceErrors: true,
    });
  };

  private createIdentityPool = (
    userPool: UserPool,
    userPoolClient: UserPoolClient,
  ) => {
    const identityPool = new IdentityPool(this, 'IdentityPool');

    identityPool.addUserPoolAuthentication(
      new UserPoolAuthenticationProvider({
        userPool,
        userPoolClient,
      }),
    );

    return identityPool;
  };

  private createManagedLoginBranding = (
    userPool: UserPool,
    userPoolClient: UserPoolClient,
    userPoolDomain: UserPoolDomain,
  ) => {
    new CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    }).node.addDependency(userPoolClient, userPool, userPoolDomain);
  };
}
