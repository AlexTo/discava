/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A learner's recorded answers to one video's questions. Written only by
// videoAnswerWrites (helpers/video-question.ts). An entry is added once and
// never changed or removed, and every write is conditioned on the
// `answerCount` it read, so two tabs answering at once can't both land. The
// first record on a video also counts the learner in its
// `studentActivityCount`, in the same transaction.
export const createVideoAnswerSheetEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'videoAnswerSheet',
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
        contentItemId: {
          type: 'string',
          required: true,
        },
        // Not part of the key; kept so a record can be traced back to its
        // place in the curriculum without a scan.
        moduleId: {
          type: 'string',
          required: true,
        },
        lessonId: {
          type: 'string',
          required: true,
        },
        // { [questionId]: { optionIds, correct, answeredAt, quizVersion } }
        answers: {
          type: 'any',
          required: true,
        },
        // The number of entries in `answers`.
        answerCount: {
          type: 'number',
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
        primary: {
          pk: {
            field: 'pk',
            composite: ['userId'],
          },
          sk: {
            field: 'sk',
            composite: ['courseId', 'contentItemId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
