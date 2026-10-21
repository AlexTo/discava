/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getCloudFrontVideoUrl,
  getSignedCloudFrontCookies,
} from '@discava/common-server-utils/lesson-media';
import { isConditionalCheckFailed } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  getCourseOrThrow,
  initialVisibilityFields,
  requireAncestorsNotArchived,
  requireNotArchived,
  writeUnderActiveAncestors,
} from '../lib/course-lifecycle.js';
import {
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
  submitTranscodeJob,
} from '../lib/mediaconvert-client.js';
import {
  bestEffortDeleteContentItemVideos,
  getS3Client,
  getVideoUploadETag,
  resolveLessonMediaUploadBucketName,
} from '../lib/s3-client.js';
import {
  CreateContentItemVideoInputSchema,
  CreateContentItemVideoOutputSchema,
  CreateContentItemVideoUploadUrlInputSchema,
  CreateContentItemVideoUploadUrlOutputSchema,
  CreateContentItemVideoUrlInputSchema,
  CreateContentItemVideoUrlOutputSchema,
  type ICreateContentItemVideoOutput,
  type IUpdateContentItemVideoOutput,
  UpdateContentItemVideoInputSchema,
  UpdateContentItemVideoOutputSchema,
} from '../schema/index.js';
import { asContentItemOutput } from './content-item-shared.js';

// Extension -> content type allowlist for lesson videos. Anything else is
// rejected with BAD_REQUEST before a presigned URL is ever issued.
const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;

export const createContentItemVideoUploadUrl = courseProcedure
  .input(CreateContentItemVideoUploadUrlInputSchema)
  .output(CreateContentItemVideoUploadUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, fileName } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may attach video to
    // its lessons, not just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: lesson } = await coreTable.entities.lesson
      .get({ courseId, moduleId, lessonId })
      .go();
    if (!lesson) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    // Refused before minting a URL, so nothing gets uploaded only for
    // createContentItemVideo/updateContentItemVideo to reject it.
    requireNotArchived(
      lesson,
      'Restore the lesson before adding content to it',
    );
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });

    const ext = extname(fileName).slice(1).toLowerCase();
    const contentType = ALLOWED_VIDEO_TYPES[ext];
    if (!contentType) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported video file type. Allowed types: ${Object.keys(ALLOWED_VIDEO_TYPES).join(', ')}`,
      });
    }

    // When replacing an existing video, reuse its id in the object key
    // instead of minting a fresh one, so the key's id segment always
    // matches a real content item -- createContentItemVideo/
    // updateContentItemVideo validate the key against the ids they
    // already have from context, rather than trusting anything parsed
    // back out of it.
    if (input.contentItemId !== undefined) {
      const { data: existing } = await coreTable.entities.contentItem
        .get({
          courseId,
          moduleId,
          lessonId,
          contentItemId: input.contentItemId,
        })
        .go();
      if (!existing || existing.type !== 'video') {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      requireNotArchived(
        existing,
        'Restore the content item before editing it',
      );
    }

    const contentItemId = input.contentItemId ?? uuidv7();
    // A fresh id per upload attempt, always -- unlike contentItemId (which
    // a replace deliberately reuses), this must never repeat, or two
    // different uploads (e.g. successive replacements of the same video)
    // land at the same S3 key and can overwrite or delete each other:
    // DynamoDB's own conditions (see updateContentItemVideo) can't protect
    // a plain S3 object from a second, unrelated write to the same path.
    // Mirrors submissionNonce scoping the transcode *output* the same way
    // (see submitTranscodeJob's Destination) -- this scopes the raw
    // *input* identically, just one level shallower (a single object, not
    // a directory of segments).
    const uploadId = randomUUID();
    const objectKey = `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/${contentItemId}/${uploadId}.${ext}`;

    const uploadUrl = await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({
        Bucket: await resolveLessonMediaUploadBucketName(),
        Key: objectKey,
        ContentType: contentType,
      }),
      { expiresIn: UPLOAD_URL_EXPIRY_SECONDS },
    );

    return { contentItemId, uploadUrl, objectKey };
  });

export const createContentItemVideo = courseProcedure
  .input(CreateContentItemVideoInputSchema)
  .output(CreateContentItemVideoOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const {
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      title,
      description,
      objectKey,
      mimeType,
      durationSeconds,
    } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may add content to
    // its lessons, not just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: lesson } = await coreTable.entities.lesson
      .get({ courseId, moduleId, lessonId })
      .go();
    if (!lesson) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(
      lesson,
      'Restore the lesson before adding content to it',
    );
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });
    const course = await getCourseOrThrow(coreTable, courseId);

    // The object key must be one this lesson's own upload-url procedure
    // could have issued, so a caller can't record metadata pointing at an
    // object outside this lesson's prefix (e.g. another lesson's video).
    if (
      !objectKey.startsWith(
        `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/`,
      ) ||
      !objectKey.includes(contentItemId)
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'objectKey does not match this lesson and content item',
      });
    }

    const objectETag = await getVideoUploadETag(objectKey);
    if (!objectETag) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'objectKey does not point to an uploaded file',
      });
    }

    // New content items append to the end of the lesson. `order` isn't part
    // of any key (content item counts per lesson are small enough to sort
    // client-side), so this is a plain query-and-increment rather than an
    // atomic counter.
    const { data: contentItems } = await coreTable.entities.contentItem.query
      .primary({ courseId, moduleId, lessonId })
      .go();
    const order =
      contentItems.reduce((max, item) => Math.max(max, item.order), 0) + 1;

    // Feeds submitTranscodeJob's ClientRequestToken -- see its docstring
    // for why a nonce, not the upload's own content, is what that token is
    // derived from. Widened to plain string: ElectroDB's generated
    // attribute type for submissionNonce is 'string', and randomUUID()'s
    // own narrower template-literal return type doesn't structurally
    // match that when passed into op.eq() further down.
    const submissionNonce: string = randomUUID();

    // Created in the same transaction as checks that the module and lesson
    // are still there and not archived, so one archived or deleted after
    // the checks above can't end up with new content.
    const key = { courseId, moduleId, lessonId, contentItemId };
    await writeUnderActiveAncestors(coreTable, key, (entities) => [
      entities.contentItem
        .create({
          ...key,
          type: 'video',
          status: 'pending',
          title,
          description,
          s3Key: objectKey,
          mimeType,
          durationSeconds,
          order,
          ...initialVisibilityFields(course),
          submissionNonce,
        })
        .commit(),
    ]);
    // Transactions don't return the written attributes.
    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();

    let mediaConvertJobId: string;
    try {
      // Submitted only after the record exists, so the completion callback
      // (which patches this exact record once transcoding finishes) can
      // never race ahead of it.
      mediaConvertJobId = await submitTranscodeJob({
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        objectKey,
        submissionNonce,
      });
    } catch (error) {
      // Job submission itself failed -- delete the record so a retry
      // (even with the exact same input) starts clean instead of leaving
      // a permanently broken 'pending' record with no job behind it, or
      // piling a duplicate alongside it. Conditioned on submissionNonce
      // still being this exact attempt's: a concurrent updateContentItemVideo
      // could have already read this just-created record and replaced it
      // with its own submission before this rollback runs, and deleting
      // the record out from under that legitimate, newer replacement would
      // corrupt it for no reason -- this attempt's own failure has nothing
      // to do with a submission that came after it.
      await coreTable.entities.contentItem
        .delete({ courseId, moduleId, lessonId, contentItemId })
        .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce))
        .go()
        .catch((deleteError: unknown) => {
          ctx.logger?.error(
            'Failed to roll back content item after failed transcode submission',
            { error: deleteError, courseId, moduleId, lessonId, contentItemId },
          );
        });
      throw error;
    }

    try {
      // Lets transcode-complete.ts recognize a stale completion event from
      // a job a later replacement has since superseded. rawObjectETag lets
      // a future updateContentItemVideo call tell a genuine replacement
      // apart from a retry of this exact submission. Conditioned on
      // submissionNonce still being this exact attempt's, for the same
      // reason as the rollback delete above -- a concurrent replacement
      // may have already superseded this record with its own nonce/job,
      // and this stamp landing anyway would silently repoint the record
      // at this attempt's job while leaving that replacement's own
      // s3Key/status in place.
      await coreTable.entities.contentItem
        .patch({ courseId, moduleId, lessonId, contentItemId })
        .set({ mediaConvertJobId, rawObjectETag: objectETag })
        .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce))
        .go();
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        // Lost ownership, not a transient failure: a concurrent replacement
        // already moved this record onto its own nonce, so this attempt's
        // job has nothing left pointing at it and needs its own cleanup --
        // otherwise nothing else will ever cancel or clean it up.
        await bestEffortCancelTranscodeJob(ctx.logger, {
          jobId: mediaConvertJobId,
          courseId,
          moduleId,
          lessonId,
          contentItemId,
          submissionNonce,
        });
      } else {
        // The job itself is real and already running regardless of
        // whether this stamp lands -- rolling back here (deleting the
        // record, or marking it failed) would orphan it. submissionNonce
        // is already durable from the .create() above, so a later retry's
        // crash-gap check reconnects to this exact job via
        // ClientRequestToken, and transcode-complete.ts's own
        // nonce-conditioned patch reconciles the record once the job
        // actually finishes, regardless of whether this stamp ever lands.
        ctx.logger?.error(
          'Failed to stamp mediaConvertJobId after transcode submission',
          {
            error,
            courseId,
            moduleId,
            lessonId,
            contentItemId,
            mediaConvertJobId,
          },
        );
      }
    }

    return asContentItemOutput<ICreateContentItemVideoOutput>(contentItem);
  });

export const updateContentItemVideo = courseProcedure
  .input(UpdateContentItemVideoInputSchema)
  .output(UpdateContentItemVideoOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const {
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      title,
      description,
      objectKey,
      mimeType,
      durationSeconds,
    } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may edit its lesson
    // content, not just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: existing } = await coreTable.entities.contentItem
      .get({ courseId, moduleId, lessonId, contentItemId })
      .go();
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    // A content item's type is fixed at creation -- there's no supported
    // path to turn a text item into a video.
    if (existing.type !== 'video') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Content item is type '${existing.type}', not 'video'`,
      });
    }
    requireNotArchived(existing, 'Restore the content item before editing it');
    await requireAncestorsNotArchived(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });

    const videoKey = { courseId, moduleId, lessonId, contentItemId };
    // A write below lost its race: another replace, an edit, a delete or an
    // archive landed since the read above.
    const throwModifiedConflict = (): never => {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Content item was modified by another request; please retry',
      });
    };

    // Replacing the underlying video: the object key must at least be
    // scoped to this lesson, so a caller can't point the record at an
    // object outside its lesson's prefix (e.g. another lesson's video).
    // createContentItemVideoUploadUrl reuses this contentItemId in the key
    // when told it's a replacement, but doesn't have to be -- a caller
    // could still supply an unrelated key from within this lesson, so this
    // check doesn't require an exact contentItemId match.
    if (
      objectKey !== undefined &&
      !objectKey.startsWith(
        `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/`,
      )
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'objectKey does not match this lesson',
      });
    }

    let objectETag: string | undefined;
    let submissionNonce: string | undefined;
    if (objectKey !== undefined) {
      objectETag = await getVideoUploadETag(objectKey);
      if (!objectETag) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'objectKey does not point to an uploaded file',
        });
      }

      // A caller retrying this exact mutation (e.g. after a client-side
      // timeout, even though the original call actually succeeded) would
      // otherwise cancel the job that submission started and resubmit a
      // redundant one -- interrupting work that was already proceeding
      // correctly. objectKey alone can't detect this (it's deterministic
      // from contentItemId + extension, so it stays the same across a
      // genuine replacement too), but objectKey *and* the raw upload's
      // content both matching what's already mid-transcode means nothing
      // about the *video* has changed since that submission, so the
      // transcode itself is left alone. That says nothing about the rest
      // of the mutation, though -- title/description/etc can still differ
      // from what's on the record (e.g. the caller edited them after the
      // first, still-in-flight attempt), and those still need to land.
      if (
        existing.status === 'pending' &&
        existing.s3Key === objectKey &&
        existing.mediaConvertJobId !== undefined &&
        existing.rawObjectETag === objectETag
      ) {
        const metadataUpdates = {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(mimeType !== undefined && { mimeType }),
          ...(durationSeconds !== undefined && { durationSeconds }),
        };
        if (Object.keys(metadataUpdates).length === 0) {
          return asContentItemOutput<IUpdateContentItemVideoOutput>(existing);
        }
        // Same ownership check as every other write in this file -- proves
        // the record is still genuinely this exact submission's before
        // applying an edit that has nothing to do with the transcode dedup
        // above -- plus the module, lesson and item still not archived.
        // Losing ownership means a concurrent replacement or delete has
        // already superseded this record since it was read above (an
        // ordinary transcode completion never touches submissionNonce).
        // Reporting success with the earlier snapshot would be wrong: the
        // caller's edit was rejected, not applied, so it's the same CONFLICT
        // the replacement branch below throws for the same kind of race.
        await writeUnderActiveAncestors(
          coreTable,
          videoKey,
          (entities) => [
            entities.contentItem
              .patch(videoKey)
              .set(metadataUpdates)
              .where(
                (attr, op) =>
                  `${op.eq(attr.submissionNonce, existing.submissionNonce!)} AND ${op.notExists(attr.archivedAt)}`,
              )
              .commit(),
          ],
          throwModifiedConflict,
        );
        // Transactions don't return the written attributes.
        const { data: updated } = await coreTable.entities.contentItem
          .get(videoKey)
          .go();
        return asContentItemOutput<IUpdateContentItemVideoOutput>(updated);
      }

      // A crashed retry (submitTranscodeJob succeeded, but the process
      // died before the follow-up patch below could stamp mediaConvertJobId
      // onto the record) targets the exact same still-pending replacement
      // this record already has in flight, just without a job id recorded
      // yet -- status/s3Key already prove that, durably, regardless of how
      // long ago the crash happened. Reusing its nonce lets
      // submitTranscodeJob's ClientRequestToken reconnect to whatever job
      // that attempt already created instead of starting a duplicate. Any
      // other case -- the content actually changed, the key differs, or
      // the item wasn't pending at all -- is a genuinely new submission
      // and gets a fresh nonce that can never collide with anything.
      submissionNonce =
        existing.status === 'pending' &&
        existing.s3Key === objectKey &&
        existing.mediaConvertJobId === undefined &&
        existing.submissionNonce
          ? existing.submissionNonce
          : randomUUID();
    }

    let contentItem;
    if (objectKey !== undefined) {
      // Also conditioned, in the same transaction, on the module and lesson
      // still being active and the item still not archived, so an archive
      // landing after the checks above can't be replaced past.
      await writeUnderActiveAncestors(
        coreTable,
        videoKey,
        (entities) => [
          entities.contentItem
            .patch(videoKey)
            .set({
              ...(title !== undefined && { title }),
              ...(description !== undefined && { description }),
              // Replacing the file invalidates whatever transcode already
              // ran against the old one -- the new object needs to go
              // through it again before it's playable.
              s3Key: objectKey,
              status: 'pending',
              submissionNonce,
              // Students keep playing the version being replaced until this
              // one is ready (#209): a ready video becomes the previous
              // version. Replacing a replacement still in flight keeps the
              // previous version it already had.
              ...(existing.status === 'ready' &&
                existing.s3Key && { previousS3Key: existing.s3Key }),
              ...(mimeType !== undefined && { mimeType }),
              ...(durationSeconds !== undefined && { durationSeconds }),
            })
            // Clearing mediaConvertJobId here (rather than leaving whatever
            // job, if any, the video being replaced previously had) makes it
            // an unambiguous signal for a future read of this record: still
            // undefined means no job has been stamped for *this* submission
            // attempt yet. Without this, a retry after a crash between
            // submitTranscodeJob succeeding and the follow-up stamp below
            // would see a defined-but-stale id here, fail the crash-gap
            // nonce-reuse check above, and submit a duplicate job instead of
            // reconnecting to the one that attempt already created. A
            // no-op when there was nothing to clear (a fresh item, or a
            // retry already resuming this same attempt).
            .remove(['mediaConvertJobId'])
            // Guards against a second updateContentItemVideo replace racing
            // this one: if status/s3Key/submissionNonce have changed since
            // the .get() above, another replace already landed first, and
            // proceeding here would submit a second job writing to the same
            // S3 destination as that one (#123). A concurrent metadata-only
            // edit never touches these fields, so it can never trip this
            // check -- only two concurrent replacements can. submissionNonce
            // is included alongside status/s3Key because objectKey is
            // deterministic from contentItemId + extension: two concurrent
            // same-extension replacements of an already-pending item can
            // read identical status/s3Key values on both sides of the race,
            // so those two alone wouldn't always catch it; submissionNonce is
            // freshly randomized per call and can never coincidentally match.
            // Older records from before submissionNonce existed have nothing
            // to compare, so the check falls back to status/s3Key only for
            // them, same as it always has.
            .where((attr, op) => {
              const condition = `${op.eq(attr.status, existing.status)} AND ${op.eq(attr.s3Key, existing.s3Key!)}`;
              const owned = existing.submissionNonce
                ? `${condition} AND ${op.eq(attr.submissionNonce, existing.submissionNonce)}`
                : condition;
              return `${owned} AND ${op.notExists(attr.archivedAt)}`;
            })
            .commit(),
        ],
        throwModifiedConflict,
      );
    } else {
      await writeUnderActiveAncestors(
        coreTable,
        videoKey,
        (entities) => [
          entities.contentItem
            .patch(videoKey)
            .set({
              ...(title !== undefined && { title }),
              ...(description !== undefined && { description }),
              ...(mimeType !== undefined && { mimeType }),
              ...(durationSeconds !== undefined && { durationSeconds }),
            })
            .where((attr, op) => op.notExists(attr.archivedAt))
            .commit(),
        ],
        throwModifiedConflict,
      );
    }
    // Transactions don't return the written attributes.
    contentItem = (await coreTable.entities.contentItem.get(videoKey).go())
      .data;

    if (objectKey !== undefined) {
      // Only reachable once the patch above has actually landed -- this
      // request's view of the record it just replaced is now provably
      // current, not stale. Canceling (and scheduling cleanup for) the
      // previous job here, rather than before the patch, matters
      // specifically when that job already finished for real in the
      // window between this request's initial .get() and now: the patch's
      // own status/s3Key/submissionNonce condition would already have
      // caught that (the row no longer matches what this request read)
      // and thrown CONFLICT above, so a job scheduleTranscodeCleanup would
      // otherwise queue for deletion is never a job whose output is still
      // the record's own current, legitimate content.
      await bestEffortCancelTranscodeJobs(ctx.logger, [existing]);

      // Best-effort: the patch above already orphaned the old raw upload of
      // a replacement still in flight (or failed), regardless of whether the
      // new transcode job below ever successfully starts, so this doesn't
      // wait on that outcome. A ready video isn't deleted: it's now the
      // previous version students play, retired by transcode-complete once
      // this replacement is ready.
      if (
        existing.status !== 'ready' &&
        objectKey !== existing.s3Key &&
        existing.s3Key
      ) {
        await bestEffortDeleteContentItemVideos(ctx.logger, [existing]);
      }

      let mediaConvertJobId: string;
      try {
        // Submitted only after the patch above has landed -- see the same
        // note in createContentItemVideo.
        mediaConvertJobId = await submitTranscodeJob({
          courseId,
          moduleId,
          lessonId,
          contentItemId,
          objectKey,
          submissionNonce: submissionNonce!,
        });
      } catch (error) {
        // Job submission itself failed -- the record was already patched
        // to point at the new upload, and any job for the previous video
        // has already been canceled above too, so there's no working
        // state left to restore. Mark it failed, the same terminal state a
        // genuine MediaConvert ERROR would produce, so the instructor gets
        // an accurate signal instead of an indefinite "processing" spinner.
        // Conditioned on submissionNonce still being this exact attempt's:
        // a second concurrent replacement could have already superseded
        // this record with its own nonce/job while this attempt was still
        // waiting on submitTranscodeJob, and this attempt's own failure
        // has nothing to do with that newer, legitimate replacement.
        await coreTable.entities.contentItem
          .patch({ courseId, moduleId, lessonId, contentItemId })
          .set({ status: 'failed' })
          .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce!))
          .go()
          .catch((patchError: unknown) => {
            ctx.logger?.error(
              'Failed to mark content item failed after transcode submission error',
              {
                error: patchError,
                courseId,
                moduleId,
                lessonId,
                contentItemId,
              },
            );
          });
        throw error;
      }

      try {
        // Lets transcode-complete.ts recognize a stale completion event
        // from a job a later replacement has since superseded.
        // rawObjectETag lets a later retry of this exact submission be
        // told apart from a genuine subsequent replacement. Conditioned on
        // submissionNonce still being this exact attempt's, for the same
        // reason as the mark-failed patch above -- a concurrent
        // replacement may have already moved the record onto its own
        // nonce/job, and this stamp landing anyway would silently
        // repoint mediaConvertJobId/rawObjectETag at this attempt's job
        // while leaving that replacement's own s3Key/status in place.
        await coreTable.entities.contentItem
          .patch({ courseId, moduleId, lessonId, contentItemId })
          .set({ mediaConvertJobId, rawObjectETag: objectETag })
          .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce!))
          .go();
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          // Lost ownership, not a transient failure: a concurrent
          // replacement already moved this record onto its own nonce, so
          // this attempt's job has nothing left pointing at it and needs
          // its own cleanup -- otherwise nothing else will ever cancel or
          // clean it up.
          await bestEffortCancelTranscodeJob(ctx.logger, {
            jobId: mediaConvertJobId,
            courseId,
            moduleId,
            lessonId,
            contentItemId,
            submissionNonce: submissionNonce!,
          });
        } else {
          // The job itself is real and already running regardless of
          // whether this stamp lands -- marking the record failed here
          // would orphan it. submissionNonce is already durable from the
          // patch above, so a later retry's crash-gap check reconnects to
          // this exact job via ClientRequestToken, and
          // transcode-complete.ts's own nonce-conditioned patch
          // reconciles the record once the job actually finishes,
          // regardless of whether this stamp ever lands.
          ctx.logger?.error(
            'Failed to stamp mediaConvertJobId after transcode submission',
            {
              error,
              courseId,
              moduleId,
              lessonId,
              contentItemId,
              mediaConvertJobId,
            },
          );
        }
      }
    }

    return asContentItemOutput<IUpdateContentItemVideoOutput>(contentItem);
  });

export const createContentItemVideoUrl = courseProcedure
  .input(CreateContentItemVideoUrlInputSchema)
  .output(CreateContentItemVideoUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may view its lesson
    // videos, not just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: contentItem } = await coreTable.entities.contentItem
      .get({ courseId, moduleId, lessonId, contentItemId })
      .go();
    if (
      !contentItem ||
      contentItem.type !== 'video' ||
      !contentItem.s3Key ||
      contentItem.status !== 'ready'
    ) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    // Everything up to and including the trailing slash before
    // master.m3u8 -- the nonce-scoped (or, for pre-nonce records, just
    // content-item-scoped) directory this submission's manifest,
    // rendition playlists, and segments all live under.
    const prefixKey = contentItem.s3Key.slice(
      0,
      contentItem.s3Key.lastIndexOf('/') + 1,
    );
    const [url, cookies] = await Promise.all([
      getCloudFrontVideoUrl(contentItem.s3Key),
      getSignedCloudFrontCookies(prefixKey),
    ]);
    ctx.responseCookies?.push(...cookies);

    return { url };
  });
