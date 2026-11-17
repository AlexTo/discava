/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// How many students are partway through or have completed a lesson.
export const createLessonStatsEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'lessonStats',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        lessonId: {
          type: 'string',
          required: true,
        },
        inProgress: {
          type: 'number',
          default: 0,
        },
        completed: {
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
            composite: ['lessonId'],
            template: 'LESSON#${lessonId}',
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
