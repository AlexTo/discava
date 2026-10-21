/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

export const createEnrolmentEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'enrolment',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        userId: {
          type: 'string',
          required: true,
        },
        status: {
          type: ['active', 'completed', 'dropped'] as const,
          required: true,
          default: 'active',
        },
        // Denormalized so a student's course list can render progress
        // without a second read. Written only by the progress
        // recalculation, from the course's effectively visible items.
        progressPercent: {
          type: 'number',
          default: 0,
        },
        // When the student first completed every effectively visible item,
        // set with status 'completed'. Like the status, never cleared.
        completedAt: {
          type: 'string',
        },
        // When the student last did something in the course: completed an
        // item or submitted a quiz attempt. Orders "Continue where you left
        // off"; absent until their first activity. Written by core-api in the
        // same transaction as the activity.
        lastActivityAt: {
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
        // List students enrolled in a course. Shares its pk with Course/
        // Module/Lesson (COURSE#<courseId>) at the raw table level, but is
        // intentionally not part of the `curriculum` Service collection
        // since no access pattern needs enrolments fetched alongside them.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: ['userId'],
          },
        },
        // List courses a student is enrolled in.
        byUser: {
          index: 'gsi1pk-gsi1sk-index',
          pk: {
            field: 'gsi1pk',
            composite: ['userId'],
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
