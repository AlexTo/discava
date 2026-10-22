/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreTable,
  EventsPostConfirmation,
  EventsPreTokenGeneration,
  InstructorPortal,
  LessonMediaBucket,
  LessonMediaUploadBucket,
  PublicMediaBucket,
  RuntimeConfig,
  StudentPortal,
  suppressRules,
  UserIdentity,
} from '@discava/common-constructs';
import type {
  CoreTableComponentConfig,
  IdentityComponentConfig,
  LessonMediaComponentConfig,
  PublicMediaComponentConfig,
} from '@discava/common-infra-config';
import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Mfa, UserPoolOperation } from 'aws-cdk-lib/aws-cognito';
import { TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  /** Settings for the Cognito user pool / identity construct. @default all enabled */
  readonly identity?: IdentityComponentConfig;
  /** Settings for the core DynamoDB table construct. @default all enabled */
  readonly coreTable?: CoreTableComponentConfig;
  /** Settings for the lesson media S3 bucket construct. @default all enabled */
  readonly lessonMedia?: LessonMediaComponentConfig;
  /** Settings for the public media bucket construct. @default all enabled */
  readonly publicMedia?: PublicMediaComponentConfig;
  /** Uploads and previews lesson media: allowed by both media buckets' CORS. */
  readonly instructorPortal: InstructorPortal;
  /** Plays lesson videos: allowed by the lesson media bucket's CORS only. */
  readonly studentPortal: StudentPortal;
}

/**
 * Stateful resources: users, the core table, lesson media and public media. Kept apart
 * from the stacks that change on most deploys, and depended on by every API
 * and event handler stack.
 */
export class DataStack extends Stack {
  public readonly identity: UserIdentity;
  public readonly coreTable: CoreTable;
  public readonly lessonMediaBucket: LessonMediaBucket;
  public readonly lessonMediaUploadBucket: LessonMediaUploadBucket;
  public readonly publicMediaBucket: PublicMediaBucket;

  constructor(
    scope: Construct,
    id: string,
    {
      identity: identityConfig,
      coreTable: coreTableConfig,
      lessonMedia: lessonMediaConfig,
      publicMedia: publicMediaConfig,
      instructorPortal,
      studentPortal,
      ...props
    }: DataStackProps,
  ) {
    super(scope, id, props);

    this.identity = this.createIdentity(identityConfig);
    this.coreTable = this.createCoreTable(coreTableConfig);
    this.syncUsersToCoreTable();
    this.lessonMediaBucket = this.createLessonMediaBucket(lessonMediaConfig);
    this.lessonMediaUploadBucket =
      this.createLessonMediaUploadBucket(lessonMediaConfig);
    this.publicMediaBucket = this.createPublicMediaBucket(publicMediaConfig);

    // hls.js fetches a video's manifest, renditions and segments with
    // cross-origin requests, so both portals that play lesson videos must be
    // allowed. Only instructors upload, so the upload bucket allows them
    // alone.
    this.lessonMediaBucket.restrictCorsTo(
      instructorPortal,
      studentPortal,
      'http://localhost:4200',
      'http://localhost:4300',
      'http://localhost:4201',
      'http://localhost:4301',
    );
    this.lessonMediaUploadBucket.restrictCorsTo(
      instructorPortal,
      'http://localhost:4200',
      'http://localhost:4300',
    );
    // Images are shown with plain <img> tags, which need no CORS; only the
    // instructor portal's uploads do.
    this.publicMediaBucket.restrictCorsTo(
      instructorPortal,
      'http://localhost:4200',
      'http://localhost:4300',
    );
  }

  private createIdentity(identityConfig?: IdentityComponentConfig) {
    const identity = new UserIdentity(this, 'Identity', {
      enableWaf: identityConfig?.enableWaf ?? true,
      mfa: (identityConfig?.enableMfa ?? true) ? Mfa.REQUIRED : Mfa.OFF,
      deletionProtection: identityConfig?.enableDeletionProtection ?? true,
      selfSignUpEnabled: identityConfig?.enableSelfSignUp ?? true,
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
    // Its own policy rather than addToRolePolicy, which would make the
    // function wait for it: the pool waits for the function (its trigger) and
    // this policy for the pool (its ARN), so that would be circular (#29).
    new Policy(this, 'PostConfirmationAddToGroup', {
      roles: [postConfirmation.role!],
      statements: [
        new PolicyStatement({
          actions: ['cognito-idp:AdminAddUserToGroup'],
          resources: [identity.userPool.userPoolArn],
        }),
      ],
    });
    identity.userPool.addTrigger(
      UserPoolOperation.POST_CONFIRMATION,
      postConfirmation,
    );

    return identity;
  }

  // Keeps each user's core table record in step with Cognito (#230). Pre
  // token generation runs on every sign-in, including an admin-created user's
  // first, and on every token refresh; post-confirmation misses admin-created
  // users, and managed login doesn't run post-authentication.
  private syncUsersToCoreTable() {
    const preTokenGeneration = new EventsPreTokenGeneration(
      this,
      'PreTokenGeneration',
    );
    const runtimeConfig = RuntimeConfig.ensure(this);
    preTokenGeneration.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(preTokenGeneration);
    this.coreTable.grantReadWriteData(preTokenGeneration);
    // Its environment only holds the AppConfig application's ID (a Ref).
    // Checkov's secret scan also reads a __file__ key its own parser injects
    // (the template's path), and this stack's CDK-hashed template file name
    // trips CKV_AWS_45 on it.
    suppressRules(
      preTokenGeneration,
      ['CKV_AWS_45'],
      'Environment only holds the AppConfig application ID; checkov flags its injected template path',
    );
    this.identity.userPool.addTrigger(
      UserPoolOperation.PRE_TOKEN_GENERATION,
      preTokenGeneration,
    );
  }

  private createCoreTable(coreTableConfig?: CoreTableComponentConfig) {
    const coreTableKmsEnabled = coreTableConfig?.enableKmsEncryption ?? true;
    const coreTable = new CoreTable(this, 'CoreTable', {
      encryption: coreTableKmsEnabled
        ? TableEncryption.CUSTOMER_MANAGED
        : TableEncryption.DEFAULT,
      enableKeyRotation: coreTableConfig?.enableKeyRotation ?? true,
      deletionProtection: coreTableConfig?.enableDeletionProtection ?? true,
      maxReadRequestUnits: coreTableConfig?.maxReadRequestUnits,
      maxWriteRequestUnits: coreTableConfig?.maxWriteRequestUnits,
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

  private createPublicMediaBucket(
    publicMediaConfig: PublicMediaComponentConfig | undefined,
  ) {
    const kmsEnabled = publicMediaConfig?.enableKmsEncryption ?? true;
    const wafEnabled = publicMediaConfig?.enableWaf ?? true;
    const certificate = publicMediaConfig?.certificateArn
      ? Certificate.fromCertificateArn(
          this,
          'PublicMediaCertificate',
          publicMediaConfig.certificateArn,
        )
      : undefined;
    const publicMediaBucket = new PublicMediaBucket(this, 'PublicMediaBucket', {
      enableWaf: wafEnabled,
      enableKmsEncryption: kmsEnabled,
      enableKeyRotation: publicMediaConfig?.enableKeyRotation ?? true,
      removalPolicy: publicMediaConfig?.retainOnDelete
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      domainNames: publicMediaConfig?.domainNames,
      certificate,
    });
    if (!kmsEnabled) {
      suppressRules(
        publicMediaBucket.bucket,
        ['CKV_AWS_145'],
        'KMS CMK encryption disabled for this stage',
      );
    }
    if (!wafEnabled) {
      suppressRules(
        publicMediaBucket.cloudFrontDistribution,
        ['CKV_AWS_68'],
        'WAF disabled for this stage',
      );
    }
    return publicMediaBucket;
  }
}
