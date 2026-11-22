/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrandFieldsSchema } from '@discava/common-branding/brand';
import {
  BRAND_IMAGE_CONTENT_TYPES,
  BRAND_IMAGE_KINDS,
} from '@discava/common-branding/image-rules';
import { z } from 'zod';

// What the admin portal edits: the brand fields. Their rules (name length,
// colour readability, key shapes) are checked by `branding.save` with
// @discava/common-branding, so the portal, this API and the table agree; the
// input here only fixes the shape.
const BrandInputSchema = z.object({
  name: z.string().nullable(),
  showNameBesideLogo: z.boolean(),
  colour: z.string().nullable(),
  logoKey: z.string().nullable(),
  iconKey: z.string().nullable(),
  shareImageKey: z.string().nullable(),
});

export const BrandOutputSchema = BrandFieldsSchema;

export const BrandStateSchema = z.object({
  brand: BrandOutputSchema,
  /** 0 when nothing has been saved yet. */
  revision: z.number().int().min(0),
  changed: z
    .object({ by: z.string(), byName: z.string(), at: z.string() })
    .nullable(),
});

export const CreateBrandUploadUrlInputSchema = z.object({
  kind: z.enum(BRAND_IMAGE_KINDS),
  contentType: z.enum(BRAND_IMAGE_CONTENT_TYPES),
  contentLength: z.number().int().positive(),
});

export const CreateBrandUploadUrlOutputSchema = z.object({
  key: z.string(),
  uploadUrl: z.string(),
  headers: z.record(z.string(), z.string()),
});

export const SaveBrandInputSchema = BrandInputSchema.extend({
  expectedRevision: z.number().int().min(0),
});
