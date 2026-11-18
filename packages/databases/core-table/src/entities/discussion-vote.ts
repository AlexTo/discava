/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// One person's upvote on one discussion post. The key is the rule: one vote
// per person per post. Only `discussionWrites` (../helpers/discussion.ts)
// writes it, together with the post's voteCount.
export const createDiscussionVoteEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'discussionVote',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        // The voter: the caller, never an input.
        userId: {
          type: 'string',
          required: true,
        },
        lessonId: {
          type: 'string',
          required: true,
        },
        threadId: {
          type: 'string',
          required: true,
        },
        postId: {
          type: 'string',
          required: true,
        },
        createdAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          readOnly: true,
        },
      },
      indexes: {
        // A person's votes in a course; one thread's by sk prefix.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId', 'userId'],
          },
          sk: {
            field: 'sk',
            composite: ['lessonId', 'threadId', 'postId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
