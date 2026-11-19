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
  PublicMediaBucket,
  UserIdentity,
} from '@discava/common-constructs';
import type { InstructorApiComponentConfig } from '@discava/common-infra-config';
import { localPortalOrigins } from '@discava/common-infra-config/local-portals';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { MediaPipelineStack } from './media-pipeline-stack.js';
import { privilegedHandler, trpcApiProps } from './trpc-api-props.js';

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
  readonly publicMediaBucket: PublicMediaBucket;
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
      publicMediaBucket,
      mediaPipeline,
      instructorPortal,
      ...props
    }: InstructorApiStackProps,
  ) {
    super(scope, id, props);

    const {
      limits,
      props: apiProps,
      suppressLogGroupKmsRule,
    } = trpcApiProps(this, 'InstructorApi', instructorApiConfig);
    this.integrations = InstructorApi.defaultIntegrations(
      this,
      limits.functionOptions,
    ).build();

    this.instructorApi = new InstructorApi(this, 'InstructorApi', {
      integrations: this.integrations,
      identity,
      ...apiProps,
    });
    suppressLogGroupKmsRule();

    Object.values(this.integrations).forEach(({ handler }) =>
      coreTable.grantReadWriteData(handler),
    );

    this.grantLessonMediaAccess(lessonMediaBucket);
    this.grantLessonMediaUploadAccess(lessonMediaUploadBucket);
    for (const op of [
      'course.createImageUploadUrl',
      'course.updateImage',
    ] as const) {
      publicMediaBucket.grantManageObjects(this.privilegedHandler(op));
    }
    for (const op of [
      'contentItem.createVideo',
      'contentItem.updateVideo',
    ] as const) {
      mediaPipeline.grantSubmitTranscodeJob(this.privilegedHandler(op));
    }
    for (const op of TRANSCODE_CANCEL_PROCEDURES) {
      mediaPipeline.grantCancelTranscodeJob(this.privilegedHandler(op));
    }
    // A replaced file's old version is retired by a scheduled cleanup (#102).
    mediaPipeline.grantScheduleCleanup(
      this.privilegedHandler('contentItem.updateFile'),
    );

    this.instructorApi.restrictCorsTo(
      instructorPortal,
      ...localPortalOrigins('instructor'),
    );
  }

  // Every grant beyond the baseline (table + AppConfig) goes through this,
  // so a procedure missing from INSTRUCTOR_API_DEDICATED_FUNCTIONS fails
  // synth instead of silently handing its permissions to the shared router
  // function that serves every other instructor procedure.
  private privilegedHandler(op: keyof InstructorApiIntegrations & string) {
    return privilegedHandler(
      InstructorApi,
      'instructor-api',
      this.integrations,
      op,
    );
  }

  private grantLessonMediaAccess(lessonMediaBucket: LessonMediaBucket) {
    lessonMediaBucket.grantPut(
      this.privilegedHandler('contentItem.createVideoUploadUrl'),
    );
    for (const op of [
      'contentItem.createVideoUrl',
      'contentItem.createFileUrl',
    ] as const) {
      lessonMediaBucket.grantReadSigningKey(this.privilegedHandler(op));
    }
    // A file item's file is copied in from the upload bucket when it's saved,
    // and the copy deleted again if the save then fails (#102).
    for (const op of [
      'contentItem.createFile',
      'contentItem.updateFile',
    ] as const) {
      lessonMediaBucket.grantPut(this.privilegedHandler(op));
      lessonMediaBucket.grantDelete(this.privilegedHandler(op));
    }
    // An attached caption is read from the upload bucket and written here, and it
    // is deleted again if the save fails; a replaced or removed track's file is
    // deleted too.
    lessonMediaBucket.grantPut(
      this.privilegedHandler('contentItem.attachCaption'),
    );
    for (const op of [
      'contentItem.attachCaption',
      'contentItem.removeCaption',
    ] as const) {
      lessonMediaBucket.grantDelete(this.privilegedHandler(op));
    }
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
    for (const op of [
      'contentItem.createVideoUploadUrl',
      'contentItem.createFileUploadUrl',
      'contentItem.captionUploadUrl',
    ] as const) {
      lessonMediaUploadBucket.grantPut(this.privilegedHandler(op));
    }
    // createContentItemVideo/updateContentItemVideo check the upload
    // actually exists before recording/submitting a transcode job for it.
    // createContentItemFile/updateContentItemFile check theirs too, then copy
    // it (which reads it) into the lesson media bucket.
    for (const op of [
      'contentItem.createVideo',
      'contentItem.updateVideo',
      'contentItem.createFile',
      'contentItem.updateFile',
      'contentItem.attachCaption',
    ] as const) {
      lessonMediaUploadBucket.grantRead(this.privilegedHandler(op));
    }
    // attachCaption deletes the upload once it's attached, or when it's
    // refused as not WebVTT or too large.
    lessonMediaUploadBucket.grantDelete(
      this.privilegedHandler('contentItem.attachCaption'),
    );
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
