/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// How many visible reviews a course has at each rating. An absent counter
// reads as 0: the first write adds to one counter only, so read through
// starCounts (helpers/review-rating.ts). Changed only by reviewWrites
// (helpers/review.ts), in the same transaction as the review.
export const createCourseRatingEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'courseRating',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        stars1: { type: 'number' },
        stars2: { type: 'number' },
        stars3: { type: 'number' },
        stars4: { type: 'number' },
        stars5: { type: 'number' },
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
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: [],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
