/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// An instructor's announcement to a course's students. Written only by the
// helpers in helpers/announcement.ts, which keep its notification request
// and its checks with it. Shares its pk with the course's other records but
// is not part of the `curriculum` collection, as no access pattern reads it
// beside them.
export const createAnnouncementEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'announcement',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        // A UUID v7 minted by the client and validated by the server, so a
        // retried post is the same record. It sorts by creation time.
        announcementId: {
          type: 'string',
          required: true,
        },
        // 1 to 120 characters after trimming (checked by the helpers).
        title: {
          type: 'string',
          required: true,
        },
        // A Tiptap document as a JSON string, at most 20,000 characters.
        body: {
          type: 'string',
          required: true,
        },
        // The instructor who created it (Cognito `sub`); never changes.
        authorId: {
          type: 'string',
          required: true,
        },
        // The id's time part, not the clock of the write.
        createdAt: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // Set by every edit; absent until the first.
        editedAt: {
          type: 'string',
        },
        // 1, then +1 on every edit; an edit only replaces the version it read.
        version: {
          type: 'number',
          required: true,
          default: 1,
        },
        updatedAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          watch: '*',
          set: () => new Date().toISOString(),
        },
      },
      indexes: {
        // A course's announcements, newest first when queried descending.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: ['announcementId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
