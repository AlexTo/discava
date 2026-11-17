/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AdminPortal,
  CoreApi,
  CoreTable,
  EventsNotificationUnsubscribe,
  EventsSearchReindex,
  InstructorPortal,
  LessonMediaBucket,
  LessonMediaUploadBucket,
  RuntimeConfig,
  SearchCollection,
  StudentPortal,
  suppressRules,
  UserIdentity,
} from '@discava/common-constructs';
import type { CoreApiComponentConfig } from '@discava/common-infra-config';
import { CfnResource, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { apiLimits, publicThrottle } from './api-limits.js';
import type { MediaPipelineStack } from './media-pipeline-stack.js';
import { importNotificationUnsubscribeSecret } from './notification-secret.js';

type CoreApiIntegrations = ReturnType<
  ReturnType<typeof CoreApi.defaultIntegrations>['build']
>;

export interface CoreApiStackProps extends StackProps {
  /** Settings for the core API construct. @default all enabled */
  readonly coreApi?: CoreApiComponentConfig;
  readonly identity: UserIdentity;
  readonly coreTable: CoreTable;
  readonly searchCollection: SearchCollection;
  /** Signs the unsubscribe links in notification emails; the unsubscribe route verifies them. */
  readonly notificationUnsubscribeSecret: ISecret;
  /** Lesson videos, whose signing key contentItem.videoUrl signs cookies with. */
  readonly lessonMediaBucket: LessonMediaBucket;
  /** Where a student's submission is uploaded before it is copied across. */
  readonly lessonMediaUploadBucket: LessonMediaUploadBucket;
  /** Schedules the cleanups of a student's submission folders. */
  readonly mediaPipeline: MediaPipelineStack;
  /** Every portal calls core-api, so all three are allowed CORS origins. */
  readonly portals: [StudentPortal, InstructorPortal, AdminPortal];
}

/**
 * The tRPC API any authenticated user can call, plus the search re-index
 * Lambda. The stream-driven handlers (progress recalculation, search
 * indexing) are in StreamRouterStack.
 */
export class CoreApiStack extends Stack {
  public readonly coreApi: CoreApi<CoreApiIntegrations>;
  /** The API's address, as clients call it: its custom domain when it has one, else the execute-api URL. No trailing slash. */
  public readonly apiUrl: string;

  constructor(
    scope: Construct,
    id: string,
    {
      coreApi: coreApiConfig,
      identity,
      coreTable,
      searchCollection,
      notificationUnsubscribeSecret,
      lessonMediaBucket,
      lessonMediaUploadBucket,
      mediaPipeline,
      portals,
      ...props
    }: CoreApiStackProps,
  ) {
    super(scope, id, props);

    const coreApiKmsEnabled = coreApiConfig?.enableKmsEncryption ?? true;
    const limits = apiLimits(coreApiConfig);
    const integrations = CoreApi.defaultIntegrations(
      this,
      limits.functionOptions,
    ).build();
    const coreApiCertificate = coreApiConfig?.certificateArn
      ? Certificate.fromCertificateArn(
          this,
          'CoreApiCertificate',
          coreApiConfig.certificateArn,
        )
      : undefined;

    const unsubscribe = this.createNotificationUnsubscribeLambda(
      coreTable,
      notificationUnsubscribeSecret,
    );

    this.coreApi = new CoreApi(this, 'CoreApi', {
      integrations,
      // The link in every notification email: anyone holding a signed token
      // may open it, so both methods are public.
      extraRoutes: (['GET', 'POST'] as const).map((method) => ({
        method,
        path: 'unsubscribe/{token}',
        integration: {
          integration: new LambdaIntegration(unsubscribe),
          handler: unsubscribe,
        },
        public: true,
      })),
      identity,
      enableWaf: coreApiConfig?.enableWaf ?? true,
      throttle: limits.throttle,
      publicThrottle: publicThrottle(coreApiConfig),
      enableTracing: limits.enableTracing,
      enableKmsEncryption: coreApiKmsEnabled,
      enableKeyRotation: coreApiConfig?.enableKeyRotation ?? true,
      removalPolicy:
        (coreApiConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
      domainName: coreApiConfig?.domainName,
      certificate: coreApiCertificate,
    });
    // With a custom domain the base path mapping serves the API without the
    // deployment stage's prefix, so clients call the domain directly.
    this.apiUrl = (
      coreApiConfig?.domainName && coreApiCertificate
        ? `https://${coreApiConfig.domainName}`
        : this.coreApi.api.url
    ).replace(/\/+$/, '');
    if (!coreApiKmsEnabled) {
      suppressRules(
        this,
        ['CKV_AWS_158'],
        'KMS encryption disabled for this stage',
        (c) =>
          CfnResource.isCfnResource(c) &&
          c.cfnResourceType === 'AWS::Logs::LogGroup' &&
          c.node.path.includes('/CoreApi/AccessLogs'),
      );
    }

    Object.values(integrations).forEach(({ handler }) => {
      coreTable.grantReadWriteData(handler);
      searchCollection.grantRead(handler.role!);
    });
    for (const op of [
      'contentItem.videoUrl',
      'contentItem.fileUrl',
      'assignment.submissionFileUrl',
    ] as const) {
      lessonMediaBucket.grantReadSigningKey(
        this.privilegedHandler(integrations, op),
      );
    }

    this.grantAssignmentSubmitAccess(
      integrations,
      lessonMediaBucket,
      lessonMediaUploadBucket,
      mediaPipeline,
    );

    this.coreApi.restrictCorsTo(
      ...portals,
      'http://localhost:4200',
      'http://localhost:4300',
      'http://localhost:4201',
      'http://localhost:4301',
      'http://localhost:4202',
      'http://localhost:4302',
    );

    this.createSearchReindexLambda(coreTable, searchCollection);
  }

  // Submitting to an upload assignment (#102): AssignmentSubmit presigns the
  // upload, checks it (reading it), copies it into the lesson media bucket,
  // deletes that copy if the submission doesn't commit, and schedules the
  // cleanups of a student's folders. Its bucket names and the schedule's
  // config come from AppConfig, which every core-api function can read.
  private grantAssignmentSubmitAccess(
    integrations: CoreApiIntegrations,
    lessonMediaBucket: LessonMediaBucket,
    lessonMediaUploadBucket: LessonMediaUploadBucket,
    mediaPipeline: MediaPipelineStack,
  ) {
    for (const op of ['assignment.uploadUrl', 'assignment.submit'] as const) {
      const handler = this.privilegedHandler(integrations, op);
      lessonMediaUploadBucket.grantPut(handler);
      lessonMediaUploadBucket.grantRead(handler);
      lessonMediaBucket.grantPut(handler);
      lessonMediaBucket.grantRead(handler);
      lessonMediaBucket.grantDelete(handler);
      mediaPipeline.grantScheduleCleanup(handler);
    }
  }

  // Every grant beyond the baseline (table + AppConfig) goes through this,
  // so a procedure missing from CORE_API_DEDICATED_FUNCTIONS fails synth
  // instead of silently handing its permissions to the shared router function
  // that serves every other core-api procedure.
  private privilegedHandler(
    integrations: CoreApiIntegrations,
    op: keyof CoreApiIntegrations,
  ) {
    if (!CoreApi.hasDedicatedFunction(op)) {
      throw new Error(
        `core-api operation '${op}' is served by the shared router; add it to CORE_API_DEDICATED_FUNCTIONS before granting it extra permissions`,
      );
    }
    return integrations[op].handler;
  }

  // Rebuilds the courses index from the core table when invoked, for after
  // the index is recreated or an indexing bug (#273). No event source and no
  // API route: only an IAM principal allowed lambda:InvokeFunction can call
  // it. It runs under its own role because the collection's data access
  // policy names Lambda roles only, so a person's AWS login can't write to
  // the index directly.
  private createSearchReindexLambda(
    coreTable: CoreTable,
    searchCollection: SearchCollection,
  ) {
    const reindex = new EventsSearchReindex(this, 'SearchReindex');
    const runtimeConfig = RuntimeConfig.ensure(this);
    reindex.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(reindex);
    coreTable.grantReadData(reindex);
    searchCollection.grantWrite(reindex.role!);
    return reindex;
  }

  // Turns a notification type's emails off for the user a signed link names
  // (verifying the token with the secret), from a click in an email or a mail
  // client's one-click request. It reads and writes the table and nothing else.
  private createNotificationUnsubscribeLambda(
    coreTable: CoreTable,
    unsubscribeSecret: ISecret,
  ) {
    const unsubscribe = new EventsNotificationUnsubscribe(
      this,
      'NotificationUnsubscribe',
    );
    coreTable.grantReadWriteData(unsubscribe);
    const secret = importNotificationUnsubscribeSecret(this, unsubscribeSecret);
    secret.grantRead(unsubscribe);
    unsubscribe.addEnvironment('UNSUBSCRIBE_SECRET_ARN', secret.secretArn);
    return unsubscribe;
  }
}
