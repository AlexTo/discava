/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A quiz's score distribution: band0 holds the students whose best score is
// 0-9, band1 10-19, and so on to band9 for 90-100.
export const createQuizScoreStatsEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'quizScoreStats',
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
        band0: {
          type: 'number',
          default: 0,
        },
        band1: {
          type: 'number',
          default: 0,
        },
        band2: {
          type: 'number',
          default: 0,
        },
        band3: {
          type: 'number',
          default: 0,
        },
        band4: {
          type: 'number',
          default: 0,
        },
        band5: {
          type: 'number',
          default: 0,
        },
        band6: {
          type: 'number',
          default: 0,
        },
        band7: {
          type: 'number',
          default: 0,
        },
        band8: {
          type: 'number',
          default: 0,
        },
        band9: {
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
            composite: ['contentItemId'],
            template: 'QUIZ#${contentItemId}#SCORES',
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
