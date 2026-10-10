/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CoreTable,
  InstructorApi,
  InstructorPortal,
  LessonMediaBucket,
  LessonMediaUploadBucket,
  suppressRules,
  UserIdentity,
} from '@discava/common-constructs';
import type { InstructorApiComponentConfig } from '@discava/common-infra-config';
import { CfnResource, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import type { MediaPipelineStack } from './media-pipeline-stack.js';

type InstructorApiIntegrations = ReturnType<
  ReturnType<typeof InstructorApi.defaultIntegrations>['build']
>;

// Procedures that can delete a lesson video's S3 objects: deleting a
// lesson or module cascades to its content items, best-effort-deleting
// each one's underlying S3 object -- as does every permanent delete of an
// archived content item, lesson or module.
const CASCADE_DELETE_PROCEDURES = [
  'lesson.delete',
  'module.delete',
  'contentItem.deletePermanently',
  'lesson.deletePermanently',
  'module.deletePermanently',
] as const;

// The procedures that can reach bestEffortCancelTranscodeJob(s).
const TRANSCODE_CANCEL_PROCEDURES = [
  'contentItem.createVideo',
  'contentItem.updateVideo',
  'contentItem.delete',
  ...CASCADE_DELETE_PROCEDURES,
] as const;

export interface InstructorApiStackProps extends StackProps {
  /** Settings for the instructor API construct. @default all enabled */
  readonly instructorApi?: InstructorApiComponentConfig;
  readonly identity: UserIdentity;
  readonly coreTable: CoreTable;
  readonly lessonMediaBucket: LessonMediaBucket;
  readonly lessonMediaUploadBucket: LessonMediaUploadBucket;
  readonly mediaPipeline: MediaPipelineStack;
  /** The only portal that calls instructor-api. */
  readonly instructorPortal: InstructorPortal;
}

/**
 * The tRPC API only instructors can call, plus every lesson-media and
 * transcode permission its procedures need.
 */
export class InstructorApiStack extends Stack {
  public readonly instructorApi: InstructorApi<InstructorApiIntegrations>;
  private readonly integrations: InstructorApiIntegrations;

  constructor(
    scope: Construct,
    id: string,
    {
      instructorApi: instructorApiConfig,
      identity,
      coreTable,
      lessonMediaBucket,
      lessonMediaUploadBucket,
      mediaPipeline,
      instructorPortal,
      ...props
    }: InstructorApiStackProps,
  ) {
    super(scope, id, props);

    const instructorApiKmsEnabled =
      instructorApiConfig?.enableKmsEncryption ?? true;
    this.integrations = InstructorApi.defaultIntegrations(this).build();
    const instructorApiCertificate = instructorApiConfig?.certificateArn
      ? Certificate.fromCertificateArn(
          this,
          'InstructorApiCertificate',
          instructorApiConfig.certificateArn,
        )
      : undefined;

    this.instructorApi = new InstructorApi(this, 'InstructorApi', {
      integrations: this.integrations,
      identity,
      enableWaf: instructorApiConfig?.enableWaf ?? true,
      enableKmsEncryption: instructorApiKmsEnabled,
      enableKeyRotation: instructorApiConfig?.enableKeyRotation ?? true,
      removalPolicy:
        (instructorApiConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
      domainName: instructorApiConfig?.domainName,
      certificate: instructorApiCertificate,
    });
    if (!instructorApiKmsEnabled) {
      suppressRules(
        this,
        ['CKV_AWS_158'],
        'KMS encryption disabled for this stage',
        (c) =>
          CfnResource.isCfnResource(c) &&
          c.cfnResourceType === 'AWS::Logs::LogGroup' &&
          c.node.path.includes('/InstructorApi/AccessLogs'),
      );
    }

    Object.values(this.integrations).forEach(({ handler }) =>
      coreTable.grantReadWriteData(handler),
    );

    this.grantLessonMediaAccess(lessonMediaBucket);
    this.grantLessonMediaUploadAccess(lessonMediaUploadBucket);
    for (const op of [
      'contentItem.createVideo',
      'contentItem.updateVideo',
    ] as const) {
      mediaPipeline.grantSubmitTranscodeJob(this.privilegedHandler(op));
    }
    for (const op of TRANSCODE_CANCEL_PROCEDURES) {
      mediaPipeline.grantCancelTranscodeJob(this.privilegedHandler(op));
    }

    this.instructorApi.restrictCorsTo(
      instructorPortal,
      'http://localhost:4200',
      'http://localhost:4300',
    );
  }

  // Every grant beyond the baseline (table + AppConfig) goes through this,
  // so a procedure missing from INSTRUCTOR_API_DEDICATED_FUNCTIONS fails
  // synth instead of silently handing its permissions to the shared router
  // function that serves every other instructor procedure.
  private privilegedHandler(op: keyof InstructorApiIntegrations) {
    if (!InstructorApi.hasDedicatedFunction(op)) {
      throw new Error(
        `instructor-api operation '${op}' is served by the shared router; add it to INSTRUCTOR_API_DEDICATED_FUNCTIONS before granting it extra permissions`,
      );
    }
    return this.integrations[op].handler;
  }

  private grantLessonMediaAccess(lessonMediaBucket: LessonMediaBucket) {
    lessonMediaBucket.grantPut(
      this.privilegedHandler('contentItem.createVideoUploadUrl'),
    );
    lessonMediaBucket.grantReadSigningKey(
      this.privilegedHandler('contentItem.createVideoUrl'),
    );
    // bestEffortDeleteContentItemVideos lists a ready item's whole
    // .../content-items/<id>/ prefix (manifest + segments) before batch-
    // deleting it, so every handler that can reach that best-effort cleanup
    // for a ready video needs read (for ListObjectsV2) alongside delete --
    // delete alone can't list, so without this the list throws AccessDenied,
    // gets swallowed by the best-effort error handling, and the old HLS
    // output is silently orphaned forever instead of cleaned up.
    // updateContentItemVideo also best-effort-deletes the old S3 object when
    // a video is replaced with a new file. updateContentItemText never
    // touches S3, so it gets no bucket permissions.
    for (const op of [
      'contentItem.delete',
      'contentItem.updateVideo',
      ...CASCADE_DELETE_PROCEDURES,
    ] as const) {
      lessonMediaBucket.grantRead(this.privilegedHandler(op));
      lessonMediaBucket.grantDelete(this.privilegedHandler(op));
    }
  }

  private grantLessonMediaUploadAccess(
    lessonMediaUploadBucket: LessonMediaUploadBucket,
  ) {
    // createContentItemVideoUploadUrl targets this bucket instead of
    // lessonMediaBucket -- the raw upload never sits behind CloudFront.
    lessonMediaUploadBucket.grantPut(
      this.privilegedHandler('contentItem.createVideoUploadUrl'),
    );
    // createContentItemVideo/updateContentItemVideo check the upload
    // actually exists before recording/submitting a transcode job for it.
    for (const op of [
      'contentItem.createVideo',
      'contentItem.updateVideo',
    ] as const) {
      lessonMediaUploadBucket.grantRead(this.privilegedHandler(op));
    }
    // Which bucket a delete/replace targets depends on the content item's
    // status, so these handlers need delete on both buckets.
    for (const op of [
      'contentItem.delete',
      'contentItem.updateVideo',
      ...CASCADE_DELETE_PROCEDURES,
    ] as const) {
      lessonMediaUploadBucket.grantDelete(this.privilegedHandler(op));
    }
  }
}
