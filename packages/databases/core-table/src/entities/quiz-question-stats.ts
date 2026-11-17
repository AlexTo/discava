/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// Attempts at a quiz question and how many got it wrong.
export const createQuizQuestionStatsEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'quizQuestionStats',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        contentItemId: {
          type: 'string',
          required: true,
        },
        questionId: {
          type: 'string',
          required: true,
        },
        attempts: {
          type: 'number',
          default: 0,
        },
        misses: {
          type: 'number',
          default: 0,
        },
      },
      indexes: {
        // Every aggregate of a course shares this pk, so one range query
        // reads a kind of them; `sk` tells the kinds apart.
        primary: {
          collection: 'analytics',
          pk: {
            field: 'pk',
            composite: ['courseId'],
            template: 'ANALYTICS#${courseId}',
          },
          sk: {
            field: 'sk',
            composite: ['contentItemId', 'questionId'],
            template: 'QUIZ#${contentItemId}#Q#${questionId}',
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
