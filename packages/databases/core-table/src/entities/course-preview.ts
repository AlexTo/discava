/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';
import { captionAttributes } from './content-item.js';

// The longest a course's preview video may be.
export const PREVIEW_MAX_SECONDS = 300;

// A course's preview video: at most one per course, in the course's partition
// but not in the `curriculum` collection (no read needs it with the
// curriculum). A separate record from the course so processing and caption
// updates never change course.updatedAt.
export const createCoursePreviewEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'coursePreview',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        // As a lesson video's status, but named for what the editor shows.
        status: {
          type: ['processing', 'ready', 'failed'] as const,
          required: true,
        },
        // This attempt's manifest, once ready:
        // courses/<courseId>/preview/<submissionNonce>/master.m3u8.
        s3Key: {
          type: 'string',
        },
        // The version kept playable while a replacement processes, or after
        // it failed.
        previousS3Key: {
          type: 'string',
        },
        // The current attempt. Scopes its output paths and conditions every
        // pipeline write.
        submissionNonce: {
          type: 'string',
          required: true,
        },
        mimeType: {
          type: 'string',
        },
        // The job a completion event must match (#123).
        mediaConvertJobId: {
          type: 'string',
        },
        // The raw upload's ETag: tells a retry from a replacement.
        rawObjectETag: {
          type: 'string',
        },
        // Set together while the attempt waits for its transcode, removed
        // together when it ends, as on lesson videos (#125).
        transcodePending: {
          type: ['pending'] as const,
        },
        transcodePendingSince: {
          type: 'string',
        },
        // Set only when failed, so the editor can say why.
        failureReason: {
          type: ['too-long', 'transcode-error'] as const,
        },
        // Declared at upload, replaced by the transcoded duration.
        durationSeconds: {
          type: 'number',
          required: true,
          validate: (value: number) =>
            Number.isFinite(value) &&
            value >= 1 &&
            value <= PREVIEW_MAX_SECONDS,
        },
        // Automatic captions only; written through helpers/caption-tracks.ts.
        ...captionAttributes,
        // The instructor who started the current attempt. Never exposed
        // publicly.
        uploadedBy: {
          type: 'string',
          required: true,
        },
        createdAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          readOnly: true,
        },
        updatedAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          watch: '*',
          set: () => new Date().toISOString(),
        },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: [],
          },
        },
        // Previews waiting for their transcode, oldest first: what the
        // transcode reconciler checks for stuck ones. Sparse, defined as
        // contentItem's; ElectroDB prefixes keys with the entity name, so
        // neither query returns the other's records.
        byTranscodePending: {
          index: 'gsi1pk-gsi1sk-index',
          condition: (attr) =>
            attr.transcodePending !== undefined &&
            attr.transcodePendingSince !== undefined,
          pk: {
            field: 'gsi1pk',
            composite: ['transcodePending'],
          },
          sk: {
            field: 'gsi1sk',
            composite: ['transcodePendingSince'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
