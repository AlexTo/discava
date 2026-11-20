/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A student's proof that they completed a course. Written only by the
// functions in ../helpers/certificate.ts. Everything printed on it is
// copied at issue time, so later renames of the course or the student don't
// change it.
export const createCertificateEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'certificate',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        userId: {
          type: 'string',
          required: true,
        },
        courseId: {
          type: 'string',
          required: true,
        },
        // 16 Crockford base32 characters, no dashes stored.
        certificateId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        learnerName: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        courseTitle: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        completedAt: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        issuedAt: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The first use of "Add to LinkedIn profile", set once by
        // recordLinkedInClick.
        linkedInClickedAt: {
          type: 'string',
        },
        linkedInClickSource: {
          type: [
            'my-learning',
            'certificate-page',
            'issued-email',
            'reminder-email',
          ] as const,
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
        // One student's certificates, and one for a course.
        primary: {
          pk: {
            field: 'pk',
            composite: ['userId'],
          },
          sk: {
            field: 'sk',
            composite: ['courseId'],
          },
        },
        // Public verification by ID. Shares gsi1 with other entities, so the
        // constant sort key and the entity's own key prefix keep a
        // certificate-ID query from ever returning an enrolment.
        byCertificateId: {
          index: 'gsi1pk-gsi1sk-index',
          pk: {
            field: 'gsi1pk',
            composite: ['certificateId'],
          },
          sk: {
            field: 'gsi1sk',
            composite: [],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
