/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

export const REVIEW_TEXT_MAX = 2000;
export const REVIEW_REMOVED_REASON_MAX = 200;
export const REVIEW_RESPONSE_MAX = 1000;

const isRating = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= 5;

// A student's rating, and optionally a written review, of a course: one per
// student and course. Written only by reviewWrites (helpers/review.ts), in the
// same transaction as the course's courseRating tally.
export const createReviewEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'review',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        // The student (Cognito `sub`); never returned by public procedures.
        userId: {
          type: 'string',
          required: true,
        },
        // An integer 1 to 5; changed by edits.
        rating: {
          type: 'number',
          required: true,
          validate: (value?: number) => value === undefined || isRating(value),
        },
        // At most 2,000 characters after trimming; absent for a rating-only
        // review.
        text: {
          type: 'string',
          validate: (value?: string) =>
            value === undefined || value.length <= REVIEW_TEXT_MAX,
        },
        // "Alex T." or "Discava learner", a snapshot taken at posting.
        reviewerName: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        status: {
          type: ['visible', 'removed'] as const,
          required: true,
          default: 'visible',
        },
        // +1 on every edit by the student.
        version: {
          type: 'number',
          required: true,
          default: 1,
        },
        createdAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          readOnly: true,
        },
        editedAt: {
          type: 'string',
        },
        // Set together, and only with status 'removed'.
        removedAt: {
          type: 'string',
        },
        removedBy: {
          type: 'string',
        },
        removedReason: {
          type: 'string',
          validate: (value?: string) =>
            value === undefined || value.length <= REVIEW_REMOVED_REASON_MAX,
        },
        // An instructor's response: the four are set and cleared together.
        responseText: {
          type: 'string',
          validate: (value?: string) =>
            value === undefined ||
            (value.length >= 1 && value.length <= REVIEW_RESPONSE_MAX),
        },
        responseAt: {
          type: 'string',
        },
        responseById: {
          type: 'string',
        },
        responseByName: {
          type: 'string',
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
        // A student's review of a course.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: ['userId'],
          },
        },
        // A course's reviews, newest first.
        byCourse: {
          index: 'gsi2pk-gsi2sk-index',
          pk: {
            field: 'gsi2pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'gsi2sk',
            composite: ['createdAt', 'userId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
