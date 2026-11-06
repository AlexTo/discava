/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A student's work for an upload assignment (#102): one record per student
// and assignment, replaced by each resubmission until an instructor returns
// it. The assignment is a content item (`type: 'assignment'`) in an assignment
// lesson, so `contentItemId` names it.
export const createAssignmentSubmissionEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'assignmentSubmission',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        contentItemId: {
          type: 'string',
          required: true,
        },
        userId: {
          type: 'string',
          required: true,
        },
        courseId: {
          type: 'string',
          required: true,
        },
        moduleId: {
          type: 'string',
          required: true,
        },
        lessonId: {
          type: 'string',
          required: true,
        },
        // What the student submitted: up to five of
        // `{ key, fileName, fileSize, mimeType }`, `key` being the object in
        // the lesson media bucket. Shape validated by core-api's zod schemas.
        files: {
          type: 'any',
          required: true,
        },
        // 'returned' is set when an instructor returns it with a grade and
        // feedback (grading is still to come); a returned submission can't
        // be resubmitted.
        status: {
          type: ['submitted', 'returned'] as const,
          required: true,
          default: 'submitted',
        },
        // When the work was last submitted, and whether that was after the
        // assignment's due date.
        submittedAt: {
          type: 'string',
          required: true,
        },
        late: {
          type: 'boolean',
          required: true,
          default: false,
        },
        // Incremented on every resubmission; its files sit in a folder named
        // for it, so replaced files can be retired without touching these.
        version: {
          type: 'number',
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
        // Every submission for an assignment, for an instructor; a student's
        // own, directly.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId', 'contentItemId'],
          },
          sk: {
            field: 'sk',
            composite: ['userId'],
          },
        },
        // A student's submissions in a course.
        byUser: {
          index: 'gsi2pk-gsi2sk-index',
          pk: {
            field: 'gsi2pk',
            composite: ['userId'],
          },
          sk: {
            field: 'gsi2sk',
            composite: ['courseId', 'contentItemId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
