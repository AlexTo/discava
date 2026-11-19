/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';
import { LANGUAGES, LEVELS } from '../helpers/catalogue.js';

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
        // Whether finishing the course earns a certificate. Required, set to
        // true on creation; nothing reads a missing value as on.
        certificatesEnabled: {
          type: 'boolean',
          required: true,
        },
        // How the catalogue files and filters the course. All optional: a
        // course without them is simply under no facet value. Written only by
        // courseCatalogueWrites, which normalises and validates them.
        categoryId: {
          type: 'string',
        },
        tags: {
          type: 'list',
          items: { type: 'string' },
        },
        level: {
          type: LEVELS,
        },
        language: {
          type: LANGUAGES,
        },
        durationHours: {
          type: 'number',
        },
        // What a learner will be able to do, and what they need first, shown
        // on the public landing page. Optional lists of up to 10 short items.
        // Written only by courseLandingWrites, which normalises them.
        learningOutcomes: {
          type: 'list',
          items: { type: 'string' },
        },
        requirements: {
          type: 'list',
          items: { type: 'string' },
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
          // A writer may pass the instant itself, so it can copy the same
          // value to the course's instructors in one transaction
          // (courseLandingWrites); any other write stamps the time.
          set: (value?: string) => value ?? new Date().toISOString(),
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
