/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { UNATTACHED_TAG } from '@discava/common-server-utils/public-media';
import { CfnOutput, Duration, Lazy, RemovalPolicy } from 'aws-cdk-lib';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  Distribution,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { IKey, Key } from 'aws-cdk-lib/aws-kms';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  IBucket,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { suppressRules } from './checkov.js';
import { findCloudFrontDomainNames } from './cloudfront.js';
import { RuntimeConfig } from './runtime-config.js';
import { CloudfrontWebAcl } from './static-website.js';

export interface PublicBucketProps {
  /**
   * RuntimeConfig key used under the `s3` namespace.
   */
  readonly runtimeConfigKey: string;
  /**
   * Whether to encrypt the bucket with a customer-managed KMS key.
   *
   * @default true
   */
  readonly enableKmsEncryption?: boolean;
  /**
   * KMS key used to encrypt the bucket. Only used when `enableKmsEncryption`
   * is `true`. When not provided, a new key is created.
   */
  readonly encryptionKey?: IKey;
  /**
   * Whether the automatically created KMS key has rotation enabled. Only
   * applies when `enableKmsEncryption` is `true` and no `encryptionKey` is
   * supplied.
   *
   * @default true
   */
  readonly enableKeyRotation?: boolean;
  /**
   * Whether to protect the CloudFront distribution in front of the bucket
   * with an AWS WAF Web ACL.
   *
   * @default true
   */
  readonly enableWaf?: boolean;
  /**
   * Removal policy applied to the bucket when its stack is deleted.
   * `autoDeleteObjects` is only enabled when this is `RemovalPolicy.DESTROY`.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
  /**
   * Custom domain names for the CloudFront distribution. Requires `certificate`.
   */
  readonly domainNames?: string[];
  /**
   * ACM certificate for the custom domain names. Must be in us-east-1.
   * When provided, viewers are required to use TLS 1.2 or later.
   */
  readonly certificate?: ICertificate;
}

/**
 * A private S3 bucket served through a CloudFront distribution anyone can
 * read from, for media shown to people who haven't enrolled in anything
 * (e.g. course images on a catalog card). Unlike MediaBucket, CloudFront
 * requires no signature, so nothing that needs one may go in here. The
 * bucket itself is still only reachable through CloudFront (Origin Access
 * Control), and uploads are presigned PUTs generated server-side.
 *
 * Objects tagged UNATTACHED_TAG expire after a day, so an upload that's
 * never saved, or an object that's been replaced, cleans itself up.
 */
export class PublicBucket extends Construct {
  public readonly bucket: IBucket;
  public readonly cloudFrontDistribution: Distribution;
  private allowedOrigins: string[] = ['*'];

  constructor(
    scope: Construct,
    id: string,
    {
      runtimeConfigKey,
      enableKmsEncryption = true,
      encryptionKey,
      enableKeyRotation = true,
      enableWaf = true,
      removalPolicy = RemovalPolicy.RETAIN,
      domainNames,
      certificate,
    }: PublicBucketProps,
  ) {
    super(scope, id);

    const key: IKey | undefined = enableKmsEncryption
      ? (encryptionKey ?? new Key(this, 'EncryptionKey', { enableKeyRotation }))
      : undefined;

    this.bucket = new Bucket(this, runtimeConfigKey, {
      versioned: false,
      enforceSSL: true,
      encryption: key ? BucketEncryption.KMS : BucketEncryption.S3_MANAGED,
      encryptionKey: key,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          tagFilters: { [UNATTACHED_TAG.Key]: UNATTACHED_TAG.Value },
          expiration: Duration.days(1),
        },
      ],
      cors: [
        {
          allowedMethods: [HttpMethods.PUT],
          allowedOrigins: Lazy.list({ produce: () => this.allowedOrigins }),
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });
    suppressRules(
      this.bucket,
      ['CKV_AWS_18'],
      'Private, presigned-only bucket; server access logs are not required',
    );
    suppressRules(
      this.bucket,
      ['CKV_AWS_21'],
      'Every object is written to a unique, nonce-scoped path and never overwritten; versioning has no use here and only complicates deletion',
    );

    const wafStack = enableWaf ? new CloudfrontWebAcl(this, 'waf') : undefined;

    this.cloudFrontDistribution = new Distribution(this, 'Distribution', {
      webAclId: wafStack?.wafArn,
      ...(certificate
        ? {
            certificate,
            domainNames,
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });
    // As for MediaBucket: withOriginAccessControl lets CloudFront decrypt
    // with the bucket's key, and the bucket policy limits reads to this
    // distribution.

    if (!certificate) {
      // See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html
      suppressRules(
        this.cloudFrontDistribution,
        ['CKV_AWS_174'],
        'Cloudfront default certificate does not use TLS 1.2',
      );
    }
    suppressRules(
      this.cloudFrontDistribution,
      ['CKV_AWS_86'],
      'Access logs are not required for this public media distribution',
    );

    // The custom domain when one's in use (see MediaBucket), so URLs built
    // from it use it.
    const cloudFrontDomainName =
      certificate && domainNames?.[0]
        ? domainNames[0]
        : this.cloudFrontDistribution.domainName;
    const rc = RuntimeConfig.ensure(this);
    rc.set('s3', runtimeConfigKey, {
      bucketName: this.bucket.bucketName,
      cloudFrontDomainName,
    });
    // The portals build image URLs themselves, from the object keys the APIs
    // return, so they get the base URL too: under `connection.media`, which
    // reaches their runtime-config.json, unlike `s3`.
    rc.set('connection', 'media', {
      ...rc.get('connection').media,
      [runtimeConfigKey]: `https://${cloudFrontDomainName}/`,
    });

    // Always the generated *.cloudfront.net hostname: it's the target a
    // custom domain's DNS record points at.
    new CfnOutput(this, 'DistributionDomainName', {
      value: this.cloudFrontDistribution.domainName,
    });
  }

  /**
   * Restricts the bucket's CORS configuration to the provided origins.
   *
   * @param origins - The origin strings, CloudFront distributions, or objects containing a CloudFront distribution to grant CORS from
   */
  public restrictCorsTo(
    ...origins: (
      | string
      | Distribution
      | { cloudFrontDistribution: Distribution }
    )[]
  ) {
    this.allowedOrigins = origins.flatMap((origin) =>
      typeof origin === 'string'
        ? [origin]
        : findCloudFrontDomainNames(
            'cloudFrontDistribution' in origin
              ? origin.cloudFrontDistribution
              : origin,
          ).map((domain) => `https://${domain}`),
    );
  }

  /**
   * Lets `grantee` presign uploads, which arrive tagged UNATTACHED_TAG, and
   * attach, detach or check an object: read its size and type, and set or
   * clear its tags.
   */
  public grantManageObjects(grantee: IGrantable): Grant {
    this.bucket.grantRead(grantee);
    this.bucket.grantPut(grantee);
    return Grant.addToPrincipalOrResource({
      grantee,
      actions: ['s3:PutObjectTagging', 's3:DeleteObjectTagging'],
      resourceArns: [this.bucket.arnForObjects('*')],
      resource: this.bucket,
    });
  }
}
