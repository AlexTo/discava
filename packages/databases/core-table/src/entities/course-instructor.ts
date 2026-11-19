/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// Join entity: a course may be taught by more than one instructor, and an
// instructor may teach more than one course. Modeled the same way as
// Enrolment (student<->course), just for the teaching staff instead of the
// roster.
export const createCourseInstructorEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'courseInstructor',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
        },
        instructorId: {
          type: 'string',
          required: true,
        },
        // Denormalized from Course.updatedAt so byInstructor can list an
        // instructor's courses sorted by recency without an extra fetch per
        // page. Every writer of Course copies it here (checked by
        // checkInstructorCourseUpdatedAt).
        courseUpdatedAt: {
          type: 'string',
          required: true,
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
        // List instructors teaching a course. Shares its pk with Course/
        // Module/Lesson (COURSE#<courseId>) at the raw table level, but is
        // intentionally not part of the `curriculum` Service collection
        // since no access pattern needs instructors fetched alongside them.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: ['instructorId'],
          },
        },
        // List courses an instructor teaches, sorted by recency (courseId
        // as a tiebreaker also handles same-instant timestamps, and is
        // itself creation-ordered since it's a UUIDv7).
        byInstructor: {
          index: 'gsi1pk-gsi1sk-index',
          pk: {
            field: 'gsi1pk',
            composite: ['instructorId'],
          },
          sk: {
            field: 'gsi1sk',
            composite: ['courseUpdatedAt', 'courseId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
