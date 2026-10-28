/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// Primary key attribute is named `courseId`, not `id`, so it matches the
// composite attribute name Module/Lesson use for their own pk. ElectroDB
// requires an exact attribute-name match (not just an equal rendered value)
// for entities to share a partition in a Service collection (`curriculum`,
// see ../service.ts) - a mismatch here silently splits the Course's own
// item into a different physical partition than its Modules/Lessons.
export const createCourseEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'course',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        title: {
          type: 'string',
          required: true,
        },
        description: {
          type: 'string',
        },
        status: {
          type: ['draft', 'published', 'archived'] as const,
          required: true,
          default: 'draft',
        },
        // The course's display image in the public media bucket (#76), a
        // 16:9 JPEG cropped in the browser. Absent until one's uploaded.
        imageKey: {
          type: 'string',
        },
        // Set when the course is first published and never cleared. A course
        // with this set has been open to students, so archiving and
        // restoring it can't send it back to draft, where deletes are
        // permanent.
        publishedAt: {
          type: 'string',
        },
        // The last `order` handed to one of its modules. Adding or restoring
        // one claims the next in the same transaction, conditioned on this,
        // so two added at once can't share an `order` (#71). Absent until the
        // first is added.
        lastChildOrder: {
          type: 'number',
        },
        createdAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          readOnly: true,
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
        primary: {
          collection: 'curriculum',
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: ['courseId'],
          },
        },
        // List published courses for public discovery. courseId is a UUIDv7,
        // so it's already sortable by creation time without needing a
        // separate timestamp in the sort key.
        byStatus: {
          index: 'gsi1pk-gsi1sk-index',
          pk: {
            field: 'gsi1pk',
            composite: ['status'],
          },
          sk: {
            field: 'gsi1sk',
            composite: ['courseId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
