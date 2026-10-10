/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreTable,
  EventsPostConfirmation,
  InstructorPortal,
  LessonMediaBucket,
  LessonMediaUploadBucket,
  suppressRules,
  UserIdentity,
} from '@discava/common-constructs';
import type {
  CoreTableComponentConfig,
  IdentityComponentConfig,
  LessonMediaComponentConfig,
} from '@discava/common-infra-config';
import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Mfa, UserPoolOperation } from 'aws-cdk-lib/aws-cognito';
import { TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  /** Settings for the Cognito user pool / identity construct. @default all enabled */
  readonly identity?: IdentityComponentConfig;
  /** Settings for the core DynamoDB table construct. @default all enabled */
  readonly coreTable?: CoreTableComponentConfig;
  /** Settings for the lesson media S3 bucket construct. @default all enabled */
  readonly lessonMedia?: LessonMediaComponentConfig;
  /** The only origin (besides local dev) allowed to call the lesson media buckets. */
  readonly instructorPortal: InstructorPortal;
}

/**
 * Stateful resources: users, the core table and lesson media. Kept apart
 * from the stacks that change on most deploys, and depended on by every API
 * and event handler stack.
 */
export class DataStack extends Stack {
  public readonly identity: UserIdentity;
  public readonly coreTable: CoreTable;
  public readonly lessonMediaBucket: LessonMediaBucket;
  public readonly lessonMediaUploadBucket: LessonMediaUploadBucket;

  constructor(
    scope: Construct,
    id: string,
    {
      identity: identityConfig,
      coreTable: coreTableConfig,
      lessonMedia: lessonMediaConfig,
      instructorPortal,
      ...props
    }: DataStackProps,
  ) {
    super(scope, id, props);

    this.identity = this.createIdentity(identityConfig);
    this.coreTable = this.createCoreTable(coreTableConfig);
    this.lessonMediaBucket = this.createLessonMediaBucket(lessonMediaConfig);
    this.lessonMediaUploadBucket =
      this.createLessonMediaUploadBucket(lessonMediaConfig);

    for (const bucket of [
      this.lessonMediaBucket,
      this.lessonMediaUploadBucket,
    ]) {
      bucket.restrictCorsTo(
        instructorPortal,
        'http://localhost:4200',
        'http://localhost:4300',
      );
    }
  }

  private createIdentity(identityConfig?: IdentityComponentConfig) {
    const identity = new UserIdentity(this, 'Identity', {
      enableWaf: identityConfig?.enableWaf ?? true,
      mfa: (identityConfig?.enableMfa ?? true) ? Mfa.REQUIRED : Mfa.OFF,
      deletionProtection: identityConfig?.enableDeletionProtection ?? true,
      removalPolicy:
        (identityConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });

    // Adds every self-signed-up user to the `student` group
    const postConfirmation = new EventsPostConfirmation(
      this,
      'PostConfirmation',
    );
    // Scoped to any pool in this account/region rather than this specific
    // pool's ARN: referencing the pool here would create a circular
    // CloudFormation dependency, since the pool's LambdaConfig already
    // depends on this function
    postConfirmation.addToRolePolicy(
      new PolicyStatement({
        actions: ['cognito-idp:AdminAddUserToGroup'],
        resources: [
          Stack.of(this).formatArn({
            service: 'cognito-idp',
            resource: 'userpool',
            resourceName: '*',
          }),
        ],
      }),
    );
    identity.userPool.addTrigger(
      UserPoolOperation.POST_CONFIRMATION,
      postConfirmation,
    );

    return identity;
  }

  private createCoreTable(coreTableConfig?: CoreTableComponentConfig) {
    const coreTableKmsEnabled = coreTableConfig?.enableKmsEncryption ?? true;
    const coreTable = new CoreTable(this, 'CoreTable', {
      encryption: coreTableKmsEnabled
        ? TableEncryption.CUSTOMER_MANAGED
        : TableEncryption.DEFAULT,
      enableKeyRotation: coreTableConfig?.enableKeyRotation ?? true,
      deletionProtection: coreTableConfig?.enableDeletionProtection ?? true,
      removalPolicy:
        (coreTableConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });
    if (!coreTableKmsEnabled) {
      suppressRules(
        coreTable.table,
        ['CKV_AWS_119'],
        'KMS CMK encryption disabled for this stage',
      );
    }
    return coreTable;
  }

  private createLessonMediaBucket(
    lessonMediaConfig: LessonMediaComponentConfig | undefined,
  ) {
    const lessonMediaKmsEnabled =
      lessonMediaConfig?.enableKmsEncryption ?? true;
    const lessonMediaWafEnabled = lessonMediaConfig?.enableWaf ?? true;
    const lessonMediaCertificate = lessonMediaConfig?.certificateArn
      ? Certificate.fromCertificateArn(
          this,
          'LessonMediaCertificate',
          lessonMediaConfig.certificateArn,
        )
      : undefined;
    const lessonMediaBucket = new LessonMediaBucket(this, 'LessonMediaBucket', {
      enableWaf: lessonMediaWafEnabled,
      enableKmsEncryption: lessonMediaKmsEnabled,
      enableKeyRotation: lessonMediaConfig?.enableKeyRotation ?? true,
      removalPolicy: lessonMediaConfig?.retainOnDelete
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      domainNames: lessonMediaConfig?.domainNames,
      certificate: lessonMediaCertificate,
      cookieDomain: lessonMediaConfig?.cookieDomain,
    });
    if (!lessonMediaKmsEnabled) {
      suppressRules(
        lessonMediaBucket.bucket,
        ['CKV_AWS_145'],
        'KMS CMK encryption disabled for this stage',
      );
    }
    if (!lessonMediaWafEnabled) {
      suppressRules(
        lessonMediaBucket.cloudFrontDistribution,
        ['CKV_AWS_68'],
        'WAF disabled for this stage',
      );
    }
    return lessonMediaBucket;
  }

  private createLessonMediaUploadBucket(
    lessonMediaConfig: LessonMediaComponentConfig | undefined,
  ) {
    const lessonMediaKmsEnabled =
      lessonMediaConfig?.enableKmsEncryption ?? true;

    // Raw, untranscoded uploads land here instead -- see decision log in
    // #110. Once transcoding completes, TranscodeComplete deletes the raw
    // object and lessonMediaBucket takes over serving the result.
    const lessonMediaUploadBucket = new LessonMediaUploadBucket(
      this,
      'LessonMediaUploadBucket',
      {
        enableKmsEncryption: lessonMediaKmsEnabled,
        enableKeyRotation: lessonMediaConfig?.enableKeyRotation ?? true,
        removalPolicy: lessonMediaConfig?.retainOnDelete
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
      },
    );
    if (!lessonMediaKmsEnabled) {
      suppressRules(
        lessonMediaUploadBucket.bucket,
        ['CKV_AWS_145'],
        'KMS CMK encryption disabled for this stage',
      );
    }
    return lessonMediaUploadBucket;
  }
}
