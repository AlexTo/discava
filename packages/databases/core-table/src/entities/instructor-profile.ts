/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
export const HANDLE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const DISPLAY_NAME_MAX = 60;
export const HEADLINE_MAX = 100;
export const BIO_MAX = 2000;

export const isValidHandle = (value: string) =>
  value.length >= HANDLE_MIN &&
  value.length <= HANDLE_MAX &&
  HANDLE_PATTERN.test(value);

// An instructor's public profile: one per instructor, created with their first
// course and keyed by their Cognito `sub`. Its handle is unique through a
// profileHandleClaim. Shown publicly only while the instructor teaches a
// published course. Written only by instructorProfileWrites
// (helpers/instructor-profile.ts).
export const createInstructorProfileEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'instructorProfile',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // Cognito `sub`; never returned by public procedures.
        instructorId: {
          type: 'string',
          required: true,
        },
        handle: {
          type: 'string',
          required: true,
          validate: (value: string) => isValidHandle(value),
        },
        displayName: {
          type: 'string',
          required: true,
          validate: (value: string) =>
            value.length >= 1 && value.length <= DISPLAY_NAME_MAX,
        },
        headline: {
          type: 'string',
          validate: (value?: string) =>
            value === undefined || value.length <= HEADLINE_MAX,
        },
        // Plain text; a blank line separates paragraphs.
        bio: {
          type: 'string',
          validate: (value?: string) =>
            value === undefined || value.length <= BIO_MAX,
        },
        // Public media key `instructors/<instructorId>/<uuid>.jpg`.
        photoKey: {
          type: 'string',
        },
        // +1 on every edit; edits are conditioned on it.
        version: {
          type: 'number',
          required: true,
          default: 1,
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
          pk: {
            field: 'pk',
            composite: ['instructorId'],
          },
          sk: {
            field: 'sk',
            composite: ['instructorId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
