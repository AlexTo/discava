/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// One submitted attempt at a quiz, written by core-api's quiz.submitAttempt in
// the same transaction as the student's quiz summary. Keyed by user so "a
// student's attempts at a quiz" is a single query; attemptIds are UUIDv7, so
// they sort in submission order. Never updated after it's written: past
// attempts aren't regraded.
export const createQuizAttemptEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'quizAttempt',
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
        attemptId: {
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
        // { [questionId]: optionId[] }, as submitted.
        answers: {
          type: 'any',
          required: true,
        },
        // The questions graded correct against the key at the time. Kept
        // because the key can change after the attempt.
        correctQuestionIds: {
          type: 'list',
          items: { type: 'string' },
          required: true,
        },
        // Whole percent, rounded down, so it never shows more than was
        // scored and `passed` is exactly scorePercent >= passMarkPercent.
        scorePercent: {
          type: 'number',
          required: true,
        },
        passed: {
          type: 'boolean',
          required: true,
        },
        // The quiz as it was graded.
        quizVersion: {
          type: 'number',
          required: true,
        },
        questionsHash: {
          type: 'string',
          required: true,
        },
        submittedAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          readOnly: true,
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
            composite: ['courseId', 'contentItemId', 'attemptId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
