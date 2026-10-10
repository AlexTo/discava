/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A student's standing on one quiz, written in the same transaction as each
// of their attempts. Created by the first attempt, in the same transaction
// that increments the quiz's `studentActivityCount`, so each student is
// counted once per quiz. Each later attempt is conditioned on the
// `attemptsUsed` it read, so the attempt limit holds when submissions race.
export const createQuizSummaryEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'quizSummary',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        userId: {
          type: 'string',
          required: true,
        },
        courseId: {
          type: 'string',
          required: true,
        },
        contentItemId: {
          type: 'string',
          required: true,
        },
        // Not part of the key; kept so a record can be traced back to its
        // place in the curriculum without a scan.
        moduleId: {
          type: 'string',
          required: true,
        },
        lessonId: {
          type: 'string',
          required: true,
        },
        attemptsUsed: {
          type: 'number',
          required: true,
        },
        // Only ever increases: retaking never makes a student worse off.
        bestScore: {
          type: 'number',
          required: true,
        },
        bestAttemptId: {
          type: 'string',
          required: true,
        },
        // Set by the first passing attempt and never cleared, even if the
        // pass mark is raised or the quiz is edited later.
        passedAt: {
          type: 'string',
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
            composite: ['userId'],
          },
          sk: {
            field: 'sk',
            composite: ['courseId', 'contentItemId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
