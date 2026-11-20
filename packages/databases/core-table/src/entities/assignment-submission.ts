/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A student's work for an upload assignment (#102): one record per student
// and assignment, replaced by each resubmission until an instructor returns
// it with a grade. The assignment is a content item (`type: 'assignment'`) in an assignment
// lesson, so `contentItemId` names it.
export const createAssignmentSubmissionEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'assignmentSubmission',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        contentItemId: {
          type: 'string',
          required: true,
        },
        userId: {
          type: 'string',
          required: true,
        },
        courseId: {
          type: 'string',
          required: true,
        },
        moduleId: {
          type: 'string',
          required: true,
        },
        lessonId: {
          type: 'string',
          required: true,
        },
        // What the student submitted: exactly one file, `key` being its
        // object in the lesson media bucket, in a folder named for the submit
        // request that stored it. A resubmission replaces it whole.
        file: {
          type: 'map',
          required: true,
          properties: {
            key: { type: 'string', required: true },
            fileName: { type: 'string', required: true },
            fileSize: { type: 'number', required: true },
            mimeType: { type: 'string', required: true },
          },
        },
        // 'resubmission_requested' is set when an instructor asks for new
        // work (the student may resubmit); 'returned' when an instructor
        // returns it with a grade, after which it can't be resubmitted.
        status: {
          type: ['submitted', 'resubmission_requested', 'returned'] as const,
          required: true,
          default: 'submitted',
        },
        // +1 on every instructor action (return, request, amend): the
        // concurrency token for instructor writes.
        reviewRevision: {
          type: 'number',
          required: true,
          default: 0,
        },
        // The grade, set on the final return and on an amendment. `pointsOutOf`
        // is the assignment's maxPoints when graded, kept if it changes later.
        points: { type: 'number' },
        pointsOutOf: { type: 'number' },
        // The first final return; an amendment leaves both.
        returnedAt: { type: 'string' },
        returnedBy: { type: 'string' },
        // The latest return or amendment.
        gradedAt: { type: 'string' },
        // Both set, to the courseId and submittedAt, while the status is
        // 'submitted' (waiting for an instructor), and removed together
        // otherwise; they build the byWaiting index.
        waitingCourseId: { type: 'string' },
        waitingSince: { type: 'string' },
        // When the work was last submitted, and whether that was after the
        // assignment's due date.
        submittedAt: {
          type: 'string',
          required: true,
        },
        late: {
          type: 'boolean',
          required: true,
          default: false,
        },
        // 1 on the first submission, incremented on every resubmission. It
        // isn't in the file's folder name (that names the request), so it
        // only tells a racing resubmission that the record moved.
        version: {
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
        // Every submission for an assignment, for an instructor; a student's
        // own, directly.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId', 'contentItemId'],
          },
          sk: {
            field: 'sk',
            composite: ['userId'],
          },
        },
        // A student's submissions in a course.
        byUser: {
          index: 'gsi2pk-gsi2sk-index',
          pk: {
            field: 'gsi2pk',
            composite: ['userId'],
          },
          sk: {
            field: 'gsi2sk',
            composite: ['courseId', 'contentItemId'],
          },
        },
        // A course's work waiting for an instructor, oldest first. Sparse:
        // only submissions with both waiting attributes are indexed. Built
        // as discussionPost.byUnanswered is, from attributes outside the
        // primary key (waitingCourseId holds the courseId; waitingSince
        // orders it). ElectroDB re-evaluates an index's `condition` only
        // when an update provides one of its composites, so a patch of
        // anything else leaves the keys alone. A write that changes `status`
        // sets or removes both attributes with it (waitingKeys).
        byWaiting: {
          index: 'gsi1pk-gsi1sk-index',
          condition: (attr) =>
            attr.waitingCourseId !== undefined &&
            attr.waitingSince !== undefined,
          pk: {
            field: 'gsi1pk',
            composite: ['waitingCourseId'],
            template: '$assignmentsubmission_waiting#${waitingCourseId}',
          },
          sk: {
            field: 'gsi1sk',
            composite: ['waitingSince', 'contentItemId', 'userId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
