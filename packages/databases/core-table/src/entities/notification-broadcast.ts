/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CustomAttributeType, Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A request to notify every student enrolled in a course. `id` is the first
// 16 hex characters of sha256(type + "\0" + courseId + "\0" + dedupeKey), so
// publishing the same event twice is one request. The delivery handler fans
// it out from `cursor` and sets `status` to 'done' when the last page is
// published.
export const createNotificationBroadcastEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'notificationBroadcast',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        id: {
          type: 'string',
          required: true,
        },
        type: {
          type: 'string',
          required: true,
        },
        courseId: {
          type: 'string',
          required: true,
        },
        // Flat string params, validated against the type when written.
        params: {
          type: CustomAttributeType<Record<string, string>>('any'),
          required: true,
        },
        // From the producer; every student's notification uses it.
        occurredAt: {
          type: 'string',
          required: true,
        },
        // The producer's key; each student's notification derives its own
        // from the type and this.
        dedupeKey: {
          type: 'string',
          required: true,
        },
        // The last enrolment page's LastEvaluatedKey as JSON; absent before
        // the first page.
        cursor: {
          type: 'string',
        },
        status: {
          type: ['pending', 'done'] as const,
          required: true,
          default: 'pending',
        },
        completedAt: {
          type: 'string',
        },
        createdAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          readOnly: true,
        },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            composite: ['id'],
          },
          sk: {
            field: 'sk',
            composite: ['id'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
