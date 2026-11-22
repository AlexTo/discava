/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CfnOutput, Duration, Lazy, RemovalPolicy } from 'aws-cdk-lib';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  Distribution,
  KeyGroup,
  PublicKey,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { IKey, Key } from 'aws-cdk-lib/aws-kms';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
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
import { RsaKeyPairSecret } from './rsa-key-pair-secret/construct.js';
import { addSetting } from './settings.js';
import { CloudfrontWebAcl } from './static-website.js';

export interface MediaBucketProps {
  /**
   * Deploy-time setting key used under the `s3` namespace.
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
  /**
   * `Domain=` attribute for the CloudFront signed cookies issued for HLS
   * video playback. Must be a shared parent domain of `domainNames` here
   * and of the custom domains of the APIs that issue the cookies (core-api
   * and instructor-api): a cookie can only be set for the issuing domain or
   * one of its parents.
   */
  readonly cookieDomain?: string;
}

/**
 * A private S3 bucket served through a CloudFront distribution (Origin
 * Access Control, so the bucket itself stays fully private) using signed
 * URLs for downloads and signed cookies for HLS playback, and presigned PUT
 * URLs for uploads generated server-side. Objects are never publicly readable or directly reachable
 * from S3.
 */
export class MediaBucket extends Construct {
  public readonly bucket: IBucket;
  public readonly cloudFrontDistribution: Distribution;
  private readonly signingKeyPairSecret: RsaKeyPairSecret;
  private allowedOrigins: string[] = ['*'];
  private readonly runtimeConfigKey: string;
  private readonly settings: Record<string, unknown>;

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
      cookieDomain,
    }: MediaBucketProps,
  ) {
    super(scope, id);
    this.runtimeConfigKey = runtimeConfigKey;

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
      cors: [
        {
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET],
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

    // CloudFront needs a PublicKey/KeyGroup pair to validate signed URLs;
    // the underlying RSA key pair is generated by a custom resource and its
    // private key held only in Secrets Manager (see RsaKeyPairSecret).
    this.signingKeyPairSecret = new RsaKeyPairSecret(this, 'SigningKeyPair');
    const signingPublicKey = new PublicKey(this, 'SigningPublicKey', {
      encodedKey: this.signingKeyPairSecret.publicKeyPem,
    });
    const signingKeyGroup = new KeyGroup(this, 'SigningKeyGroup', {
      items: [signingPublicKey],
    });

    const wafStack = enableWaf ? new CloudfrontWebAcl(this, 'waf') : undefined;

    // hls.js fetches the manifest/segments via XHR/fetch, which is
    // subject to CORS unlike a plain <video src> load. CloudFront doesn't
    // forward S3's own CORS headers (see restrictCorsTo) on its own, so
    // this distribution needs its own.
    const corsResponseHeadersPolicy = new ResponseHeadersPolicy(
      this,
      'CorsResponseHeadersPolicy',
      {
        corsBehavior: {
          // hls.js's own fetches carry the CloudFront signed cookies, so
          // its cross-origin requests need credentials allowed under CORS.
          // A literal '*' isn't allowed here alongside credentials -- an
          // explicit list is required, so this only covers what a video
          // player's GET/HEAD requests actually need.
          accessControlAllowCredentials: true,
          accessControlAllowHeaders: ['range', 'content-type'],
          accessControlAllowMethods: ['GET', 'HEAD'],
          accessControlAllowOrigins: Lazy.list({
            produce: () => this.allowedOrigins,
          }),
          accessControlMaxAge: Duration.seconds(3000),
          originOverride: true,
        },
      },
    );

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
        trustedKeyGroups: [signingKeyGroup],
        responseHeadersPolicy: corsResponseHeadersPolicy,
      },
    });
    // For SSE-KMS objects CloudFront also needs kms:Decrypt on the bucket's
    // key, or S3 returns AccessDenied even though the signature check passed.
    // withOriginAccessControl adds that grant to the key policy itself,
    // conditioned on any distribution in this account rather than this one:
    // naming this distribution there would make the key depend on the
    // distribution, which depends on the bucket, which depends on the key.
    // Reads stay limited to this distribution by the bucket policy's
    // s3:GetObject grant, which does name it.
    // See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html#private-content-kms

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
      'Access logs are not required for this internal media distribution',
    );

    this.settings = {
      bucketName: this.bucket.bucketName,
      // The first custom domain, so signed URLs use it, but only with
      // `certificate` set: like the Distribution above, `domainNames` alone
      // adds no alias, so signed URLs would name a host CloudFront rejects.
      cloudFrontDomainName:
        certificate && domainNames?.[0]
          ? domainNames[0]
          : this.cloudFrontDistribution.domainName,
      cloudFrontKeyPairId: signingPublicKey.publicKeyId,
      cloudFrontPrivateKeySecretArn: this.signingKeyPairSecret.secretArn,
      cookieDomain,
    };

    // Always the generated *.cloudfront.net hostname, even with a custom
    // domain configured: it's the target a custom domain's DNS record points
    // at.
    new CfnOutput(this, 'DistributionDomainName', {
      value: this.cloudFrontDistribution.domainName,
    });
  }

  /**
   * Restricts the bucket's CORS configuration to the provided origins.
   */
  /** Gives `fn` the bucket's deploy-time `s3` setting. */
  public bindSettings(fn: LambdaFunction): void {
    addSetting(fn, 's3', this.runtimeConfigKey, this.settings);
  }

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

  /** `objectsKeyPattern` limits the grant to matching keys (e.g. `prefix/*`). */
  public grantPut(grantee: IGrantable, objectsKeyPattern?: string): Grant {
    return this.bucket.grantPut(grantee, objectsKeyPattern);
  }

  /** Grants read access to the secret holding the CloudFront signing key pair's private key. */
  public grantReadSigningKey(grantee: IGrantable): Grant {
    return this.signingKeyPairSecret.grantReadSecret(grantee);
  }

  // Direct-IAM read, not the CloudFront-signed-URL path content is actually
  // served over -- for a Lambda that needs to enumerate this bucket's own
  // objects itself (e.g. listing a content item's HLS output before
  // deleting it), not for anything that ends up in front of a viewer.
  public grantRead(grantee: IGrantable, objectsKeyPattern?: string): Grant {
    return this.bucket.grantRead(grantee, objectsKeyPattern);
  }

  public grantDelete(grantee: IGrantable, objectsKeyPattern?: string): Grant {
    return this.bucket.grantDelete(grantee, objectsKeyPattern);
  }
}
