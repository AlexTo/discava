/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A course's all-time counts for the instructor dashboard. Counters are
// changed only with `add`, by the analytics handler and the rebuild, from
// the stream's changes to enrolments; see helpers/analytics-contributions.ts.
export const createCourseStatsEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'courseStats',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        enrolments: {
          type: 'number',
          default: 0,
        },
        completed: {
          type: 'number',
          default: 0,
        },
        dropped: {
          type: 'number',
          default: 0,
        },
        updatedAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          set: () => new Date().toISOString(),
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
            composite: [],
            template: 'SUMMARY',
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
