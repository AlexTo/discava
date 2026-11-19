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
  SearchCollection,
  StripeSecrets,
  StudentPortal,
  suppressRules,
  UserIdentity,
} from '@discava/common-constructs';
import type {
  CoreTableComponentConfig,
  IdentityComponentConfig,
  LessonMediaComponentConfig,
  PublicMediaComponentConfig,
  SearchComponentConfig,
} from '@discava/common-infra-config';
import { localPortalOrigins } from '@discava/common-infra-config/local-portals';
import { Names, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Mfa, UserPoolOperation } from 'aws-cdk-lib/aws-cognito';
import { TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Policy, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
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
  /** Settings for the OpenSearch Serverless search collection. @default all enabled */
  readonly search?: SearchComponentConfig;
  /** Uploads and previews lesson media: allowed by both media buckets' CORS. */
  readonly instructorPortal: InstructorPortal;
  /** Plays lesson videos: allowed by the lesson media bucket's CORS only. */
  readonly studentPortal: StudentPortal;
}

/**
 * Stateful resources: users, the core table, lesson and public media, the
 * search collection, and the notification and Stripe secrets. Kept apart from
 * the stacks that change on most deploys, and depended on by every API and
 * event handler stack.
 */
export class DataStack extends Stack {
  public readonly identity: UserIdentity;
  public readonly coreTable: CoreTable;
  public readonly lessonMediaBucket: LessonMediaBucket;
  public readonly lessonMediaUploadBucket: LessonMediaUploadBucket;
  public readonly publicMediaBucket: PublicMediaBucket;
  public readonly searchCollection: SearchCollection;
  /** The HMAC key that signs notification unsubscribe links. */
  public readonly notificationUnsubscribeSecret: Secret;
  /** The Stripe key and webhook signing secret an administrator's save fills. */
  public readonly stripeSecrets: StripeSecrets;

  constructor(
    scope: Construct,
    id: string,
    {
      identity: identityConfig,
      coreTable: coreTableConfig,
      lessonMedia: lessonMediaConfig,
      publicMedia: publicMediaConfig,
      search: searchConfig,
      instructorPortal,
      studentPortal,
      ...props
    }: DataStackProps,
  ) {
    super(scope, id, props);

    this.identity = this.createIdentity(identityConfig);
    this.coreTable = this.createCoreTable(coreTableConfig);
    this.syncUsersToCoreTable();
    this.grantPageRenderer(studentPortal);
    this.lessonMediaBucket = this.createLessonMediaBucket(lessonMediaConfig);
    this.lessonMediaUploadBucket =
      this.createLessonMediaUploadBucket(lessonMediaConfig);
    this.publicMediaBucket = this.createPublicMediaBucket(publicMediaConfig);
    this.searchCollection = this.createSearchCollection(searchConfig);
    this.notificationUnsubscribeSecret =
      this.createNotificationUnsubscribeSecret(coreTableConfig);
    this.stripeSecrets = new StripeSecrets(this, 'StripeSecrets', {
      enableKmsEncryption: coreTableConfig?.enableKmsEncryption ?? true,
      enableKeyRotation: coreTableConfig?.enableKeyRotation ?? true,
      removalPolicy:
        (coreTableConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });

    // hls.js fetches a video's manifest, renditions and segments with
    // cross-origin requests, so both portals that play lesson videos must be
    // allowed. Instructors upload lesson files and videos, and students their
    // assignment submissions (#102), so the upload bucket allows those two
    // portals, not the admin portal.
    this.lessonMediaBucket.restrictCorsTo(
      instructorPortal,
      studentPortal,
      ...localPortalOrigins('instructor', 'student'),
    );
    this.lessonMediaUploadBucket.restrictCorsTo(
      instructorPortal,
      studentPortal,
      ...localPortalOrigins('instructor', 'student'),
    );
    // Images are shown with plain <img> tags, which need no CORS; only the
    // instructor portal's uploads do.
    this.publicMediaBucket.restrictCorsTo(
      instructorPortal,
      ...localPortalOrigins('instructor'),
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

    // Adds every self-signed-up user to the `student` and `instructor` groups.
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

  private grantPageRenderer(studentPortal: StudentPortal) {
    if (!studentPortal.pageRendererRoleArn) {
      return;
    }
    // A mutable import, so the policy is created here, in Data. Granting on
    // the Websites-owned role would put the table's and AppConfig's ARNs in
    // Websites, which Data already depends on: a cycle.
    const role = Role.fromRoleArn(
      this,
      'PageRendererRole',
      studentPortal.pageRendererRoleArn,
      { mutable: true },
    );
    this.coreTable.grantReadData(role);
    RuntimeConfig.ensure(this).grantReadAppConfig(role);
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

  // Signs the unsubscribe links in notification emails (HMAC-SHA256); the
  // delivery function signs with it and the unsubscribe function verifies.
  // Replacing it would invalidate every link already sent, so it is kept like
  // the table, and follows the table's encryption setting. Named under the
  // stage's prefix, which CI's execution role is scoped to.
  private createNotificationUnsubscribeSecret(
    coreTableConfig?: CoreTableComponentConfig,
  ) {
    const kmsEnabled = coreTableConfig?.enableKmsEncryption ?? true;
    const secret = new Secret(this, 'NotificationUnsubscribeSecret', {
      secretName: `${Names.uniqueResourceName(this, { maxLength: 100, separator: '/' })}/NotificationUnsubscribe`,
      description: 'HMAC key that signs notification unsubscribe links',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
      encryptionKey: kmsEnabled
        ? new Key(this, 'NotificationUnsubscribeSecretKey', {
            enableKeyRotation: coreTableConfig?.enableKeyRotation ?? true,
            removalPolicy:
              (coreTableConfig?.retainOnDelete ?? true)
                ? RemovalPolicy.RETAIN
                : RemovalPolicy.DESTROY,
          })
        : undefined,
      removalPolicy:
        (coreTableConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });
    const suppressed = ['CKV_AWS_304', 'CKV2_AWS_57'];
    if (!kmsEnabled) suppressed.push('CKV_AWS_149');
    suppressRules(
      secret,
      suppressed,
      'An HMAC key for signed links: rotating it would break every link already emailed, and links carry no expiry' +
        (kmsEnabled ? '' : '; KMS CMK encryption disabled for this stage'),
    );
    return secret;
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

    // Raw uploads land here, not behind CloudFront (decision log in #110).
    // Once a video's transcode completes, TranscodeComplete deletes the raw
    // object and the lesson media bucket serves the result.
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

  private createSearchCollection(searchConfig?: SearchComponentConfig) {
    // No checkov suppression for AWS-owned-key encryption here, unlike the
    // other enableKmsEncryption toggles: checkov has no rule for
    // OpenSearch Serverless encryption. If `pnpm nx run @discava/infra:checkov`
    // starts flagging one, suppress it here as createCoreTable does.
    return new SearchCollection(this, 'SearchCollection', {
      enableKmsEncryption: searchConfig?.enableKmsEncryption ?? true,
      enableKeyRotation: searchConfig?.enableKeyRotation ?? true,
      minIndexingCapacityInOcu: searchConfig?.minIndexingCapacityInOcu,
      minSearchCapacityInOcu: searchConfig?.minSearchCapacityInOcu,
      maxIndexingCapacityInOcu: searchConfig?.maxIndexingCapacityInOcu,
      maxSearchCapacityInOcu: searchConfig?.maxSearchCapacityInOcu,
      removalPolicy:
        (searchConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });
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
