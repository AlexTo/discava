/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// Shares its pk with Course and Lesson (COURSE#<courseId>) via the
// `curriculum` collection (../service.ts), so a course's full curriculum
// can be read with a single query through the Service instead of one query
// per entity.
export const createModuleEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'module',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        moduleId: {
          type: 'string',
          required: true,
        },
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
        // Sequencing within the course. Not part of any key: module counts
        // per course are small enough to sort client-side after fetch.
        order: {
          type: 'number',
          required: true,
        },
        // Whether students can see this record. No default: create
        // procedures choose it from the course's status (visible in a draft
        // course, hidden until explicitly published otherwise). Students only
        // see a record that is *effectively* visible: it and every ancestor
        // visible and not archived (see ../helpers/curriculum.ts).
        visibility: {
          type: ['hidden', 'visible'] as const,
          required: true,
        },
        // Soft delete for courses that aren't drafts. Set only on the
        // archived record itself; its descendants are hidden by being under
        // an archived ancestor, not by being archived themselves, so a
        // restore brings back exactly what was there.
        archivedAt: {
          type: 'string',
        },
        // When the record first became visible; never cleared. A publish of
        // its parent publishes only hidden descendants without one -- content
        // that's new -- so one hidden on purpose after it was visible stays
        // hidden.
        publishedAt: {
          type: 'string',
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
            composite: ['moduleId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
