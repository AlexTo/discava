/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  getCourseOrThrow,
  initialVisibilityFields,
  requireAncestorsNotArchived,
  requireNotArchived,
  writeAtEnd,
  writeUnderActiveAncestors,
} from '../lib/course-lifecycle.js';
import {
  CreateContentItemTextInputSchema,
  CreateContentItemTextOutputSchema,
  type ICreateContentItemTextOutput,
  type IUpdateContentItemTextOutput,
  UpdateContentItemTextInputSchema,
  UpdateContentItemTextOutputSchema,
} from '../schema/index.js';
import { asContentItemOutput } from './content-item-shared.js';

export const createContentItemText = courseProcedure
  .input(CreateContentItemTextInputSchema)
  .output(CreateContentItemTextOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, title, description, body } = input;
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

    // Text items have no upload step (unlike video, whose id is minted by
    // createContentItemVideoUploadUrl), so the id is generated here.
    const contentItemId = uuidv7();

    // Appended to the lesson in the same transaction as checks that the
    // module and lesson are still there and not archived, so one archived or
    // deleted after the checks above can't end up with new content.
    const key = { courseId, moduleId, lessonId, contentItemId };
    await writeAtEnd(coreTable, key, (entities, order) => [
      entities.contentItem
        .create({
          ...key,
          type: 'text',
          title,
          description,
          body,
          order,
          ...initialVisibilityFields(course),
        })
        .commit(),
    ]);

    // Transactions don't return the written attributes.
    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();
    return asContentItemOutput<ICreateContentItemTextOutput>(contentItem);
  });

export const updateContentItemText = courseProcedure
  .input(UpdateContentItemTextInputSchema)
  .output(UpdateContentItemTextOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const {
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      title,
      description,
      body,
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
    // path to turn a video into a text item.
    if (existing.type !== 'text') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Content item is type '${existing.type}', not 'text'`,
      });
    }
    requireNotArchived(existing, 'Restore the content item before editing it');
    await requireAncestorsNotArchived(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });

    // Conditioned, in one transaction, on the module and lesson still being
    // active and the item itself still not archived, so an archive landing
    // after the checks above can't be edited past.
    const key = { courseId, moduleId, lessonId, contentItemId };
    await writeUnderActiveAncestors(
      coreTable,
      key,
      (entities) => [
        entities.contentItem
          .patch(key)
          .set({
            ...(title !== undefined && { title }),
            ...(description !== undefined && { description }),
            ...(body !== undefined && { body }),
          })
          .where((attr, op) => op.notExists(attr.archivedAt))
          .commit(),
      ],
      async () => {
        const { data: current } = await coreTable.entities.contentItem
          .get(key)
          .go();
        if (!current) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        requireNotArchived(
          current,
          'Restore the content item before editing it',
        );
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'The content item was modified by another request; please retry',
        });
      },
    );

    // Transactions don't return the written attributes.
    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();
    return asContentItemOutput<IUpdateContentItemTextOutput>(contentItem);
  });
