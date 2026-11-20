/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// The "instructors were told about new submissions to this assignment today"
// marker (#102). A submission's transaction creates it with
// `attribute_not_exists`, so only the day's first submission notifies. It
// holds no rule beyond its key; the table's TTL removes it two days after
// `day`.
export const createSubmissionNoticeEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'submissionNotice',
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
        // The UTC day, YYYY-MM-DD.
        day: {
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
            composite: ['courseId', 'contentItemId'],
          },
          sk: {
            field: 'sk',
            composite: ['day'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
