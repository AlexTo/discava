/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  HEADLINE_MAX,
  isValidHandle,
  RESERVED_HANDLES,
} from '@discava/core-table';
import { z } from 'zod';

export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export const ProfileSchema = z.object({
  handle: z.string(),
  displayName: z.string(),
  headline: z.string().optional(),
  bio: z.string().optional(),
  photoKey: z.string().optional(),
  // 0 for a default the caller has not saved yet.
  version: z.number().int().min(0),
});

export const GetProfileOutputSchema = ProfileSchema.extend({
  // True when the caller teaches a published course.
  isPublic: z.boolean(),
});

export type IGetProfileOutput = z.output<typeof GetProfileOutputSchema>;

export const UpdateProfileInputSchema = z.object({
  version: z.number().int().min(0),
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required')
    .max(DISPLAY_NAME_MAX, `Display name can be at most ${DISPLAY_NAME_MAX}`),
  headline: z
    .string()
    .trim()
    .max(HEADLINE_MAX, `Headline can be at most ${HEADLINE_MAX} characters`)
    .optional(),
  bio: z
    .string()
    .trim()
    .max(BIO_MAX, `Bio can be at most ${BIO_MAX} characters`)
    .optional(),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidHandle, {
      message:
        'Handle must be 3 to 30 lower-case letters, numbers and single hyphens',
    })
    .refine((handle) => !RESERVED_HANDLES.includes(handle), {
      message: 'That handle is reserved',
    }),
});

export type IUpdateProfileInput = z.output<typeof UpdateProfileInputSchema>;

export const UpdateProfileOutputSchema = ProfileSchema;

export const CreateProfilePhotoUploadUrlInputSchema = z.object({
  // The cropped photo's exact size: the presigned URL only accepts this many
  // bytes.
  contentLength: z.number().int().positive().max(PROFILE_PHOTO_MAX_BYTES),
});

export const CreateProfilePhotoUploadUrlOutputSchema = z.object({
  uploadUrl: z.string(),
  photoKey: z.string(),
  // Send these with the PUT exactly as given: they're part of its signature.
  headers: z.record(z.string(), z.string()),
});

export const UpdateProfilePhotoInputSchema = z.object({
  // A photo uploaded through createPhotoUploadUrl, or null to remove it.
  photoKey: z.string().nullable(),
});

export const UpdateProfilePhotoOutputSchema = ProfileSchema;
