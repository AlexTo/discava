/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// Shares its pk with Course, Module, and Lesson (COURSE#<courseId>) via the
// `curriculum` collection (../service.ts); sk is prefixed with the parent
// module and lesson ids so a lesson's content items are a contiguous range.
export const createContentItemEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'contentItem',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        contentItemId: {
          type: 'string',
          required: true,
        },
        lessonId: {
          type: 'string',
          required: true,
        },
        moduleId: {
          type: 'string',
          required: true,
        },
        courseId: {
          type: 'string',
          required: true,
        },
        // 'video', 'text' and 'quiz' today; leaves room for sibling content
        // types (file) from #102. Per-type required-ness (e.g. a video
        // needs s3Key/mimeType, a text item needs body) is enforced by the
        // zod schemas in instructor-api/core-api, not here -- ElectroDB has
        // no native discriminated-attribute support for a single entity.
        type: {
          type: ['video', 'text', 'quiz'] as const,
          required: true,
        },
        // 'ready' by default so synchronous types (text, and any future
        // non-video type from #102) need no code changes -- only video's
        // create path (async, transcoded by MediaConvert) overrides this to
        // 'pending'.
        status: {
          type: ['pending', 'ready', 'failed'] as const,
          required: true,
          default: 'ready',
        },
        title: {
          type: 'string',
          required: true,
        },
        description: {
          type: 'string',
        },
        s3Key: {
          type: 'string',
        },
        mimeType: {
          type: 'string',
        },
        durationSeconds: {
          type: 'number',
        },
        // Set right after submitTranscodeJob's CreateJobCommand returns, so
        // transcode-complete.ts can reject a stale completion event from a
        // job that's since been superseded by a replacement upload (see
        // issue #123) -- never exposed in any API output schema.
        mediaConvertJobId: {
          type: 'string',
        },
        // The raw upload's S3 ETag at submission time, set alongside
        // mediaConvertJobId. Lets updateContentItemVideo tell a genuine
        // replacement apart from a caller retrying the exact same mutation
        // (e.g. after a client-side timeout) while a job is still pending
        // -- objectKey alone can't do that, since it's deterministic from
        // contentItemId + extension.
        rawObjectETag: {
          type: 'string',
        },
        // A random value minted for a genuinely new video submission
        // (create, or a replace that isn't resuming one already in
        // flight), and reused by a retry that finds this exact target
        // still pending with no job id recorded yet (the record's own
        // status/s3Key already prove it's the same interrupted attempt).
        // Feeds submitTranscodeJob's ClientRequestToken instead of the
        // raw upload's content -- unlike content, it can never coincide
        // with an unrelated past submission. Never exposed in any API
        // output schema.
        submissionNonce: {
          type: 'string',
        },
        // Tiptap's JSON document, stored as a string. Only present for
        // type: 'text'.
        body: {
          type: 'string',
        },
        // Quiz-only attributes (type: 'quiz'). `questions` is safe to show
        // students; `answerKey` is held apart from it so passing a content
        // item through to students can't leak the answers. Shapes are
        // validated by instructor-api's zod schemas (schema/quiz.ts).
        questions: {
          type: 'any',
        },
        answerKey: {
          type: 'any',
        },
        settings: {
          type: 'any',
        },
        // Incremented on every save.
        quizVersion: {
          type: 'number',
        },
        // Hash of `questions` only, recomputed on every save; a student's
        // submission carries the hash of the questions it showed.
        questionsHash: {
          type: 'string',
        },
        // Sequencing within the lesson. Not part of any key: content item
        // counts per lesson are small enough to sort client-side after fetch.
        order: {
          type: 'number',
          required: true,
        },
        // Whether students can see this record. No default: create
        // procedures choose it from the course's status (visible in a draft
        // course, hidden until explicitly published otherwise). Students only
        // see a record that is *effectively* visible: it and every ancestor
        // visible and not archived (see ../curriculum.ts).
        visibility: {
          type: ['hidden', 'visible'] as const,
          required: true,
        },
        // Soft delete for courses that aren't drafts. Set only on the
        // archived record itself; its descendants are hidden by being under
        // an archived ancestor, not by being archived themselves, so a
        // restore brings back exactly what was there.
        archivedAt: {
          type: 'string',
        },
        // Distinct students with any data for this item. Incremented in the
        // same transaction that creates a student's first record for it, and
        // never decremented, so a non-zero count means permanently deleting
        // the item would destroy student data.
        studentActivityCount: {
          type: 'number',
          required: true,
          default: 0,
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
          collection: 'curriculum',
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: ['moduleId', 'lessonId', 'contentItemId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
