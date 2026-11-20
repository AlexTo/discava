/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// One instructor action on one version of a student's submission (#102): a
// request to resubmit, a return with a grade, or an amendment of the grade.
// Rounds are append-only: nothing edits or deletes one. Written only by the
// helpers in helpers/assignment-grading.ts, in the transaction that changes
// the submission.
export const createSubmissionFeedbackEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'submissionFeedback',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // The submission the round belongs to.
        courseId: {
          type: 'string',
          required: true,
        },
        contentItemId: {
          type: 'string',
          required: true,
        },
        userId: {
          type: 'string',
          required: true,
        },
        // A UUID v7, unique per round and sortable by time.
        feedbackId: {
          type: 'string',
          required: true,
        },
        kind: {
          type: ['resubmission_requested', 'returned', 'amended'] as const,
          required: true,
        },
        // A Tiptap document as a JSON string, at most 20,000 characters;
        // non-empty for a resubmission request.
        feedback: {
          type: 'string',
        },
        // Present for 'returned' and 'amended', absent for a request.
        points: { type: 'number' },
        pointsOutOf: { type: 'number' },
        // The submission version the round was about.
        version: {
          type: 'number',
          required: true,
        },
        givenAt: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The instructor (Cognito `sub`).
        givenBy: {
          type: 'string',
          required: true,
          readOnly: true,
        },
      },
      indexes: {
        // One submission's rounds, oldest first; newest first when queried
        // descending.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId', 'contentItemId', 'userId'],
          },
          sk: {
            field: 'sk',
            composite: ['givenAt', 'feedbackId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
