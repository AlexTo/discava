/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A course's counts for one UTC day (`DAY#yyyy-mm-dd`) or ISO week
// (`WEEK#yyyy-Www`): enrolments (days only) and the distinct learners active.
export const createPeriodStatsEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'periodStats',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        period: {
          type: ['day', 'week'] as const,
          required: true,
        },
        // The period's key part: `DAY#<yyyy-mm-dd>` or `WEEK#<yyyy>-W<ww>`.
        periodKey: {
          type: 'string',
          required: true,
        },
        enrolments: {
          type: 'number',
          default: 0,
        },
        activeLearners: {
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
            composite: ['periodKey'],
            template: '${periodKey}',
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
