/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// Records that a stream event, or a learner's activity in a day or week, has
// been counted, so the analytics handler applies each once however often the
// stream delivers it. `markerId` is `EVENT#<eventID>`,
// `MEMBER#<period>#<userId>` (both expired by DynamoDB TTL once redelivery of
// what they guard can no longer happen; see helpers/analytics-writes.ts) or
// `FUNNEL#<userId>#<lessonId>`, which has no `ttl` and holds in `status` what
// the student's lesson currently counts as in `lessonStats`.
export const createAnalyticsMarkerEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'analyticsMarker',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        markerId: {
          type: 'string',
          required: true,
        },
        // Epoch seconds, read by the table's TTL. Required on `EVENT#` and
        // `MEMBER#` markers, absent on `FUNNEL#` ones.
        ttl: {
          type: 'number',
        },
        // `FUNNEL#` markers only.
        status: {
          type: ['inProgress', 'completed'] as const,
        },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId'],
            template: 'ANALYTICSMARK#${courseId}',
          },
          sk: {
            field: 'sk',
            composite: ['markerId'],
            template: '${markerId}',
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
