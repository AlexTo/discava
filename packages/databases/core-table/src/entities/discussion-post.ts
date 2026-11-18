/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A question or a reply in a lesson's discussion. Questions and replies share
// an entity so the staff queues (byUnanswered, byReported) are sparse indexes
// over both. Only `discussionWrites` (../helpers/discussion.ts) writes it, so
// the counters and flags below stay true to the records they summarise.
export const createDiscussionPostEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'discussionPost',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        lessonId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // Carried so a write can check the module without a lookup.
        moduleId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        kind: {
          type: ['question', 'reply'] as const,
          required: true,
          readOnly: true,
        },
        // The question's id; for a question it equals postId.
        threadId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // A UUID v7 minted by the client and validated by the helper.
        postId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The Cognito `sub`; kept after a delete.
        authorId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        authorName: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The badge, as at posting.
        authorIsInstructor: {
          type: 'boolean',
          required: true,
          readOnly: true,
        },
        // Questions only, 1 to 120 characters; removed on delete.
        title: {
          type: 'string',
        },
        // 1 to 4,000 characters of plain text; removed on delete.
        body: {
          type: 'string',
        },
        // `deleted` is final.
        state: {
          type: ['shown', 'hidden', 'deleted'] as const,
          required: true,
          default: 'shown',
        },
        // Questions only: replies with state `shown`, at most 500. Only
        // `discussionWrites` writes this.
        replyCount: {
          type: 'number',
          default: 0,
        },
        // Questions only: shown replies by instructors. Only
        // `discussionWrites` writes this.
        instructorReplyCount: {
          type: 'number',
          default: 0,
        },
        // Upvotes on this post. Only `discussionWrites` writes this.
        voteCount: {
          type: 'number',
          default: 0,
        },
        // Questions only: a shown reply of this question. Only
        // `discussionWrites` writes this.
        acceptedPostId: {
          type: 'string',
        },
        // At most 20 user ids; absent when there are no open reports. Only
        // `discussionWrites` writes this.
        reportedBy: {
          type: 'set',
          items: 'string',
        },
        // Questions only: the courseId, set exactly while the question is
        // shown, has no acceptedPostId and no instructor reply
        // (answeredState); absent otherwise. It puts the question in
        // byUnanswered. It holds the courseId rather than a marker so the
        // index key is built from this attribute alone (see byUnanswered).
        // Only `discussionWrites` writes this.
        unanswered: {
          type: 'string',
        },
        // Set and removed with `unanswered`: the question's createdAt, which
        // orders byUnanswered oldest first.
        unansweredSince: {
          type: 'string',
        },
        // The courseId, set exactly while reportedBy is non-empty; absent
        // otherwise. It puts the post in byReported, as `unanswered` does for
        // byUnanswered. Only `discussionWrites` writes this.
        reported: {
          type: 'string',
        },
        // Set and removed with `reported`: when the post was first reported,
        // which orders byReported oldest first.
        reportedSince: {
          type: 'string',
        },
        // The time part of postId.
        createdAt: {
          type: 'string',
          required: true,
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
        // A lesson's questions (kind first, so replies sort apart), and a
        // thread's replies, oldest first when queried ascending.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: ['kind', 'lessonId', 'threadId', 'postId'],
          },
        },
        // A course's unanswered questions, oldest first. Sparse: only
        // questions with `unanswered` are indexed. Like
        // contentItem.byTranscodePending, each index is built only from
        // attributes that are not part of the primary key (the flag holds the
        // courseId; unansweredSince orders it). ElectroDB re-evaluates an index's
        // `condition` only when an update provides one of its composites, so
        // an update of anything else (a counter, the body, the state) leaves
        // both queues' keys alone. A write that sets `unanswered` sets
        // `unansweredSince` with it; removing both clears the index keys.
        byUnanswered: {
          index: 'gsi2pk-gsi2sk-index',
          condition: (attr) => attr.unanswered !== undefined,
          pk: {
            field: 'gsi2pk',
            composite: ['unanswered'],
            template: '$discussionpost_unanswered#${unanswered}',
          },
          sk: {
            field: 'gsi2sk',
            composite: ['unansweredSince'],
          },
        },
        // A course's reported posts, oldest first. Sparse and built as
        // byUnanswered is, from `reported`.
        byReported: {
          index: 'gsi1pk-gsi1sk-index',
          condition: (attr) => attr.reported !== undefined,
          pk: {
            field: 'gsi1pk',
            composite: ['reported'],
            template: '$discussionpost_reported#${reported}',
          },
          sk: {
            field: 'gsi1sk',
            composite: ['reportedSince'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
