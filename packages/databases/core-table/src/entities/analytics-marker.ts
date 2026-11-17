/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// Records that a stream event, or a learner's activity in a day or week, has
// been counted, so the analytics handler applies each once however often the
// stream delivers it. `markerId` is `EVENT#<eventID>` or
// `MEMBER#<period>#<userId>`. Expired by DynamoDB TTL once redelivery of
// what it guards can no longer happen; see helpers/analytics-writes.ts.
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
        // Epoch seconds, read by the table's TTL.
        ttl: {
          type: 'number',
          required: true,
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
