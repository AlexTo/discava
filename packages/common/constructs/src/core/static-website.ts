/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CfnOutput,
  CfnResource,
  Duration,
  Lazy,
  Names,
  RemovalPolicy,
  Stack,
} from 'aws-cdk-lib';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  Function as CloudFrontFunction,
  Distribution,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { IKey, Key } from 'aws-cdk-lib/aws-kms';
import {
  CfnDelivery,
  CfnDeliveryDestination,
  CfnDeliverySource,
  LogGroup,
  RetentionDays,
} from 'aws-cdk-lib/aws-logs';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import {
  BucketDeployment,
  CacheControl,
  Source,
} from 'aws-cdk-lib/aws-s3-deployment';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import * as url from 'url';
import { suppressRules } from './checkov.js';
import { RuntimeConfig } from './runtime-config.js';

const DEFAULT_RUNTIME_CONFIG_FILENAME = 'runtime-config.json';

// Content-Security-Policy enforced on all responses. Restricts scripts and
// framing to mitigate XSS and clickjacking, while allowing any HTTPS origin
// for connect-src, media-src and img-src: the APIs, Cognito, the media
// distributions and presigned S3 URLs are only known at deploy time, and the
// media distributions are in a stack deployed after the portals'.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // blob: is the instructor portal's crop preview of a picked image (#76).
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  // blob: is required for hls.js/MediaSource-based HLS playback.
  "media-src 'self' https: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

export interface StaticWebsiteProps {
  readonly websiteName: string;
  readonly websiteFilePath: string;
  /**
   * Custom domain names for the CloudFront distribution. Requires `certificate`.
   */
  readonly domainNames?: string[];
  /**
   * ACM certificate for the custom domain names. Must be in us-east-1.
   * When provided, viewers are required to use TLS 1.2 or later.
   */
  readonly certificate?: ICertificate;
  /**
   * Whether to protect the CloudFront distribution with an AWS WAF Web ACL.
   *
   * @default true
   */
  readonly enableWaf?: boolean;
  /**
   * Server-side encryption for the website and distribution log buckets.
   *
   * @default BucketEncryption.KMS
   */
  readonly encryption?: BucketEncryption;
  /**
   * KMS key used to encrypt the website and distribution log buckets. Only used when `encryption` is
   * `BucketEncryption.KMS`. When not provided, a new key is created.
   */
  readonly encryptionKey?: IKey;
  /**
   * Whether the automatically created KMS key has rotation enabled. Only applies when `encryption` is
   * `BucketEncryption.KMS` and no `encryptionKey` is supplied.
   *
   * @default true
   */
  readonly enableKeyRotation?: boolean;
  /**
   * Where to create the deployment that writes `runtime-config.json` into the
   * website bucket. That file embeds values (API URLs, Cognito ids) from
   * other stacks, so a multi-stack app should point this at a stack that can
   * depend on all of them, instead of making the website's own stack do so.
   *
   * @default this construct
   */
  readonly runtimeConfigScope?: Construct;
  /**
   * Headers the distribution adds to every response, besides the security
   * headers: e.g. `X-Robots-Tag: noindex` for a stage closed to search
   * engines.
   */
  readonly extraResponseHeaders?: Record<string, string>;
}

/**
 * Deploys a Static Website using by default a private S3 bucket as an origin and Cloudfront as the entrypoint.
 *
 * This construct configures a webAcl containing rules that are generally applicable to web applications. This
 * provides protection against exploitation of a wide range of vulnerabilities, including some of the high risk
 * and commonly occurring vulnerabilities described in OWASP publications such as OWASP Top 10.
 *
 */
export class StaticWebsite extends Construct {
  public readonly websiteBucket: IBucket;
  public readonly cloudFrontDistribution: Distribution;
  public readonly bucketDeployment: BucketDeployment;
  /** The headers policy every behavior of the distribution uses. */
  public readonly responseHeadersPolicy: ResponseHeadersPolicy;

  constructor(
    scope: Construct,
    id: string,
    {
      websiteFilePath,
      websiteName,
      domainNames,
      certificate,
      enableWaf = true,
      encryption = BucketEncryption.KMS,
      encryptionKey,
      enableKeyRotation = true,
      runtimeConfigScope,
      extraResponseHeaders,
    }: StaticWebsiteProps,
  ) {
    super(scope, id);

    const websiteKey: IKey | undefined =
      encryption === BucketEncryption.KMS
        ? (encryptionKey ?? new Key(this, 'WebsiteKey', { enableKeyRotation }))
        : undefined;

    // Allow CloudWatch Logs to use the website key for server access log delivery.
    const stack = Stack.of(this);
    websiteKey?.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [
          new ServicePrincipal(`logs.${stack.region}.amazonaws.com`),
        ],
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        resources: ['*'],
        conditions: {
          ArnLike: {
            'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${stack.region}:${stack.account}:log-group:*`,
          },
        },
      }),
    );

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: RetentionDays.ONE_YEAR,
      encryptionKey: websiteKey,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.websiteBucket = new Bucket(this, 'WebsiteBucket', {
      versioned: true,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption,
      encryptionKey: websiteKey,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
    suppressRules(
      this.websiteBucket,
      ['CKV_AWS_18'],
      'Server access logs are delivered to CloudWatch Logs',
    );
    this.deliverAccessLogsToCloudWatch(
      'Website',
      this.websiteBucket,
      accessLogs,
    );
    const wafStack = enableWaf ? new CloudfrontWebAcl(this, 'waf') : undefined;

    // CloudFront delivers its standard access logs to S3 only, hence this
    // bucket (unlike the website bucket's logs, which go to CloudWatch Logs,
    // as do this bucket's own server access logs).
    const logBucket = new Bucket(this, 'DistributionLogBucket', {
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption,
      encryptionKey: websiteKey,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
    suppressRules(
      logBucket,
      ['CKV_AWS_21'],
      'Distribution log bucket does not need versioning enabled',
    );
    suppressRules(
      logBucket,
      ['CKV_AWS_18'],
      'Server access logs are delivered to CloudWatch Logs',
    );
    this.deliverAccessLogsToCloudWatch('Distribution', logBucket, accessLogs);

    // Security headers applied to all responses.
    const responseHeadersPolicy = (this.responseHeadersPolicy =
      new ResponseHeadersPolicy(this, 'ResponseHeadersPolicy', {
        securityHeadersBehavior: {
          strictTransportSecurity: {
            accessControlMaxAge: Duration.days(730),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy:
              HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          contentSecurityPolicy: {
            contentSecurityPolicy: CONTENT_SECURITY_POLICY,
            override: true,
          },
        },
        ...(extraResponseHeaders && {
          customHeadersBehavior: {
            customHeaders: Object.entries(extraResponseHeaders).map(
              ([header, value]) => ({ header, value, override: true }),
            ),
          },
        }),
      }));

    // A single-page app's routes have no file behind them: a path whose last
    // segment has no dot is the app, and one with a dot is a file, which is a
    // real 404 when missing (instead of the app answering 200 for it).
    const spaRewrite = new CloudFrontFunction(this, 'SpaRewrite', {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromFile({
        filePath: url.fileURLToPath(
          new URL('./spa-rewrite.js', import.meta.url),
        ),
      }),
    });

    const defaultRootObject = 'index.html';
    this.cloudFrontDistribution = new Distribution(
      this,
      'CloudfrontDistribution',
      {
        webAclId: wafStack?.wafArn,
        enableLogging: true,
        logBucket: logBucket,
        ...(certificate
          ? {
              certificate,
              domainNames,
              minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            }
          : {}),
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(this.websiteBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy,
          functionAssociations: [
            {
              function: spaRewrite,
              eventType: FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        defaultRootObject,
      },
    );
    if (!certificate) {
      // See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html
      suppressRules(
        this.cloudFrontDistribution,
        ['CKV_AWS_174'],
        'Cloudfront default certificate does not use TLS 1.2',
      );
    }

    this.bucketDeployment = new BucketDeployment(this, 'WebsiteDeployment', {
      sources: [Source.asset(websiteFilePath)],
      destinationBucket: this.websiteBucket,
      distribution: this.cloudFrontDistribution,
      // Exclude the runtime config from this deployment's sync so its default pruning
      // never deletes the file managed separately by RuntimeConfigDeployment below.
      exclude: [DEFAULT_RUNTIME_CONFIG_FILENAME],
      memoryLimit: 1024,
    });

    // Deploy runtime-config.json separately so it is never cached - clients
    // must always fetch the latest configuration.
    const runtimeConfigDeploymentScope = runtimeConfigScope ?? this;
    new BucketDeployment(
      runtimeConfigDeploymentScope,
      runtimeConfigScope
        ? `${websiteName}RuntimeConfigDeployment`
        : 'RuntimeConfigDeployment',
      {
        sources: [
          Source.data(
            DEFAULT_RUNTIME_CONFIG_FILENAME,
            Lazy.string({
              produce: () =>
                Stack.of(runtimeConfigDeploymentScope).toJsonString(
                  RuntimeConfig.ensure(this).get('connection'),
                ),
            }),
          ),
        ],
        destinationBucket: this.websiteBucket,
        distribution: this.cloudFrontDistribution,
        cacheControl: [CacheControl.noCache()],
        prune: false,
        memoryLimit: 1024,
      },
    );

    // BucketDeployment's provider is a per-stack singleton, so suppress in
    // every stack that ends up with one.
    for (const stack of new Set([
      Stack.of(this),
      Stack.of(runtimeConfigDeploymentScope),
    ])) {
      suppressRules(
        stack,
        ['CKV_AWS_111'],
        'CDK Bucket Deployment uses wildcard to deploy arbitrary assets',
        (c) =>
          CfnResource.isCfnResource(c) &&
          c.cfnResourceType === 'AWS::IAM::Policy' &&
          c.node.path.includes(`/Custom::CDKBucketDeployment`),
      );
    }

    new CfnOutput(this, 'DistributionDomainName', {
      value: this.cloudFrontDistribution.domainName,
    });
    new CfnOutput(this, `${websiteName}WebsiteBucketName`, {
      value: this.websiteBucket.bucketName,
    });
  }

  /**
   * Delivers a bucket's S3 server access logs to a CloudWatch log group using
   * CloudWatch Logs vended log delivery.
   */
  private deliverAccessLogsToCloudWatch(
    id: string,
    bucket: IBucket,
    logGroup: LogGroup,
  ) {
    const source: CfnDeliverySource = new CfnDeliverySource(
      this,
      `${id}AccessLogsSource`,
      {
        name: Lazy.string({
          produce: () => Names.uniqueResourceName(source, { maxLength: 60 }),
        }),
        logType: 'S3_SERVER_ACCESS_LOGS',
        resourceArn: bucket.bucketArn,
      },
    );
    const bucketPolicy = (bucket as Bucket).policy;
    if (bucketPolicy) {
      source.node.addDependency(bucketPolicy);
    }
    const destination: CfnDeliveryDestination = new CfnDeliveryDestination(
      this,
      `${id}AccessLogsDestination`,
      {
        name: Lazy.string({
          produce: () =>
            Names.uniqueResourceName(destination, { maxLength: 60 }),
        }),
        destinationResourceArn: logGroup.logGroupArn,
      },
    );
    const delivery = new CfnDelivery(this, `${id}AccessLogsDelivery`, {
      deliverySourceName: source.name,
      deliveryDestinationArn: destination.attrArn,
    });
    delivery.addResourceDependency(
      source,
      'The delivery must wait for its delivery source to exist.',
    );
  }
}

export class CloudfrontWebAcl extends Stack {
  public readonly wafArn;
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      env: {
        region: 'us-east-1',
        account: Stack.of(scope).account,
      },
      crossRegionReferences: true,
    });

    this.wafArn = new CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: id,
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
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'MetricForWebACLCDK-CRS',
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
            metricName: 'MetricForWebACLCDK-CRS',
            sampledRequestsEnabled: true,
          },
          overrideAction: {
            none: {},
          },
        },
      ],
    }).attrArn;
  }
}
