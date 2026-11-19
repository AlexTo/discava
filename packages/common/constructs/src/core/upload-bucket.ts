/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Duration, Lazy, RemovalPolicy } from 'aws-cdk-lib';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
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

export interface UploadBucketProps {
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
   * Removal policy applied to the bucket when its stack is deleted.
   * `autoDeleteObjects` is only enabled when this is `RemovalPolicy.DESTROY`.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * A private S3 bucket that only ever receives a presigned PUT upload and is
 * read by a downstream processing job, never served directly -- no
 * CloudFront, signing, or WAF, unlike MediaBucket. Objects are expected to
 * be short-lived: something downstream is expected to consume and delete
 * them.
 */
export class UploadBucket extends Construct {
  public readonly bucket: IBucket;
  private allowedOrigins: string[] = ['*'];

  constructor(
    scope: Construct,
    id: string,
    {
      runtimeConfigKey,
      enableKmsEncryption = true,
      encryptionKey,
      enableKeyRotation = true,
      removalPolicy = RemovalPolicy.RETAIN,
    }: UploadBucketProps,
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
      // Backstop for uploads a caller never follows up on (e.g. an
      // instructor closes the dialog after the presigned PUT succeeds but
      // before submitting the record that would trigger downstream
      // consumption) -- otherwise such an object has nothing that will ever
      // delete it.
      lifecycleRules: [{ expiration: Duration.days(2) }],
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
      'Raw uploads are deleted as soon as downstream processing succeeds or fails; versioning would only retain copies of something already discarded',
    );

    RuntimeConfig.ensure(this).set('s3', runtimeConfigKey, {
      bucketName: this.bucket.bucketName,
    });
  }

  /**
   * Restricts the bucket's CORS configuration to the provided origins.
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

  /** `objectsKeyPattern` limits the grant to matching keys (e.g. `prefix/*`). */
  public grantPut(grantee: IGrantable, objectsKeyPattern?: string): Grant {
    return this.bucket.grantPut(grantee, objectsKeyPattern);
  }

  public grantRead(grantee: IGrantable, objectsKeyPattern?: string): Grant {
    return this.bucket.grantRead(grantee, objectsKeyPattern);
  }

  public grantDelete(grantee: IGrantable, objectsKeyPattern?: string): Grant {
    return this.bucket.grantDelete(grantee, objectsKeyPattern);
  }
}
