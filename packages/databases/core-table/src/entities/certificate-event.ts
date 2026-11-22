/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// One revocation or restoration of a certificate. Only ever created, in the
// transaction that changes the certificate, by revokeCertificate and
// restoreCertificate in ../helpers/certificate.ts.
export const createCertificateEventEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'certificateEvent',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // The certificate's key.
        userId: {
          type: 'string',
          required: true,
        },
        courseId: {
          type: 'string',
          required: true,
        },
        // For a `revoked` event, the certificate's `revokedAt`.
        occurredAt: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // For reading logs without a join.
        certificateId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        type: {
          type: ['revoked', 'restored'] as const,
          required: true,
          readOnly: true,
        },
        // Required for a `revoked` event.
        reason: {
          type: [
            'academic-integrity',
            'issued-in-error',
            'other',
            'refunded',
          ] as const,
          readOnly: true,
        },
        // At most 500 characters; required when the reason is `other`.
        // Private: no learner-facing surface returns it.
        note: {
          type: 'string',
          readOnly: true,
        },
        // The actor's Cognito `sub`.
        actorId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        actorRole: {
          type: ['instructor', 'admin'] as const,
          required: true,
          readOnly: true,
        },
      },
      indexes: {
        // One certificate's history, oldest first.
        primary: {
          pk: {
            field: 'pk',
            composite: ['userId'],
          },
          sk: {
            field: 'sk',
            composite: ['courseId', 'occurredAt'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
