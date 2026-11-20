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
        // What was assessed when the criteria were met, written once at
        // issue. `assessedItems` is internal: no API returns it.
        assessment: {
          type: 'map',
          required: true,
          readOnly: true,
          properties: {
            criteriaVersion: { type: 'number', required: true },
            requireQuizPass: { type: 'boolean', required: true },
            minUploadScorePercent: { type: 'number' },
            itemCount: { type: 'number', required: true },
            assessedItemCount: { type: 'number', required: true },
            assessedItems: {
              type: 'list',
              required: true,
              items: {
                type: 'map',
                properties: {
                  contentItemId: { type: 'string', required: true },
                  kind: { type: ['quiz', 'upload'] as const, required: true },
                  scorePercent: { type: 'number', required: true },
                  passMarkPercent: { type: 'number' },
                },
              },
            },
            passMarkLowest: { type: 'number' },
            passMarkHighest: { type: 'number' },
            scoreBand: { type: 'number' },
            courseHours: { type: 'number' },
          },
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
        // The reminder's schedule exists (markCertificateReminderScheduled),
        // and the reminder was claimed for sending (claimCertificateReminder).
        reminderScheduledAt: {
          type: 'string',
        },
        reminderSentAt: {
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
        // A course's certificates, newest first. Shares gsi2 with other
        // entities; the entity's own key prefix keeps their records apart.
        byCourse: {
          index: 'gsi2pk-gsi2sk-index',
          pk: {
            field: 'gsi2pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'gsi2sk',
            composite: ['issuedAt', 'userId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
