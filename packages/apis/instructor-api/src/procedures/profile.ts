/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import {
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
  headPublicMediaObject,
  instructorPhotoKey,
  isInstructorPhotoKey,
  presignJpegUpload,
} from '@discava/common-server-utils/public-media';
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import {
  cancellationReasons,
  classifyProfileCancellation,
  defaultDisplayName,
  ensureInstructorProfile,
  handleFromName,
  instructorProfileWrites,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  CreateProfilePhotoUploadUrlInputSchema,
  CreateProfilePhotoUploadUrlOutputSchema,
  GetProfileOutputSchema,
  PROFILE_PHOTO_MAX_BYTES,
  UpdateProfileInputSchema,
  UpdateProfileOutputSchema,
  UpdateProfilePhotoInputSchema,
  UpdateProfilePhotoOutputSchema,
} from '../schema/index.js';

// The caller's own public profile. The profile is only ever read and written
// under the caller's `sub`: no input names another instructor.

const HANDLE_TAKEN = 'That handle is taken';
const PROFILE_CHANGED = 'Your profile changed; reload and try again';

const conflict = (message: string) =>
  new TRPCError({ code: 'CONFLICT', message });

type CoreTable = Parameters<typeof ensureInstructorProfile>[0];

const readProfile = async (coreTable: CoreTable, instructorId: string) => {
  const { data } = await coreTable.entities.instructorProfile
    .get({ instructorId })
    .go();
  return data;
};

// Whether the instructor teaches a published course.
const teachesPublishedCourse = async (
  coreTable: CoreTable,
  instructorId: string,
): Promise<boolean> => {
  const { data: memberships } = await coreTable.entities.courseInstructor.query
    .byInstructor({ instructorId })
    .go({ pages: 'all' });
  if (memberships.length === 0) {
    return false;
  }
  const { data: courses } = await coreTable.entities.course
    .get(memberships.map(({ courseId }) => ({ courseId })))
    .go();
  return courses.some((course) => course?.status === 'published');
};

export const getProfile = courseProcedure
  .output(GetProfileOutputSchema)
  .query(async ({ ctx }) => {
    const coreTable = ctx.coreTable;
    const instructorId = ctx.user.sub;

    const [profile, isPublic] = await Promise.all([
      readProfile(coreTable, instructorId),
      teachesPublishedCourse(coreTable, instructorId),
    ]);
    if (profile) {
      return { ...profile, isPublic };
    }

    // Nothing is written until the instructor saves (or creates a course).
    const { data: user } = await coreTable.entities.user
      .get({ userId: instructorId })
      .go();
    return {
      handle: handleFromName(user?.givenName, user?.familyName),
      displayName: defaultDisplayName(user ?? undefined),
      version: 0,
      isPublic,
    };
  });

export const updateProfile = courseProcedure
  .input(UpdateProfileInputSchema)
  .output(UpdateProfileOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const instructorId = ctx.user.sub;
    const { version, displayName, handle } = input;
    const headline = input.headline ?? '';
    const bio = input.bio ?? '';

    if (version === 0) {
      const result = await ensureInstructorProfile(coreTable, instructorId, {
        fields: { displayName, headline, bio },
        handle,
      });
      if (result.status === 'handle-taken') {
        throw conflict(HANDLE_TAKEN);
      }
      if (result.status === 'exists') {
        throw conflict(PROFILE_CHANGED);
      }
    } else {
      const current = await readProfile(coreTable, instructorId);
      if (!current) {
        throw conflict(PROFILE_CHANGED);
      }
      const patch = { displayName, headline, bio };
      const action = handle === current.handle ? 'update' : 'changeHandle';
      const now = new Date();
      const { canceled, data: results } = await coreTable.transaction
        .write(() =>
          action === 'update'
            ? instructorProfileWrites.update(coreTable, {
                instructorId,
                version,
                patch,
                now,
              })
            : instructorProfileWrites.changeHandle(coreTable, {
                instructorId,
                version,
                from: current.handle,
                to: handle,
                patch,
                now,
              }),
        )
        .go();
      if (canceled) {
        const cause = classifyProfileCancellation(
          action,
          cancellationReasons(results),
        );
        if (cause === 'handle-taken') {
          throw conflict(HANDLE_TAKEN);
        }
        throw cause === 'stale'
          ? conflict(PROFILE_CHANGED)
          : transactionConflict();
      }
    }

    const saved = await readProfile(coreTable, instructorId);
    if (!saved) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    }
    return saved;
  });

export const createProfilePhotoUploadUrl = courseProcedure
  .input(CreateProfilePhotoUploadUrlInputSchema)
  .output(CreateProfilePhotoUploadUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const photoKey = instructorPhotoKey(ctx.user.sub, randomUUID());
    return {
      photoKey,
      ...(await presignJpegUpload(photoKey, input.contentLength)),
    };
  });

export const updateProfilePhoto = courseProcedure
  .input(UpdateProfilePhotoInputSchema)
  .output(UpdateProfilePhotoOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const instructorId = ctx.user.sub;
    const { photoKey } = input;

    const current = await readProfile(coreTable, instructorId);
    if (!current) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Save your profile before adding a photo',
      });
    }

    if (photoKey !== null) {
      // Only a photo createPhotoUploadUrl issued to the caller, and only once
      // it is there.
      const upload = isInstructorPhotoKey(instructorId, photoKey)
        ? await headPublicMediaObject(photoKey)
        : undefined;
      if (
        upload?.contentType !== 'image/jpeg' ||
        (upload.contentLength ?? 0) > PROFILE_PHOTO_MAX_BYTES
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Upload the photo before saving it',
        });
      }
      await attachPublicMediaObject(photoKey);
    }

    const { canceled } = await coreTable.transaction
      .write(() =>
        instructorProfileWrites.setPhoto(coreTable, {
          instructorId,
          photoKey,
          now: new Date(),
        }),
      )
      .go();
    if (canceled) {
      if (photoKey !== null) {
        await bestEffortDetachPublicMediaObject(ctx.logger, photoKey);
      }
      throw transactionConflict();
    }

    if (current.photoKey && current.photoKey !== photoKey) {
      await bestEffortDetachPublicMediaObject(ctx.logger, current.photoKey);
    }

    const saved = await readProfile(coreTable, instructorId);
    if (!saved) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    return saved;
  });
